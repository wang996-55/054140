/**
 * Host half of the Personal Workbench bundle.
 *
 * Serves same-origin JSON routes under /api/personal-workbench so the Client
 * page can talk to OpenAI-compatible image APIs (and the harness LLM for vision
 * helpers) without CORS problems and without exposing the API key to the browser:
 *
 *   GET  /health            -> liveness + resolved paths
 *   GET  /settings          -> settings (keys masked)
 *   POST /settings          -> save settings
 *   POST /test              -> probe the configured image API
 *   POST /models            -> model discovery on one profile
 *   POST /generate          -> text-to-image / image-to-image, saves files
 *   POST /extract           -> product key-element extraction (vision)
 *   POST /extract-size      -> size-chart table recognition (vision)
 *   GET  /history           -> recent generated files
 *   GET  /image             -> serve one generated file
 *   GET/POST/DELETE /ref/model, /ref/scene, /ref/logo -> single persisted ref
 *   GET/POST/DELETE /ref/products                    -> persisted product ref set
 *   GET  /ref-image         -> serve a persisted reference image
 *   POST /reveal            -> open the output folder
 */
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

const PREFIX = '/api/personal-workbench'

export const inject = ['webServer']

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-image-1'
const DEFAULT_SIZE = '2048x2048'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function profileRoot() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv && fromEnv.trim()) return fromEnv
  return path.join(os.homedir(), '.dsh')
}

function settingsFile() {
  return path.join(profileRoot(), 'personal-workbench', 'settings.json')
}

function defaultOutputDir() {
  const home = os.homedir()
  return path.join(home, 'Pictures', 'DSH-Workbench')
}

const DEFAULT_PROFILE_NAME = '默认接口'

