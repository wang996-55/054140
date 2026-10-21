/**
 * The only place that talks to the relay (文档 §5).
 *
 * 视觉与生图是**两条独立通道**：各自的 base_url / path / model / key / 超时 /
 * 鉴权方式，互不继承。这样既能 OpenAI 官方视觉 + 第三方生图，也能第三方视觉 +
 * 官方生图，或两边都是不同中转站。
 *
 * Rules kept here so no route can bypass them:
 *  - a key never leaves the Host, never crosses to the other channel's host, and
 *    never reaches an error message or a log line;
 *  - a timeout is `provider-timeout-unknown` and is never retried (a retry could
 *    pay twice for one picture);
 *  - response bodies are size-capped before decoding, and remote image URLs are
 *    re-validated on every redirect hop.
 */
import { AppError } from './errors.js'

export class RelayError extends AppError {
  constructor(code, message, opts = {}) {
    super(code, message, opts)
    this.name = 'RelayError'
  }
}

/** 视觉通道支持的接口模式（第三方中转站基本都能对上其中一个）。 */
export const VISION_PROVIDERS = ['openai_chat', 'openai_responses', 'anthropic', 'gemini']
/** 生图通道支持的接口模式。 */
export const IMAGE_PROVIDERS = ['openai_images', 'openai_chat', 'gemini']
/** 鉴权方式：Bearer / x-api-key / api-key / Google / 不鉴权。 */
export const AUTH_STYLES = ['bearer', 'x-api-key', 'api-key', 'google', 'none']

const DEFAULT_VISION = {
  provider: 'openai_chat',
  base_url: 'https://api.openai.com/v1',
  path: '/chat/completions',
  model: 'gpt-4o-mini',
  auth: 'bearer',
  headers: {},
  timeout_ms: 120000,
  detail: 'auto',
  max_tokens: 0,
}

const DEFAULT_IMAGE = {
  provider: 'openai_images',
  base_url: 'https://api.openai.com/v1',
  path: '/images/generations',
  edit_path: '/images/edits',
  model: 'gpt-image-1',
  edit_model: '',
  auth: 'bearer',
  headers: {},
  timeout_ms: 300000,
  size: '1024x1024',
  response_format: 'b64_json',
  quality: '',
}

const DEFAULT_SHARED = {
  allow_localhost: false,
  max_download_bytes: 33554432,
  max_base64_bytes: 33554432,
}

const clamp = (value, min, max, fallback) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.round(num)))
}

const text = (value, fallback = '') => String(value == null ? '' : value).trim() || fallback

function normalizeBaseUrl(value, fallback, label) {
  let base = text(value, fallback).replace(/\/+$/, '')
  // Pasting the full endpoint is the most common mistake: strip the known
  // suffixes so the plugin never calls `…/v1/chat/completions/chat/completions`.
  base = base.replace(/\/(?:chat\/completions|responses|messages|images\/(?:generations|edits))\/?$/i, '')
  if (!/^https?:\/\/[^\s]+$/i.test(base)) {
    throw new RelayError('bad-request', `${label}的中转站地址必须是完整的 http(s) 地址，例如 https://api.example.com/v1`)
  }
  return base
}

