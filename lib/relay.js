/**
 * The only place that talks to the relay (文档 §5).
 *
 * Rules kept here so no route can bypass them:
 *  - the API key never leaves the Host, and never reaches an error message or log;
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

const DEFAULT_SETTINGS = {
  base_url: 'https://api.openai.com/v1',
  models: { vision: 'gpt-4o-mini', image: 'gpt-image-1', edit: '' },
  protocols: { vision: 'openai_chat', image: 'openai_images' },
  paths: { chat: '/chat/completions', images: '/images/generations', edits: '/images/edits' },
  timeout_ms: 120000,
  image_timeout_ms: 300000,
  max_download_bytes: 33554432,
  max_base64_bytes: 33554432,
  allow_localhost: false,
  image_size: '1024x1024',
}

const clamp = (value, min, max, fallback) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.round(num)))
}

const text = (value, fallback = '') => String(value == null ? '' : value).trim() || fallback

export function normalizeProviderSettings(input, current) {
  const base = { ...DEFAULT_SETTINGS, ...(current || {}) }
  const source = input && typeof input === 'object' ? input : {}
  const models = { ...base.models, ...(source.models || {}) }
  const protocols = { ...base.protocols, ...(source.protocols || {}) }
  const paths = { ...base.paths, ...(source.paths || {}) }
  let baseUrl = text(source.base_url, text(base.base_url, DEFAULT_SETTINGS.base_url)).replace(/\/+$/, '')
  // A pasted endpoint URL is a common mistake; strip the known suffixes so the
  // plugin never calls `…/v1/chat/completions/chat/completions`.
  baseUrl = baseUrl.replace(/\/(?:chat\/completions|images\/(?:generations|edits))\/?$/i, '')
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new RelayError('bad-request', '中转站地址必须是完整的 http(s) 地址，例如 https://api.example.com/v1')
  }
  const protocol = value =>
    value === 'openai_chat' || value === 'openai_images' ? value : null
  const visionProtocol = protocol(protocols.vision)
  const imageProtocol = protocol(protocols.image)
  if (!visionProtocol || !imageProtocol) {
    throw new RelayError('bad-request', '接口模式只能是 openai_chat 或 openai_images')
  }
  const pathOf = (value, fallback) => {
    const value2 = text(value, fallback)
    return value2.startsWith('/') ? value2 : `/${value2}`
  }
  return {
    base_url: baseUrl,
    models: {
      vision: text(models.vision, DEFAULT_SETTINGS.models.vision),
      image: text(models.image, DEFAULT_SETTINGS.models.image),
      edit: text(models.edit),
    },
    protocols: { vision: visionProtocol, image: imageProtocol },
    paths: {
      chat: pathOf(paths.chat, DEFAULT_SETTINGS.paths.chat),
      images: pathOf(paths.images, DEFAULT_SETTINGS.paths.images),
      edits: pathOf(paths.edits, DEFAULT_SETTINGS.paths.edits),
    },
    timeout_ms: clamp(source.timeout_ms ?? base.timeout_ms, 5000, 600000, DEFAULT_SETTINGS.timeout_ms),
    image_timeout_ms: clamp(source.image_timeout_ms ?? base.image_timeout_ms, 5000, 600000, DEFAULT_SETTINGS.image_timeout_ms),
    max_download_bytes: clamp(source.max_download_bytes ?? base.max_download_bytes, 1048576, 134217728, DEFAULT_SETTINGS.max_download_bytes),
    max_base64_bytes: clamp(source.max_base64_bytes ?? base.max_base64_bytes, 1048576, 134217728, DEFAULT_SETTINGS.max_base64_bytes),
    allow_localhost: source.allow_localhost === true,
    image_size: text(source.image_size, base.image_size || DEFAULT_SETTINGS.image_size),
  }
}

export function resolveApiKey(secret, env = process.env) {
  const fromEnv = env && (env.REPLICA_API_KEY || env.OPENAI_API_KEY)
  if (fromEnv && String(fromEnv).trim()) return { key: String(fromEnv).trim(), source: 'env' }
  const stored = secret && typeof secret === 'object' ? secret.api_key : secret
  if (stored && String(stored).trim()) return { key: String(stored).trim(), source: 'secrets' }
  return { key: '', source: 'none' }
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

async function postJson({ url, apiKey, body, signal, fetchImpl }) {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
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

function imagePart(url) {
  return { type: 'image_url', image_url: { url } }
}

export async function callVision({ settings, apiKey, prompt, images = [], fetchImpl = fetch, timeoutMs }) {
  if (!apiKey) throw new RelayError('provider-missing', '尚未配置 API Key')
  const url = `${settings.base_url}${settings.paths.chat}`
  const content = [{ type: 'text', text: String(prompt) }, ...images.map(imagePart)]
  const body = {
    model: settings.models.vision,
    temperature: 0,
    messages: [{ role: 'user', content }],
  }
  const result = await requestWithTimeout(
    signal => postJson({ url, apiKey, body, signal, fetchImpl }),
    Number(timeoutMs) || settings.timeout_ms,
  )
  const json = result.json
  const message = json && json.choices && json.choices[0] && json.choices[0].message
  let answer = ''
  if (message) {
    if (typeof message.content === 'string') answer = message.content
    else if (Array.isArray(message.content)) {
      answer = message.content.map(part => (typeof part === 'string' ? part : part && (part.text || '')) || '').join('')
    }
  }
  if (!answer) throw new RelayError('image-parse-failed', '视觉接口没有返回可用的文本内容')
  return { text: answer, raw: json, usage: (json && json.usage) || null }
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
  const limit = Number(maxBytes) || DEFAULT_SETTINGS.max_download_bytes
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

export async function generateImage({
  settings,
  apiKey,
  prompt,
  size,
  referenceImages = [],
  fetchImpl = fetch,
  timeoutMs,
}) {
  if (!apiKey) throw new RelayError('provider-missing', '尚未配置 API Key')
  const ms = Number(timeoutMs) || settings.image_timeout_ms
  const outputSize = size || settings.image_size
  const parsed = await requestWithTimeout(async signal => {
    if (settings.protocols.image === 'openai_chat') {
      const url = `${settings.base_url}${settings.paths.chat}`
      const content = [{ type: 'text', text: prompt }, ...referenceImages.map(img => imagePart(img.dataUrl))]
      const body = {
        model: settings.models.image || settings.models.vision,
        messages: [{ role: 'user', content }],
      }
      const result = await postJson({ url, apiKey, body, signal, fetchImpl })
      return parseImageResponse(result.json || result.text)
    }
    if (referenceImages.length > 0) {
      const url = `${settings.base_url}${settings.paths.edits}`
      const form = new FormData()
      form.append('model', settings.models.edit || settings.models.image)
      form.append('prompt', prompt)
      form.append('size', outputSize)
      form.append('n', '1')
      referenceImages.forEach((img, index) => {
        const mime = img.mime || 'image/png'
        const blob = new Blob([Buffer.from(String(img.base64 || ''), 'base64')], { type: mime })
        form.append('image', blob, img.name || `reference-${index + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`)
      })
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      })
      const raw = Buffer.from(await response.arrayBuffer())
      if (!response.ok) {
        const mapped = HTTP_CODES[response.status]
        const payload = raw.toString('utf8')
        throw new RelayError(mapped || 'provider-error', statusMessage(mapped || 'provider-error', response.status, payload), { detail: { upstream_status: response.status } })
      }
      return parseImageResponse(raw.toString('utf8'))
    }
    const url = `${settings.base_url}${settings.paths.images}`
    const body = {
      model: settings.models.image,
      prompt,
      size: outputSize,
      n: 1,
      response_format: 'b64_json',
    }
    const result = await postJson({ url, apiKey, body, signal, fetchImpl })
    return parseImageResponse(result.json || result.text)
  }, ms)

  if (parsed.kind === 'url') {
    const downloaded = await downloadImage(parsed.value, {
      maxBytes: settings.max_download_bytes,
      fetchImpl,
      timeoutMs: ms,
      allowLocalhost: settings.allow_localhost,
    })
    return { bytes: downloaded.buffer, mime: downloaded.mime, source: parsed.source }
  }
  const buffer = decodeBase64(parsed.value, settings.max_base64_bytes)
  const mime = sniffMime(buffer)
  if (!mime) throw new RelayError('image-parse-failed', '返回的 Base64 不是图片数据')
  return { bytes: buffer, mime, source: parsed.source }
}

/** One explicit, paid test request (文档 §5 能力设置). */
export async function testProvider({ settings, apiKey, kind = 'vision', fetchImpl = fetch }) {
  if (!apiKey) throw new RelayError('provider-missing', '尚未配置 API Key')
  if (kind === 'image') {
    const result = await generateImage({
      settings,
      apiKey,
      prompt: 'a plain light grey studio backdrop with a soft top light, no product, no text',
      size: settings.image_size,
      fetchImpl,
    })
    return { ok: true, kind, bytes: result.bytes.length, mime: result.mime, source: result.source }
  }
  const result = await callVision({
    settings,
    apiKey,
    prompt: 'Reply with JSON only: {"ok":true}',
    images: [],
    fetchImpl,
  })
  return { ok: true, kind, text: shorten(result.text, 200) }
}