function newProfileId() {
  return `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function defaults() {
  return {
    version: 2,
    activeId: '',
    outputDir: defaultOutputDir(),
    profiles: [],
  }
}

function normalizeProfile(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    id: typeof source.id === 'string' && source.id ? source.id : newProfileId(),
    name: String(source.name || '').trim() || DEFAULT_PROFILE_NAME,
    baseUrl: normalizeBaseUrl(source.baseUrl || DEFAULT_BASE_URL),
    model: String(source.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
    size: String(source.size || DEFAULT_SIZE).trim() || DEFAULT_SIZE,
    quality: String(source.quality || '').trim(),
  }
}

/**
 * Accepts both the current multi-profile shape (v2) and the earlier flat
 * single-endpoint shape (v1), so an existing settings.json keeps working.
 */
function migrateSettings(raw) {
  const base = defaults()
  if (!raw || typeof raw !== 'object') {
    const profile = normalizeProfile({})
    return { ...base, activeId: profile.id, profiles: [profile] }
  }
  const outputDir = typeof raw.outputDir === 'string' && raw.outputDir.trim()
    ? path.resolve(raw.outputDir.trim())
    : base.outputDir
  if (Array.isArray(raw.profiles) && raw.profiles.length > 0) {
    const profiles = raw.profiles.map(normalizeProfile)
    const activeId = profiles.some(profile => profile.id === raw.activeId) ? raw.activeId : profiles[0].id
    return { version: 2, activeId, outputDir, profiles }
  }
  const profile = normalizeProfile({
    name: DEFAULT_PROFILE_NAME,
    baseUrl: raw.baseUrl,
    model: raw.model,
    apiKey: raw.apiKey,
    size: raw.size,
    quality: raw.quality,
  })
  return { version: 2, activeId: profile.id, outputDir, profiles: [profile] }
}

function activeProfile(settings) {
  const list = Array.isArray(settings.profiles) && settings.profiles.length > 0 ? settings.profiles : []
  if (list.length === 0) return normalizeProfile({})
  return list.find(profile => profile.id === settings.activeId) || list[0]
}

function publicProfile(profile) {
  const apiKey = typeof profile.apiKey === 'string' ? profile.apiKey : ''
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    size: profile.size,
    quality: profile.quality,
    hasApiKey: apiKey.length > 0,
    apiKeyTail: apiKey.length >= 4 ? apiKey.slice(-4) : '',
  }
}

function publicSettings(settings) {
  const active = activeProfile(settings)
  const activePublic = publicProfile(active)
  return {
    activeId: active.id,
    outputDir: settings.outputDir,
    profiles: settings.profiles.map(publicProfile),
    active: activePublic,
    // Mirrors of the active profile keep older views working.
    name: activePublic.name,
    baseUrl: activePublic.baseUrl,
    model: activePublic.model,
    size: activePublic.size,
    quality: activePublic.quality,
    hasApiKey: activePublic.hasApiKey,
    apiKeyTail: activePublic.apiKeyTail,
  }
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8')
    const parsed = JSON.parse(raw)
    return migrateSettings(parsed)
  } catch {
    return migrateSettings(undefined)
  }
}

async function writeSettings(next) {
  const file = settingsFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: String(message || 'unknown error') })
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 96 * 1024 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw)
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('timeout')), ms).unref?.()
  return controller.signal
}

function trim(text, max) {
  const value = String(text || '')
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim().replace(/\/+$/, '')
  if (!value) return DEFAULT_BASE_URL
  return value
}

function extensionFor(buffer, contentType) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png'
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  const type = String(contentType || '').toLowerCase()
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg'
  if (type.includes('webp')) return '.webp'
  return '.png'
}

function stamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function saveImageBuffer(outputDir, buffer, contentType, index) {
  const ext = extensionFor(buffer, contentType)
  const suffix = Math.random().toString(36).slice(2, 6)
  const name = `model-${stamp()}-${index + 1}-${suffix}${ext}`
  const file = path.join(outputDir, name)
  await fs.writeFile(file, buffer)
  return name
}

function parseImageResponse(text, status, ok) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    if (!ok) throw new Error(`接口返回 ${status}：${trim(text, 400)}`)
    throw new Error(`接口返回了非 JSON 内容：${trim(text, 400)}`)
  }
  if (!ok) {
    const detail = json && (json.error?.message || json.message || json.msg)
    throw new Error(`接口返回 ${status}：${trim(detail || text, 400)}`)
  }
  const data = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.images)
      ? json.images
      : Array.isArray(json?.output)
        ? json.output
        : Array.isArray(json?.result)
          ? json.result
          : []
  if (data.length === 0) throw new Error(`接口未返回图片：${trim(text, 400)}`)
  return data
}

async function callImagesApi(settings, prompt, size, modelOverride) {
  const apiKey = String(settings.apiKey || '').trim()
  if (!apiKey) throw new Error('尚未配置 API Key，请在工作台「设置」中填写')

  const base = normalizeBaseUrl(settings.baseUrl)
  const endpoint = `${base}/images/generations`
  const model = String(modelOverride || settings.model || DEFAULT_MODEL).trim()
  const payload = {
    model,
    prompt,
    n: 1,
    size: String(size || settings.size || DEFAULT_SIZE),
  }
  const quality = String(settings.quality || '').trim()
  if (quality) payload.quality = quality

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: timeoutSignal(240000),
    })
  } catch (error) {
    throw new Error(`请求 ${endpoint} 失败：${error && error.message ? error.message : error}`)
  }

  const text = await response.text()
  return { data: parseImageResponse(text, response.status, response.ok), endpoint, model }
}

function buildEditForm(settings, prompt, size, model, references, strategy) {
  const quality = String(settings.quality || '').trim()
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('n', '1')
  form.append('size', String(size || settings.size || DEFAULT_SIZE))
  if (quality) form.append('quality', quality)
  const multiple = references.length > 1
  const field = strategy === 'alternate'
    ? (multiple ? 'image' : 'image[]')
    : (multiple ? 'image[]' : 'image')
  for (const reference of references) {
    form.append(field, new Blob([reference.buffer], { type: reference.mediaType }), reference.name)
  }
  return form
}

/**
 * Image-to-image through the OpenAI-compatible `/images/edits` endpoint.
 * Reference images (model sheet, product photo) are sent as multipart/form-data;
 * gateways disagree on the field spelling (`image` vs `image[]`), so a failed
 * first attempt is retried once with the other spelling before reporting.
 */
async function callImageEditApi(settings, prompt, size, references, modelOverride) {
  const apiKey = String(settings.apiKey || '').trim()
  if (!apiKey) throw new Error('尚未配置 API Key，请在工作台「设置」中填写')

  const base = normalizeBaseUrl(settings.baseUrl)
  const endpoint = `${base}/images/edits`
  const model = String(modelOverride || settings.model || DEFAULT_MODEL).trim()
  const headers = { authorization: `Bearer ${apiKey}` }

  const attempt = async strategy => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: buildEditForm(settings, prompt, size, model, references, strategy),
      signal: timeoutSignal(240000),
    })
    const text = await response.text()
    return { response, text }
  }

  let result
  try {
    result = await attempt('default')
    if (!result.response.ok && result.response.status >= 400 && result.response.status < 500) {
      const retry = await attempt('alternate')
      if (retry.response.ok) result = retry
    }
  } catch (error) {
    throw new Error(`请求 ${endpoint} 失败：${error && error.message ? error.message : error}`)
  }

  return {
    data: parseImageResponse(result.text, result.response.status, result.response.ok),
    endpoint,
    model,
  }
}

function normalizeReference(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const base64 = String(raw.dataBase64 || '').trim()
  if (!base64) return undefined
  let mediaType = String(raw.mediaType || 'image/png').toLowerCase()
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(mediaType)) mediaType = 'image/png'
  if (mediaType === 'image/jpg') mediaType = 'image/jpeg'
  const extension = mediaType.includes('jpeg') || mediaType.includes('jpg') ? '.jpg' : mediaType.includes('webp') ? '.webp' : '.png'
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) return undefined
  if (buffer.length > 12 * 1024 * 1024) throw new Error('参考图过大（上限 12MB）')
  const base = String(raw.name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const name = `${base || 'reference'}${extension}`
  return { buffer, mediaType, name, originalName: String(raw.name || '').slice(0, 80) }
}

// -------------------------------------------- product key-element extraction
// Uses the harness LLM (the model selected for this workbench) to read the
// uploaded product photos and return the structured design elements that make up
// the product description. Images are admitted through the attachment service
// first, so the provider receives normalized references rather than raw base64.
const EXTRACT_LABELS = [
  '颜色',
  '面料材质',
  '整体版型',
  '尺寸比例',
  '腰头结构',
  '门襟结构',
  '口袋结构',
  '缝线与拼接',
  '水洗与磨损',
  '特殊设计',
  '裤腿与裤脚',
  '结构相对位置',
]

const EXTRACT_SYSTEM = '你是一名资深服装与电商商品结构分析专家。你只根据用户上传的商品参考图客观提取商品自身的设计要素；看不清的内容必须写“无法判断”，绝对不要臆测或编造。'

const SIZE_EXTRACT_SYSTEM = '你是一名电商尺码表识别助手。你必须只读取用户上传图片中真实存在的尺码表内容，数值必须与图片一致；无法确认的数值用 null，绝对不能编造。'

function sizeExtractInstruction() {
  return [
    '请精确读取这张电商尺码表图片，并输出严格的 JSON（不要 markdown 代码块、不要解释）：',
    '{"columns":["腰围","臀围","裤长"],"rows":[{"size":"S","values":{"腰围":72,"臀围":98,"裤长":104}}]}',
    '要求：',
    '1. columns 是表头中的部位名称，去掉单位（如“腰围（cm）”只保留“腰围”）；不要添加图片中没有的列。',
    '2. rows 按图片从上到下的顺序；size 为尺码名称（如 S、M、L、XL、2XL、3XL）。',
    '3. values 的键与 columns 完全一致，值为数字（保留小数）；无法识别的写成 null。',
    '4. 只输出 JSON。',
  ].join('\n')
}

function extractInstruction() {
  return [
    '请分析这些商品参考图（可能是同一商品的多角度图或细节图），提取该商品的关键设计元素，用于生成电商模特图的商品描述。',
    '输出要求：',
    '1. 只描述商品本身，不要描述模特、人物、背景、构图、光线或拍摄效果。',
    '2. 严格按下面 12 个维度逐行输出，每行格式为「维度：描述」，不要编号、不要多余说明：',
    ...EXTRACT_LABELS,
    '3. 颜色要具体（如“黑色水洗做旧”“米白色”）；面料写材质与质感；版型与尺寸比例写宽松程度、轮廓、长短等。',
    '4. 看不清或没有把握的维度写「无法判断」，绝对不要编造。',
    '5. 如果商品不是裤装，请按实际品类替换第 5~11 项的维度名称（如裙装可写“腰头结构 / 裙门襟 / 裙摆结构”等），其余维度保持。',
  ].join('\n')
}

function cleanExtractedText(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const isDimensionLine = line => EXTRACT_LABELS.some(label => line.startsWith(label)) || /^[\u4e00-\u9fa5A-Za-z]+：/.test(line)
  const start = lines.findIndex(isDimensionLine)
  const body = start > 0 ? lines.slice(start) : lines
  return body.join('\n').trim()
}

async function extractTextWithModel(ctx, references, instruction, system, maxTokens) {
  // Optional capabilities: the workbench still works without them, only the
  // vision extraction needs the harness LLM + attachment store.
  const llm = ctx.get ? ctx.get('llm') : ctx.llm
  const attachments = ctx.get ? ctx.get('attachments') : ctx.attachments
  const defaultModel = ctx.get ? ctx.get('agentDefaultModel') : ctx.agentDefaultModel
  if (!llm || !attachments || !defaultModel) {
    throw new Error('当前 Harness 未提供视觉分析能力')
  }

  const selection = defaultModel.currentSelection()
  const provider = String((selection && selection.provider) || '')
  const model = String((selection && selection.model) || '')
  if (!provider || !model) throw new Error('未找到可用的默认模型')

  try {
    const info = await llm.resolveModelInfo(provider, model)
    const modalities = info && Array.isArray(info.inputModalities) ? info.inputModalities : null
    if (modalities && modalities.indexOf('image') < 0) {
      throw new Error(`当前默认模型 ${model} 不支持图片输入`)
    }
  } catch (error) {
    // A capability lookup failure is not fatal; the actual call will report it.
    if (String(error && error.message).includes('不支持图片输入')) throw error
  }

  const saved = await attachments.saveImages(
    references.map(reference => ({
      data: new Uint8Array(reference.buffer),
      mediaType: reference.mediaType,
      name: reference.name,
    })),
  )

  const content = [
    { type: 'text', text: instruction },
    ...saved.map(attachment => ({ type: 'image', attachment })),
  ]

  let text = ''
  let failure = null
  let truncated = false
  const stream = llm.stream({
    provider,
    model,
    system,
    messages: [{ role: 'user', content }],
    maxTokens,
    signal: timeoutSignal(180000),
  })
  for await (const chunk of stream) {
    if (!chunk) continue
    if (chunk.type === 'text-delta') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      const reason = chunk.reason || {}
      if (reason.kind === 'error' || reason.kind === 'aborted') failure = reason.failure
      if (reason.kind === 'max-tokens') truncated = true
    }
  }
  if (failure) {
    const detail = failure.message
      ? `${failure.message}${failure.status ? ` (HTTP ${failure.status})` : ''}`
      : '提取失败'
    throw new Error(detail)
  }
  if (truncated) throw new Error('提取结果被截断，请重试')
  return { text, provider, model, imageCount: saved.length }
}

async function extractKeyElements(ctx, references) {
  const result = await extractTextWithModel(ctx, references, extractInstruction(), EXTRACT_SYSTEM, 8000)
  const cleaned = cleanExtractedText(result.text)
  if (!cleaned) throw new Error('模型没有返回可用的提取结果，请换一张更清晰的商品图重试')
  return { ...result, text: cleaned }
}

function parseSizeTableText(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let json
  try {
    json = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const rawColumns = Array.isArray(json.columns) ? json.columns : []
  const columns = []
  const seen = new Set()
  for (const item of rawColumns) {
    const name = typeof item === 'string'
      ? item.trim()
      : (item && typeof item.name === 'string' ? item.name.trim() : '')
    if (!name || seen.has(name) || columns.length >= 8) continue
    seen.add(name)
    columns.push({ key: `c${columns.length}`, name: name.slice(0, 12) })
  }
  const rawRows = Array.isArray(json.rows) ? json.rows : []
  const rows = []
  for (const item of rawRows) {
    if (!item || typeof item !== 'object') continue
    const size = String(item.size !== undefined ? item.size : (item.label !== undefined ? item.label : '')).trim()
    if (!size) continue
    const source = item.values && typeof item.values === 'object' ? item.values : item
    const values = {}
    for (const column of columns) {
      const rawValue = source[column.name]
      const numeric = typeof rawValue === 'number'
        ? rawValue
        : Number(String(rawValue === undefined || rawValue === null ? '' : rawValue).replace(/[^\d.-]/g, ''))
      values[column.key] = Number.isFinite(numeric) ? numeric : null
    }
    rows.push({ size: size.slice(0, 12), values })
    if (rows.length >= 12) break
  }
  if (columns.length === 0 || rows.length === 0) return null
  return { columns, rows }
}

async function extractSizeTable(ctx, references) {
  const result = await extractTextWithModel(ctx, references, sizeExtractInstruction(), SIZE_EXTRACT_SYSTEM, 8000)
  const parsed = parseSizeTableText(result.text)
  if (!parsed) throw new Error('未能从图片中识别出尺码表，请换一张更清晰、完整的表格截图')
  return { ...result, columns: parsed.columns, rows: parsed.rows }
}



function collectModelIds(json) {
  const ids = []
  const seen = new Set()
  const push = value => {
    if (typeof value !== 'string') return
    const id = value.trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : []
  for (const row of rows) {
    if (typeof row === 'string') {
      push(row)
    } else if (row && typeof row === 'object') {
      push(row.id)
      push(row.name)
      push(row.model)
    }
  }
  return ids
}

/**
 * One-click model discovery: probes an OpenAI-compatible `GET {baseUrl}/models`
 * with the draft (unsaved) endpoint/key first, falling back to saved settings.
 */
async function fetchModelIds(settings, override) {
  const base = normalizeBaseUrl((override && override.baseUrl) || settings.baseUrl)
  const apiKey = String((override && override.apiKey) || settings.apiKey || '').trim()
  if (!apiKey) throw new Error('尚未配置 API Key，请先填写 Key（保存前也可拉取）')
  const endpoint = `${base}/models`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: timeoutSignal(20000),
    })
  } catch (error) {
    throw new Error(`请求 ${endpoint} 失败：${error && error.message ? error.message : error}`)
  }
  const text = await response.text()
  if (!response.ok) {
    let detail = text
    try {
      const parsed = JSON.parse(text)
      detail = parsed?.error?.message || parsed?.message || parsed?.msg || text
    } catch {
      // keep the raw text
    }
    throw new Error(`接口返回 ${response.status}：${trim(detail, 300)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`接口返回了非 JSON 内容：${trim(text, 300)}`)
  }
  const ids = collectModelIds(json)
  if (ids.length === 0) throw new Error(`接口未返回可用模型：${trim(text, 300)}`)
  return { ids, endpoint, base }
}