function normalizePath(value, fallback, label) {
  const raw = text(value, fallback)
  // A full URL is allowed: some relays hand out a complete endpoint with a key
  // already baked into the query string.
  if (/^https?:\/\//i.test(raw)) return raw
  const cleaned = raw.split(/[?#]/)[0]
  return cleaned.startsWith('/') ? raw : `/${raw}`
}

function normalizeHeaders(value, label) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new RelayError('bad-request', `${label}的额外请求头必须是对象`)
  }
  const out = {}
  for (const [key, raw] of Object.entries(value)) {
    const name = String(key || '').trim()
    if (!name) continue
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new RelayError('bad-request', `${label}的请求头名称不合法：${name}`)
    const headerValue = String(raw == null ? '' : raw).trim()
    if (!headerValue) continue
    if (headerValue.length > 512) throw new RelayError('bad-request', `${label}的请求头 ${name} 太长`)
    if (/[\r\n]/.test(headerValue)) throw new RelayError('bad-request', `${label}的请求头不能换行`)
    out[name] = headerValue
  }
  if (Object.keys(out).length > 20) throw new RelayError('bad-request', `${label}的额外请求头最多 20 条`)
  return out
}

function pickEnum(value, allowed, fallback, label) {
  const candidate = text(value, fallback)
  if (allowed.indexOf(candidate) < 0) {
    throw new RelayError('bad-request', `${label}只能是：${allowed.join(' / ')}`)
  }
  return candidate
}

function normalizeVision(input, current) {
  const base = { ...DEFAULT_VISION, ...(current || {}) }
  const source = input && typeof input === 'object' ? input : {}
  return {
    provider: pickEnum(source.provider ?? base.provider, VISION_PROVIDERS, DEFAULT_VISION.provider, '视觉接口模式'),
    base_url: normalizeBaseUrl(source.base_url ?? base.base_url, DEFAULT_VISION.base_url, '视觉通道'),
    path: normalizePath(source.path ?? base.path, DEFAULT_VISION.path, '视觉通道'),
    model: text(source.model, text(base.model, DEFAULT_VISION.model)),
    auth: pickEnum(source.auth ?? base.auth, AUTH_STYLES, DEFAULT_VISION.auth, '视觉通道鉴权方式'),
    headers: normalizeHeaders(source.headers ?? base.headers, '视觉通道'),
    timeout_ms: clamp(source.timeout_ms ?? base.timeout_ms, 5000, 900000, DEFAULT_VISION.timeout_ms),
    detail: text(source.detail, base.detail) === 'low' || text(source.detail, base.detail) === 'high' ? text(source.detail, base.detail) : 'auto',
    max_tokens: clamp(source.max_tokens ?? base.max_tokens, 0, 32000, 0),
  }
}

function normalizeImage(input, current) {
  const base = { ...DEFAULT_IMAGE, ...(current || {}) }
  const source = input && typeof input === 'object' ? input : {}
  return {
    provider: pickEnum(source.provider ?? base.provider, IMAGE_PROVIDERS, DEFAULT_IMAGE.provider, '生图接口模式'),
    base_url: normalizeBaseUrl(source.base_url ?? base.base_url, DEFAULT_IMAGE.base_url, '生图通道'),
    path: normalizePath(source.path ?? base.path, DEFAULT_IMAGE.path, '生图通道'),
    edit_path: normalizePath(source.edit_path ?? base.edit_path, DEFAULT_IMAGE.edit_path, '生图通道'),
    model: text(source.model, text(base.model, DEFAULT_IMAGE.model)),
    edit_model: text(source.edit_model, base.edit_model),
    auth: pickEnum(source.auth ?? base.auth, AUTH_STYLES, DEFAULT_IMAGE.auth, '生图通道鉴权方式'),
    headers: normalizeHeaders(source.headers ?? base.headers, '生图通道'),
    timeout_ms: clamp(source.timeout_ms ?? base.timeout_ms, 5000, 900000, DEFAULT_IMAGE.timeout_ms),
    size: text(source.size, base.size || DEFAULT_IMAGE.size),
    response_format: text(source.response_format, base.response_format || DEFAULT_IMAGE.response_format),
    quality: text(source.quality, base.quality),
  }
}

/** v2.0 的扁平配置（一套 base_url 两条通道共用）→ 两条独立通道。 */
export function migrateLegacySettings(raw) {
  if (!raw || typeof raw !== 'object') return null
  const legacy = raw.base_url || raw.models || raw.protocols || raw.paths
  if (!legacy) return null
  const models = raw.models || {}
  const protocols = raw.protocols || {}
  const paths = raw.paths || {}
  return {
    vision: {
      provider: 'openai_chat',
      base_url: raw.base_url,
      path: paths.chat,
      model: models.vision,
      timeout_ms: raw.timeout_ms,
    },
    image: {
      provider: protocols.image === 'openai_chat' ? 'openai_chat' : 'openai_images',
      base_url: raw.base_url,
      path: paths.images,
      edit_path: paths.edits,
      model: models.image,
      edit_model: models.edit,
      timeout_ms: raw.image_timeout_ms,
      size: raw.image_size,
    },
    allow_localhost: raw.allow_localhost,
    max_download_bytes: raw.max_download_bytes,
    max_base64_bytes: raw.max_base64_bytes,
  }
}

/** 规范化整份设置；旧形状会被自动迁移，未知字段丢弃。 */
export function normalizeProviderSettings(input, current) {
  const source = migrateLegacySettings(input) || (input && typeof input === 'object' ? input : {})
  const base = migrateLegacySettings(current) || (current && typeof current === 'object' ? current : {})
  return {
    schema_version: '2.1',
    vision: normalizeVision(source.vision, base.vision),
    image: normalizeImage(source.image, base.image),
    allow_localhost: (source.allow_localhost ?? base.allow_localhost) === true,
    max_download_bytes: clamp(source.max_download_bytes ?? base.max_download_bytes, 1048576, 134217728, DEFAULT_SHARED.max_download_bytes),
    max_base64_bytes: clamp(source.max_base64_bytes ?? base.max_base64_bytes, 1048576, 134217728, DEFAULT_SHARED.max_base64_bytes),
  }
}

export function defaultSettings() {
  return normalizeProviderSettings({}, null)
}

const ENV_KEYS = {
  vision: ['REPLICA_VISION_API_KEY', 'REPLICA_API_KEY', 'OPENAI_API_KEY'],
  image: ['REPLICA_IMAGE_API_KEY', 'REPLICA_API_KEY', 'OPENAI_API_KEY'],
}

const SECRET_FIELDS = {
  vision: ['vision_api_key', 'api_key'],
  image: ['image_api_key', 'api_key'],
}

/** 一条通道的 key：先看它自己的环境变量，再看它自己的 secrets 字段。 */
export function resolveChannelKey(channel, secrets, env = process.env) {
  for (const name of ENV_KEYS[channel]) {
    const value = env && env[name]
    if (value && String(value).trim()) return { key: String(value).trim(), source: 'env', env: name }
  }
  const bag = secrets && typeof secrets === 'object' ? secrets : {}
  for (const field of SECRET_FIELDS[channel]) {
    const value = bag[field]
    if (value && String(value).trim()) return { key: String(value).trim(), source: 'secrets', field }
  }
  return { key: '', source: 'none' }
}

/** 旧接口：返回视觉通道的 key（其它调用点应改用 resolveChannelKey）。 */
export function resolveApiKey(secret, env = process.env) {
  return resolveChannelKey('vision', secret, env)
}

export function keyState(secrets, env = process.env) {
  const vision = resolveChannelKey('vision', secrets, env)
  const image = resolveChannelKey('image', secrets, env)
  const source = vision.key && image.key ? 'both' : vision.key ? 'vision' : image.key ? 'image' : 'none'
  return {
    has_key: Boolean(vision.key) || Boolean(image.key),
    configured: Boolean(vision.key) && Boolean(image.key),
    source,
    vision: { has_key: Boolean(vision.key), source: vision.key ? vision.source : 'none' },
    image: { has_key: Boolean(image.key), source: image.key ? image.source : 'none' },
  }
}

/** 通道请求头：鉴权方式 + provider 固定头 + 用户自定义头（自定义优先）。 */
export function channelHeaders(channel, apiKey) {
  const headers = { 'content-type': 'application/json' }
  if (apiKey) {
    if (channel.auth === 'x-api-key') headers['x-api-key'] = apiKey
    else if (channel.auth === 'api-key') headers['api-key'] = apiKey
    else if (channel.auth === 'google') headers['x-goog-api-key'] = apiKey
    else if (channel.auth === 'none') {
      // 不鉴权的中转站（例如本机代理）不放 key
    } else headers.authorization = `Bearer ${apiKey}`
  }
  if (channel.provider === 'anthropic') {
    headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01'
  }
  return Object.assign(headers, channel.headers || {})
}

/** 通道实际请求地址：path 可以是相对路径，也可以是完整 URL。 */
export function channelUrl(channel) {
  const base = text(channel.base_url).replace(/\/+$/, '')
  const path = text(channel.path)
  if (/^https?:\/\//i.test(path)) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** Gemini 的 path 允许写 `{model}`，方便 /models/{model}:generateContent。 */
export function channelUrlForModel(channel) {
  const url = channelUrl(channel)
  return url.replace(/\{model\}/g, encodeURIComponent(text(channel.model)))
}

function timeoutSignal(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms)
  if (timer.unref) timer.unref()
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

const HTTP_CODES = {
  401: 'provider-auth',
  403: 'provider-auth',
  404: 'provider-not-found',
  429: 'provider-rate-limit',
}

async function readLimited(response, limit) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new RelayError('image-too-large', '返回内容超过大小上限')
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > limit) throw new RelayError('image-too-large', '返回内容超过大小上限')
    return buffer
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new RelayError('image-too-large', '返回内容超过大小上限')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks)
}

async function postJson({ url, headers, body, signal, fetchImpl }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  const raw = Buffer.from(await response.arrayBuffer())
  const bodyText = raw.toString('utf8')
  if (!response.ok) {
    const mapped = HTTP_CODES[response.status]
    if (mapped) {
      throw new RelayError(mapped, statusMessage(mapped, response.status, bodyText), { detail: { upstream_status: response.status } })
    }
    throw new RelayError('provider-error', `中转站返回 HTTP ${response.status}：${shorten(bodyText)}`, { detail: { upstream_status: response.status } })
  }
  try {
    return { json: JSON.parse(bodyText), text: bodyText }
  } catch {
    return { json: null, text: bodyText }
  }
}

function statusMessage(code, status, body) {
  const suffix = body ? `：${shorten(body)}` : ''
  if (code === 'provider-auth') return `API Key 无效或没有权限（HTTP ${status}）${suffix}`
  if (code === 'provider-not-found') return `接口路径或模型名不存在（HTTP ${status}）${suffix}`
  if (code === 'provider-rate-limit') return `中转站限流（HTTP ${status}），请稍后再试${suffix}`
  return `中转站返回 HTTP ${status}${suffix}`
}

function shorten(value, max = 300) {
  const textValue = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  return textValue.length > max ? `${textValue.slice(0, max)}…` : textValue
}