async function generateImages(settings, body) {
  const startedAt = Date.now()
  const prompt = String(body.prompt || '').trim()
  if (!prompt) throw new Error('提示词不能为空')
  const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
  // A queued job remembers which API profile it was submitted with; fall back to
  // the current profile when that id no longer exists.
  const submittedProfile = body.profileId
    ? settings.profiles.find(item => item.id === body.profileId)
    : undefined
  const profile = submittedProfile || activeProfile(settings)
  await fs.mkdir(outputDir, { recursive: true })

  const references = []
  const collect = value => {
    const normalized = normalizeReference(value)
    if (normalized) references.push(normalized)
  }
  if (Array.isArray(body.references)) for (const item of body.references) collect(item)
  if (body.reference) collect(body.reference)
  if (references.length > 8) throw new Error('参考图最多 8 张')

  const providerStartedAt = Date.now()
  const { data, endpoint, model } = references.length > 0
    ? await callImageEditApi(profile, prompt, body.size, references, body.model)
    : await callImagesApi(profile, prompt, body.size, body.model)
  const providerMs = Date.now() - providerStartedAt

  // Persist every returned image concurrently: b64 payloads decode locally while
  // URL payloads download in parallel, then files are written in parallel.
  const saveStartedAt = Date.now()
  const saved = await Promise.all(data.map(async (entry, index) => {
    const item = typeof entry === 'string' ? { url: entry } : (entry || {})
    let buffer = null
    let contentType = ''
    if (typeof item.b64_json === 'string' && item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64')
    } else if (typeof item.url === 'string' && item.url) {
      let imageUrl = item.url
      if (!/^https?:/i.test(imageUrl) && !/^data:/i.test(imageUrl)) {
        try {
          imageUrl = new URL(imageUrl, `${normalizeBaseUrl(profile.baseUrl)}/`).toString()
        } catch {
          // keep the raw value; fetch will report the failure below
        }
      }
      const imageResponse = await fetch(imageUrl, { signal: timeoutSignal(120000) })
      if (!imageResponse.ok) throw new Error(`下载生成图片失败：${imageResponse.status}`)
      contentType = imageResponse.headers.get('content-type') || ''
      buffer = Buffer.from(await imageResponse.arrayBuffer())
    } else {
      return null
    }
    if (!buffer || buffer.length === 0) return null
    const name = await saveImageBuffer(outputDir, buffer, contentType, index)
    return {
      name,
      url: `${PREFIX}/image?name=${encodeURIComponent(name)}`,
      size: buffer.length,
    }
  }))
  const items = saved.filter(Boolean)
  if (items.length === 0) throw new Error('接口返回成功，但没有可用的图片数据')
  const saveMs = Date.now() - saveStartedAt
  return {
    ok: true,
    items,
    model,
    endpoint,
    outputDir,
    mode: references.length > 0 ? 'edit' : 'generate',
    referenceCount: references.length,
    profile: { id: profile.id, name: profile.name },
    timings: { providerMs, saveMs, totalMs: Date.now() - startedAt },
  }
}