async function requestWithTimeout(work, ms) {
  const { signal, clear } = timeoutSignal(ms)
  try {
    return await work(signal)
  } catch (error) {
    if (error && (error.name === 'AbortError' || /aborted|timeout/i.test(String(error.message || '')))) {
      throw new RelayError(
        'provider-timeout-unknown',
        '请求超时，远程结果未知：可能已经产生费用，系统不会自动重发，请人工确认后再决定',
      )
    }
    if (error instanceof AppError) throw error
    throw new RelayError('provider-error', `请求中转站失败：${shorten(error && error.message ? error.message : error)}`)
  } finally {
    clear()
  }
}

// -------------------------------------------------------------- vision call

const DATA_URL_ANY = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i

/** `data:image/png;base64,…` → `{ mime, base64 }`（Anthropic / Gemini 要裸 base64）。 */
export function splitDataUrl(value) {
  const match = DATA_URL_ANY.exec(String(value == null ? '' : value).trim())
  if (!match) throw new RelayError('bad-request', '参考图必须是 data:image/…;base64 形式')
  return { mime: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, '') }
}

function textFromChat(json) {
  const message = json && json.choices && json.choices[0] && json.choices[0].message
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content.map(part => (typeof part === 'string' ? part : (part && part.text) || '') || '').join('')
  }
  return ''
}

function textFromResponses(json) {
  if (!json || typeof json !== 'object') return ''
  if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text
  const chunks = []
  for (const item of Array.isArray(json.output) ? json.output : []) {
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && typeof part.text === 'string') chunks.push(part.text)
    }
  }
  return chunks.join('')
}

function textFromAnthropic(json) {
  const chunks = []
  for (const block of Array.isArray(json && json.content) ? json.content : []) {
    if (block && typeof block.text === 'string') chunks.push(block.text)
  }
  return chunks.join('')
}

function textFromGemini(json) {
  const candidate = json && Array.isArray(json.candidates) ? json.candidates[0] : null
  const chunks = []
  for (const part of Array.isArray(candidate && candidate.content && candidate.content.parts) ? candidate.content.parts : []) {
    if (part && typeof part.text === 'string') chunks.push(part.text)
  }
  return chunks.join('')
}

/** 按视觉通道的接口模式生成请求体（不含网络）。导出给测试用。 */
export function buildVisionRequest({ channel, apiKey, prompt, images = [] }) {
  const url = channelUrlForModel(channel)
  const headers = channelHeaders(channel, apiKey)
  const list = images.map(image => (typeof image === 'string' ? { dataUrl: image } : image))
  if (channel.provider === 'anthropic') {
    const content = [{ type: 'text', text: String(prompt) }]
    for (const image of list) {
      const parsed = splitDataUrl(image.dataUrl)
      content.push({ type: 'image', source: { type: 'base64', media_type: parsed.mime, data: parsed.base64 } })
    }
    const body = {
      model: channel.model,
      max_tokens: channel.max_tokens || 2048,
      messages: [{ role: 'user', content }],
    }
    return { url, headers, body, parse: textFromAnthropic, provider: channel.provider }
  }
  if (channel.provider === 'gemini') {
    const parts = [{ text: String(prompt) }]
    for (const image of list) {
      const parsed = splitDataUrl(image.dataUrl)
      parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.base64 } })
    }
    const body = { contents: [{ role: 'user', parts }] }
    if (channel.max_tokens) body.generationConfig = { maxOutputTokens: channel.max_tokens }
    return { url, headers, body, parse: textFromGemini, provider: channel.provider }
  }
  if (channel.provider === 'openai_responses') {
    const content = [{ type: 'input_text', text: String(prompt) }]
    for (const image of list) content.push({ type: 'input_image', image_url: image.dataUrl })
    const body = { model: channel.model, input: [{ role: 'user', content }] }
    if (channel.max_tokens) body.max_output_tokens = channel.max_tokens
    return { url, headers, body, parse: textFromResponses, provider: channel.provider }
  }
  const content = [{ type: 'text', text: String(prompt) }]
  for (const image of list) {
    const part = { url: image.dataUrl }
    if (channel.detail === 'low' || channel.detail === 'high') part.detail = channel.detail
    content.push({ type: 'image_url', image_url: part })
  }
  const body = { model: channel.model, temperature: 0, messages: [{ role: 'user', content }] }
  if (channel.max_tokens) body.max_tokens = channel.max_tokens
  return { url, headers, body, parse: textFromChat, provider: channel.provider }
}

export async function callVision({ channel, apiKey, prompt, images = [], fetchImpl = fetch, timeoutMs }) {
  if (!apiKey) throw new RelayError('provider-missing', '视觉通道尚未配置 API Key')
  const request = buildVisionRequest({ channel, apiKey, prompt, images })
  const result = await requestWithTimeout(
    signal => postJson({ url: request.url, headers: request.headers, body: request.body, signal, fetchImpl }),
    Number(timeoutMs) || channel.timeout_ms,
  )
  const json = result.json
  const answer = json ? request.parse(json) : ''
  if (!answer || !String(answer).trim()) {
    throw new RelayError('image-parse-failed', '视觉接口没有返回可用的文本内容（检查接口模式与路径是否匹配）', {
      detail: { provider: request.provider, upstream: shorten(result.text, 200) },
    })
  }
  return { text: String(answer), raw: json, usage: (json && json.usage) || null, provider: request.provider }
}

// ------------------------------------------------------------- image parsing

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i
const BARE_B64 = /^[A-Za-z0-9+/=\s]{1024,}$/

function b64FromDataUrl(value) {
  const match = DATA_URL.exec(String(value || '').trim())
  if (!match) return null
  return { kind: 'b64', value: match[2].replace(/\s+/g, ''), source: 'data-url', mime: `image/${match[1].toLowerCase()}` }
}