async function listHistory(settings, limit) {
  const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
  let names = []
  try {
    names = await fs.readdir(outputDir)
  } catch {
    return { outputDir, total: 0, items: [] }
  }
  const rows = []
  for (const name of names) {
    if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) continue
    const file = path.join(outputDir, name)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile()) continue
      rows.push({ name, size: stat.size, mtime: stat.mtimeMs })
    } catch {
      // file vanished between readdir and stat; ignore
    }
  }
  rows.sort((a, b) => b.mtime - a.mtime)
  const items = rows.slice(0, Math.max(1, Math.min(200, limit || 60))).map(row => ({
    ...row,
    url: `${PREFIX}/image?name=${encodeURIComponent(row.name)}`,
  }))
  return { outputDir, total: rows.length, items }
}

function resolveImagePath(outputDir, rawName) {
  const name = path.basename(String(rawName || ''))
  if (!name || !IMAGE_EXT.has(path.extname(name).toLowerCase())) return undefined
  const resolved = path.resolve(outputDir, name)
  const root = path.resolve(outputDir)
  if (resolved !== path.join(root, name)) return undefined
  return resolved
}

async function serveImage(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const settings = await readSettings()
  const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
  const file = resolveImagePath(outputDir, url.searchParams.get('name'))
  if (!file) return sendError(res, 400, 'invalid image name')
  let buffer
  try {
    buffer = await fs.readFile(file)
  } catch {
    return sendError(res, 404, 'image not found')
  }
  const ext = path.extname(file).toLowerCase()
  const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  res.end(buffer)
}