export function parseImageResponse(payload) {
  const fail = () => {
    throw new RelayError('image-parse-failed', '接口没有返回可识别的图片数据')
  }
  const fromString = value => {
    const raw = String(value == null ? '' : value)
    const dataUrl = b64FromDataUrl(raw)
    if (dataUrl) return dataUrl
    const markdown = MARKDOWN_IMAGE.exec(raw)
    if (markdown) return { kind: 'url', value: markdown[1], source: 'chat-markdown' }
    const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(raw)
    if (urlMatch) return { kind: 'url', value: urlMatch[0], source: 'chat-url' }
    if (BARE_B64.test(raw.trim())) return { kind: 'b64', value: raw.replace(/\s+/g, ''), source: 'chat-b64' }
    return null
  }
  const fromPart = part => {
    if (!part) return null
    if (typeof part === 'string') return fromString(part)
    if (typeof part !== 'object') return null
    if (part.type === 'image_url' || part.image_url) {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url && part.image_url.url
      if (url) {
        const dataUrl = b64FromDataUrl(url)
        return dataUrl || { kind: 'url', value: url, source: 'image-url-part' }
      }
    }
    if (part.type === 'output_image' || part.type === 'image') {
      const data = part.data || part.b64_json || part.image_base64
      if (data) return { kind: 'b64', value: data, source: 'output-image-block' }
      const url = part.url || (part.image_url && part.image_url.url)
      if (url) return { kind: 'url', value: url, source: 'output-image-block' }
    }
    if (part.b64_json) return { kind: 'b64', value: part.b64_json, source: 'b64_json' }
    if (part.url) return { kind: 'url', value: part.url, source: 'url' }
    if (part.image_url && typeof part.image_url === 'string') return { kind: 'url', value: part.image_url, source: 'image_url' }
    if (typeof part.text === 'string') return fromString(part.text)
    if (typeof part.result === 'string') return fromString(part.result)
    return null
  }

  let json = payload
  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    const direct = fromString(trimmed)
    if (direct) return direct
    try {
      json = JSON.parse(trimmed)
    } catch {
      return fail()
    }
  }
  if (!json || typeof json !== 'object') return fail()

  const data = Array.isArray(json.data) ? json.data : []
  if (data.length && data[0] && typeof data[0] === 'object') {
    if (data[0].b64_json) return { kind: 'b64', value: data[0].b64_json, source: 'b64_json' }
    if (data[0].url) return { kind: 'url', value: data[0].url, source: 'url' }
    const part = fromPart(data[0])
    if (part) return part
  }
  const images = Array.isArray(json.images) ? json.images : []
  if (images.length) {
    const part = fromPart(images[0])
    if (part) return part
  }
  const output = Array.isArray(json.output) ? json.output : []
  for (const item of output) {
    const part = fromPart(item)
    if (part) return part
  }
  if (Array.isArray(json.content)) {
    for (const item of json.content) {
      const part = fromPart(item)
      if (part) return part
    }
  }
  const message = json.choices && json.choices[0] && json.choices[0].message
  if (message) {
    if (typeof message.content === 'string') {
      const direct = fromString(message.content)
      if (direct) return direct
    }
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        const part = fromPart(item)
        if (part) return part
      }
    }
  }
  if (json.b64_json) return { kind: 'b64', value: json.b64_json, source: 'b64_json' }
  if (json.url) return { kind: 'url', value: json.url, source: 'url' }
  if (json.image) {
    const part = fromPart(json.image)
    if (part) return part
  }
  return fail()
}

// ------------------------------------------------------------- URL safety

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
]

function isPrivateHostname(host) {
  const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!name) return true
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true
  if (name === 'metadata.google.internal' || name === 'metadata') return true
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || /^[0-9a-f:]+$/i.test(name)) {
    if (name === '::1' || name === '::' || name === '0:0:0:0:0:0:0:1') return true
    if (/^(?:fc|fd|fe80)/i.test(name.replace(/:/g, ''))) return true
    if (/^169\.254\.169\.254$/.test(name)) return true
    return PRIVATE_V4.some(pattern => pattern.test(name))
  }
  return false
}

export function assertSafeRemoteUrl(value, { allowData = false, allowLocalhost = false } = {}) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) throw new RelayError('url-unsafe', '图片地址为空')
  if (/^data:/i.test(raw)) {
    if (allowData) return 'data'
    throw new RelayError('url-unsafe', '不接受内嵌 data URL 作为远程图片地址')
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new RelayError('url-unsafe', '图片地址不是合法 URL')
  }
  if (url.username || url.password) throw new RelayError('url-unsafe', '图片地址不允许携带账号密码')
  const protocol = url.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') throw new RelayError('url-unsafe', '图片地址必须使用 HTTPS')
  if (protocol === 'http:') {
    if (!allowLocalhost || !(url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
      throw new RelayError('url-unsafe', '该图片地址不被允许（非 HTTPS）')
    }
  }
  if (isPrivateHostname(url.hostname)) {
    if (!(allowLocalhost && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))) {
      throw new RelayError('url-unsafe', '该图片地址不被允许（内网或保留地址）')
    }
  }
  return url.toString()
}

const MAGIC = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
]

function sniffMime(buffer) {
  for (const entry of MAGIC) {
    if (entry.bytes.every((byte, index) => buffer[index] === byte)) return entry.mime
  }
  return ''
}

export async function downloadImage(url, { maxBytes, fetchImpl = fetch, timeoutMs = 120000, allowLocalhost = false } = {}) {
  const limit = Number(maxBytes) || DEFAULT_SHARED.max_download_bytes
  const { signal, clear } = timeoutSignal(timeoutMs)
  try {
    let target = assertSafeRemoteUrl(url, { allowLocalhost })
    for (let hop = 0; hop < 4; hop += 1) {
      const response = await fetchImpl(target, { signal, redirect: 'manual' })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) throw new RelayError('image-parse-failed', '图片地址跳转缺少目标')
        target = assertSafeRemoteUrl(new URL(location, target).toString(), { allowLocalhost })
        continue
      }
      if (!response.ok) throw new RelayError('provider-error', `下载生成图片失败：HTTP ${response.status}`)
      const buffer = await readLimited(response, limit)
      const mime = sniffMime(buffer)
      if (!mime) throw new RelayError('image-parse-failed', '下载到的内容不是图片')
      return { buffer, mime }
    }
    throw new RelayError('url-unsafe', '图片地址跳转次数过多')
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error && (error.name === 'AbortError' || /aborted|timeout/i.test(String(error.message || '')))) {
      throw new RelayError('provider-timeout-unknown', '下载生成图片超时，远程结果未知，不会自动重发')
    }
    throw new RelayError('provider-error', `下载生成图片失败：${shorten(error && error.message ? error.message : error)}`)
  } finally {
    clear()
  }
}

function decodeBase64(b64, limit) {
  const clean = String(b64 || '').replace(/\s+/g, '')
  const estimated = Math.floor((clean.length * 3) / 4)
  if (estimated > limit) throw new RelayError('image-too-large', '返回的图片超过大小上限')
  let buffer
  try {
    buffer = Buffer.from(clean, 'base64')
  } catch {
    throw new RelayError('image-parse-failed', '图片 Base64 解码失败')
  }
  if (buffer.length > limit) throw new RelayError('image-too-large', '返回的图片超过大小上限')
  return buffer
}

// ------------------------------------------------------------ image request

/** 按生图通道的接口模式生成请求（不含网络）。导出给测试用。 */
export function buildImageRequest({ channel, apiKey, prompt, size, referenceImages = [] }) {
  const headers = channelHeaders(channel, apiKey)
  const images = referenceImages.map(image => (typeof image === 'string' ? { dataUrl: image } : image))
  if (channel.provider === 'openai_chat') {
    const content = [{ type: 'text', text: String(prompt) }]
    for (const image of images) content.push({ type: 'image_url', image_url: { url: image.dataUrl } })
    const body = { model: channel.model, messages: [{ role: 'user', content }] }
    return { kind: 'json', url: channelUrlForModel(channel), headers, body, provider: channel.provider }
  }
  if (channel.provider === 'gemini') {
    const parts = [{ text: String(prompt) }]
    for (const image of images) {
      const parsed = splitDataUrl(image.dataUrl)
      parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.base64 } })
    }
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }
    return { kind: 'json', url: channelUrlForModel(channel), headers, body, provider: channel.provider }
  }
  if (images.length > 0 && text(channel.edit_path)) {
    const editHeaders = { ...headers }
    delete editHeaders['content-type']
    return {
      kind: 'multipart',
      url: channelUrlForModel({ ...channel, path: channel.edit_path }),
      headers: editHeaders,
      model: channel.edit_model || channel.model,
      prompt: String(prompt),
      size,
      images,
      provider: channel.provider,
    }
  }
  const body = {
    model: channel.model,
    prompt: String(prompt),
    size,
    n: 1,
    response_format: channel.response_format || 'b64_json',
  }
  if (channel.quality) body.quality = channel.quality
  return { kind: 'json', url: channelUrlForModel(channel), headers, body, provider: channel.provider }
}