// ------------------------------------------------- persisted reference images
// References that should survive page reloads are written to
// <profile>/personal-workbench/refs/ and served back through /ref-image:
//   model -> model-sheet.<ext>  (four-view turnaround of the model)
//   scene -> scene.<ext>        (background the user keeps reusing)
//   logo  -> logo.<ext>         (brand logo used by the size-chart poster)
const REF_KINDS = {
  model: { base: 'model-sheet', pattern: /^model-sheet\.(png|jpe?g|webp)$/i },
  scene: { base: 'scene', pattern: /^scene\.(png|jpe?g|webp)$/i },
  logo: { base: 'logo', pattern: /^logo\.(png|jpe?g|webp)$/i },
}

function refKind(kind) {
  return REF_KINDS[String(kind || '')] || null
}

function profileRefsDir() {
  return path.join(profileRoot(), 'personal-workbench', 'refs')
}

function refMediaTypeFor(name) {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

async function listRefFiles(kind) {
  const definition = refKind(kind)
  if (!definition) return []
  try {
    return (await fs.readdir(profileRefsDir())).filter(name => definition.pattern.test(name))
  } catch {
    return []
  }
}

async function readRef(kind) {
  const files = await listRefFiles(kind)
  if (files.length === 0) return null
  const name = files[0]
  return {
    name,
    mediaType: refMediaTypeFor(name),
    url: `${PREFIX}/ref-image?name=${encodeURIComponent(name)}`,
  }
}

async function writeRef(kind, buffer, mediaType) {
  const definition = refKind(kind)
  if (!definition) throw new Error('unknown reference kind')
  const dir = profileRefsDir()
  await fs.mkdir(dir, { recursive: true })
  for (const name of await listRefFiles(kind)) {
    await fs.rm(path.join(dir, name), { force: true })
  }
  const name = `${definition.base}${extensionFor(buffer, mediaType)}`
  await fs.writeFile(path.join(dir, name), buffer)
  return {
    name,
    mediaType: refMediaTypeFor(name),
    url: `${PREFIX}/ref-image?name=${encodeURIComponent(name)}`,
  }
}

async function deleteRef(kind) {
  const dir = profileRefsDir()
  for (const name of await listRefFiles(kind)) {
    await fs.rm(path.join(dir, name), { force: true })
  }
}

// ------------------------------------------------- persisted product refs
// Product reference photos are a numbered set (product-0.ext ... product-N.ext)
// so they survive reloads until the user removes them.
const PRODUCT_REF_PATTERN = /^product-\d+\.(png|jpe?g|webp)$/i
const PRODUCT_REF_LIMIT = 4
const PRODUCT_REF_META = 'products.json'

async function listProductRefFiles() {
  try {
    const names = await fs.readdir(profileRefsDir())
    return names
      .filter(name => PRODUCT_REF_PATTERN.test(name))
      .sort((left, right) => {
        const leftIndex = Number((left.match(/-(\d+)\./) || [])[1] || 0)
        const rightIndex = Number((right.match(/-(\d+)\./) || [])[1] || 0)
        return leftIndex - rightIndex
      })
  } catch {
    return []
  }
}

async function readProductRefMeta() {
  try {
    const raw = await fs.readFile(path.join(profileRefsDir(), PRODUCT_REF_META), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function productRefItems(names, meta) {
  const displayNames = new Map()
  for (const row of meta || []) {
    if (row && typeof row.file === 'string' && typeof row.name === 'string') {
      displayNames.set(row.file, row.name)
    }
  }
  return names.map(name => ({
    name: displayNames.get(name) || name,
    file: name,
    mediaType: refMediaTypeFor(name),
    url: `${PREFIX}/ref-image?name=${encodeURIComponent(name)}`,
  }))
}

async function readProductRefs() {
  return productRefItems(await listProductRefFiles(), await readProductRefMeta())
}

async function writeProductRefs(references) {
  const dir = profileRefsDir()
  await fs.mkdir(dir, { recursive: true })
  for (const name of await listProductRefFiles()) {
    await fs.rm(path.join(dir, name), { force: true })
  }
  const written = []
  const meta = []
  for (let index = 0; index < references.length && index < PRODUCT_REF_LIMIT; index += 1) {
    const reference = references[index]
    const name = `product-${index}${extensionFor(reference.buffer, reference.mediaType)}`
    await fs.writeFile(path.join(dir, name), reference.buffer)
    written.push(name)
    meta.push({ file: name, name: reference.originalName || reference.name })
  }
  if (meta.length > 0) {
    await fs.writeFile(path.join(dir, PRODUCT_REF_META), JSON.stringify(meta), 'utf8')
  } else {
    await fs.rm(path.join(dir, PRODUCT_REF_META), { force: true })
  }
  return productRefItems(written, meta)
}

async function deleteProductRefs() {
  const dir = profileRefsDir()
  for (const name of await listProductRefFiles()) {
    await fs.rm(path.join(dir, name), { force: true })
  }
  await fs.rm(path.join(dir, PRODUCT_REF_META), { force: true })
}

async function serveRefImage(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const name = path.basename(String(url.searchParams.get('name') || ''))
  const allowed = PRODUCT_REF_PATTERN.test(name)
    || Object.keys(REF_KINDS).some(kind => REF_KINDS[kind].pattern.test(name))
  if (!allowed) return sendError(res, 400, 'invalid ref name')
  let buffer
  try {
    buffer = await fs.readFile(path.join(profileRefsDir(), name))
  } catch {
    return sendError(res, 404, 'ref not found')
  }
  res.statusCode = 200
  res.setHeader('content-type', refMediaTypeFor(name))
  res.setHeader('cache-control', 'no-store')
  res.end(buffer)
}

/**
 * GET/POST/DELETE for one persisted reference kind ('model' or 'scene').
 */
function makeRefHandler(kind) {
  return async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase()
    if (method === 'GET') {
      const item = await readRef(kind)
      return sendJson(res, 200, { ok: true, item })
    }
    if (method === 'DELETE') {
      await deleteRef(kind)
      return sendJson(res, 200, { ok: true })
    }
    const body = await readJsonBody(req)
    const reference = normalizeReference(body)
    if (!reference) return sendError(res, 400, '参考图为空')
    const item = await writeRef(kind, reference.buffer, reference.mediaType)
    sendJson(res, 200, { ok: true, item })
  }
}

function openFolder(dir) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' })
      child.unref()
      return true
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}

function createHandlers(ctx) {
  const handlers = {
    async health(req, res) {
      const settings = await readSettings()
      const active = activeProfile(settings)
      sendJson(res, 200, {
        ok: true,
        settingsFile: settingsFile(),
        outputDir: path.resolve(String(settings.outputDir || defaultOutputDir())),
        hasApiKey: publicProfile(active).hasApiKey,
        activeProfile: { id: active.id, name: active.name, model: active.model },
        profileCount: settings.profiles.length,
        platform: process.platform,
        node: process.version,
      })
    },

    async getSettings(req, res) {
      sendJson(res, 200, { ok: true, settings: publicSettings(await readSettings()) })
    },

    async settingsRoute(req, res) {
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'POST' || method === 'PUT') return handlers.postSettings(req, res)
      return handlers.getSettings(req, res)
    },

    async postSettings(req, res) {
      const body = await readJsonBody(req)
      const current = await readSettings()
      const next = {
        version: 2,
        activeId: current.activeId,
        outputDir: current.outputDir,
        profiles: current.profiles.map(profile => ({ ...profile })),
      }
      if (typeof body.outputDir === 'string' && body.outputDir.trim()) {
        next.outputDir = path.resolve(body.outputDir.trim())
      }

      if (Array.isArray(body.profiles)) {
        const existing = new Map(current.profiles.map(profile => [profile.id, profile]))
        const merged = []
        for (const raw of body.profiles) {
          if (!raw || typeof raw !== 'object') continue
          const id = typeof raw.id === 'string' && raw.id ? raw.id : newProfileId()
          const previous = existing.get(id) || {}
          const profile = normalizeProfile({
            id,
            name: raw.name !== undefined ? raw.name : previous.name,
            baseUrl: raw.baseUrl !== undefined ? raw.baseUrl : previous.baseUrl,
            model: raw.model !== undefined ? raw.model : previous.model,
            size: raw.size !== undefined ? raw.size : previous.size,
            quality: raw.quality !== undefined ? raw.quality : previous.quality,
            apiKey: previous.apiKey || '',
          })
          if (raw.clearApiKey === true) profile.apiKey = ''
          if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) profile.apiKey = raw.apiKey.trim()
          merged.push(profile)
        }
        if (merged.length > 0) {
          next.profiles = merged
          if (!merged.some(profile => profile.id === next.activeId)) next.activeId = merged[0].id
        }
      }

      if (typeof body.activeId === 'string' && body.activeId && next.profiles.some(profile => profile.id === body.activeId)) {
        next.activeId = body.activeId
      }

      // Backward compatibility for a page still posting flat single-endpoint fields.
      const flatKeys = ['baseUrl', 'model', 'size', 'quality', 'apiKey', 'clearApiKey']
      if (!Array.isArray(body.profiles) && flatKeys.some(key => key in body)) {
        const targetId = next.activeId
        next.profiles = next.profiles.map(profile => {
          if (profile.id !== targetId) return profile
          const updated = { ...profile }
          if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) updated.baseUrl = normalizeBaseUrl(body.baseUrl)
          if (typeof body.model === 'string' && body.model.trim()) updated.model = body.model.trim()
          if (typeof body.size === 'string' && body.size.trim()) updated.size = body.size.trim()
          if (typeof body.quality === 'string') updated.quality = body.quality.trim()
          if (body.clearApiKey === true) updated.apiKey = ''
          if (typeof body.apiKey === 'string' && body.apiKey.trim()) updated.apiKey = body.apiKey.trim()
          return updated
        })
      }

      await writeSettings(next)
      sendJson(res, 200, { ok: true, settings: publicSettings(next) })
    },

    async test(req, res) {
      const method = String(req.method || 'GET').toUpperCase()
      const body = method === 'GET' ? {} : await readJsonBody(req)
      const settings = await readSettings()
      const profile = (body.profileId && settings.profiles.find(item => item.id === body.profileId)) || activeProfile(settings)
      const base = normalizeBaseUrl(body.baseUrl || profile.baseUrl)
      const apiKey = String(body.apiKey || profile.apiKey || '').trim()
      if (!apiKey) return sendError(res, 400, '尚未配置 API Key（可先填写再测试，无需保存）')
      const endpoint = `${base}/models`
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}` },
          signal: timeoutSignal(20000),
        })
        const text = await response.text()
        if (!response.ok) return sendJson(res, 200, { ok: false, error: `HTTP ${response.status}: ${trim(text, 300)}` })
        sendJson(res, 200, { ok: true, endpoint, message: `${profile.name} · API Key 可用（/models 探测成功）` })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    },

    async models(req, res) {
      const method = String(req.method || 'GET').toUpperCase()
      const body = method === 'GET' ? {} : await readJsonBody(req)
      const settings = await readSettings()
      const profile = (body.profileId && settings.profiles.find(item => item.id === body.profileId)) || activeProfile(settings)
      const result = await fetchModelIds(profile, { baseUrl: body.baseUrl, apiKey: body.apiKey })
      sendJson(res, 200, { ok: true, ...result, profileId: profile.id })
    },

    refModel: makeRefHandler('model'),

    refScene: makeRefHandler('scene'),

    refLogo: makeRefHandler('logo'),

    async refProducts(req, res) {
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return sendJson(res, 200, { ok: true, items: await readProductRefs() })
      }
      if (method === 'DELETE') {
        await deleteProductRefs()
        return sendJson(res, 200, { ok: true, items: [] })
      }
      const body = await readJsonBody(req)
      const rawList = Array.isArray(body.references) ? body.references : []
      const references = []
      for (const raw of rawList) {
        const reference = normalizeReference(raw)
        if (reference && references.length < PRODUCT_REF_LIMIT) references.push(reference)
      }
      const items = await writeProductRefs(references)
      sendJson(res, 200, { ok: true, items })
    },

    async extract(req, res) {
      const body = await readJsonBody(req)
      const rawList = Array.isArray(body.references) ? body.references : []
      const references = []
      for (const raw of rawList) {
        const reference = normalizeReference(raw)
        if (reference && references.length < 4) references.push(reference)
      }
      if (references.length === 0) return sendError(res, 400, '请先上传商品参考图')
      sendJson(res, 200, { ok: true, ...(await extractKeyElements(ctx, references)) })
    },

    async extractSize(req, res) {
      const body = await readJsonBody(req)
      const rawList = Array.isArray(body.references) ? body.references : []
      const references = []
      for (const raw of rawList) {
        const reference = normalizeReference(raw)
        if (reference && references.length < 2) references.push(reference)
      }
      if (references.length === 0) return sendError(res, 400, '请先上传尺码表图片')
      sendJson(res, 200, { ok: true, ...(await extractSizeTable(ctx, references)) })
    },

    async generate(req, res) {
      const body = await readJsonBody(req)
      const settings = await readSettings()
      sendJson(res, 200, await generateImages(settings, body))
    },

    async history(req, res) {
      const url = new URL(req.url, 'http://127.0.0.1')
      const limit = Number(url.searchParams.get('limit') || 60)
      const settings = await readSettings()
      sendJson(res, 200, { ok: true, ...(await listHistory(settings, Number.isFinite(limit) ? limit : 60)) })
    },

    async reveal(req, res) {
      const settings = await readSettings()
      const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
      try {
        await fs.mkdir(outputDir, { recursive: true })
      } catch {
        // opening can still report the failure below
      }
      sendJson(res, 200, { ok: openFolder(outputDir), outputDir })
    },
  }
  return handlers
}

function wrap(handler) {
  return (req, res) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(error => {
        try {
          sendError(res, 500, error && error.message ? error.message : String(error))
        } catch {
          // response already finished
        }
      })
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const handlers = createHandlers(ctx)
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/health`, handler: wrap(handlers.health) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/settings`, handler: wrap(handlers.settingsRoute) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/test`, handler: wrap(handlers.test) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/models`, handler: wrap(handlers.models) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/generate`, handler: wrap(handlers.generate) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/extract`, handler: wrap(handlers.extract) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/extract-size`, handler: wrap(handlers.extractSize) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/history`, handler: wrap(handlers.history) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/image`, handler: wrap(serveImage) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/ref/model`, handler: wrap(handlers.refModel) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/ref/scene`, handler: wrap(handlers.refScene) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/ref/logo`, handler: wrap(handlers.refLogo) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/ref/products`, handler: wrap(handlers.refProducts) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/ref-image`, handler: wrap(serveRefImage) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/reveal`, handler: wrap(handlers.reveal) }),
    ]
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // idempotent cleanup
        }
      }
    }
  })
}