export async function generateImage({
  channel,
  shared,
  apiKey,
  prompt,
  size,
  referenceImages = [],
  fetchImpl = fetch,
  timeoutMs,
}) {
  if (!apiKey) throw new RelayError('provider-missing', '生图通道尚未配置 API Key')
  const limits = shared || DEFAULT_SHARED
  const ms = Number(timeoutMs) || channel.timeout_ms
  const outputSize = size || channel.size
  const request = buildImageRequest({ channel, apiKey, prompt, size: outputSize, referenceImages })
  const parsed = await requestWithTimeout(async signal => {
    if (request.kind === 'multipart') {
      const form = new FormData()
      form.append('model', request.model)
      form.append('prompt', request.prompt)
      form.append('size', request.size)
      form.append('n', '1')
      request.images.forEach((img, index) => {
        const parsedUrl = splitDataUrl(img.dataUrl)
        const blob = new Blob([Buffer.from(parsedUrl.base64, 'base64')], { type: parsedUrl.mime })
        const ext = parsedUrl.mime.split('/')[1] || 'png'
        form.append('image', blob, img.name || `reference-${index + 1}.${ext}`)
      })
      const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: form, signal })
      const raw = Buffer.from(await response.arrayBuffer())
      if (!response.ok) {
        const mapped = HTTP_CODES[response.status]
        const payload = raw.toString('utf8')
        throw new RelayError(mapped || 'provider-error', statusMessage(mapped || 'provider-error', response.status, payload), { detail: { upstream_status: response.status } })
      }
      return parseImageResponse(raw.toString('utf8'))
    }
    const result = await postJson({ url: request.url, headers: request.headers, body: request.body, signal, fetchImpl })
    return parseImageResponse(result.json || result.text)
  }, ms)

  if (parsed.kind === 'url') {
    const downloaded = await downloadImage(parsed.value, {
      maxBytes: limits.max_download_bytes,
      fetchImpl,
      timeoutMs: ms,
      allowLocalhost: limits.allow_localhost,
    })
    return { bytes: downloaded.buffer, mime: downloaded.mime, source: parsed.source, provider: request.provider }
  }
  const buffer = decodeBase64(parsed.value, limits.max_base64_bytes)
  const mime = sniffMime(buffer)
  if (!mime) throw new RelayError('image-parse-failed', '返回的 Base64 不是图片数据')
  return { bytes: buffer, mime, source: parsed.source, provider: request.provider }
}

/** One explicit, paid test request (文档 §5 能力设置)，按通道分别测试。 */
export async function testProvider({ settings, visionKey, imageKey, kind = 'vision', fetchImpl = fetch }) {
  if (kind === 'image') {
    if (!imageKey) throw new RelayError('provider-missing', '生图通道尚未配置 API Key')
    const result = await generateImage({
      channel: settings.image,
      shared: settings,
      apiKey: imageKey,
      prompt: 'a plain light grey studio backdrop with a soft top light, no product, no text',
      size: settings.image.size,
      fetchImpl,
    })
    return { ok: true, kind, provider: result.provider, model: settings.image.model, bytes: result.bytes.length, mime: result.mime, source: result.source }
  }
  if (!visionKey) throw new RelayError('provider-missing', '视觉通道尚未配置 API Key')
  const result = await callVision({
    channel: settings.vision,
    apiKey: visionKey,
    prompt: 'Reply with JSON only: {"ok":true}',
    images: [],
    fetchImpl,
  })
  return { ok: true, kind, provider: result.provider, model: settings.vision.model, text: shorten(result.text, 200) }
}
