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
 *                              (rejects a gateway that echoes a reference image
 *                              back instead of generating, retrying once first)
 *   POST /extract           -> product key-element extraction (vision)
 *   POST /extract-size      -> size-chart table recognition (vision)
 *   GET  /history           -> recent generated files
 *   GET  /image             -> serve one generated file
 *   GET/POST/DELETE /ref/model, /ref/scene, /ref/logo -> single persisted ref
 *   GET/POST/DELETE /ref/products                    -> persisted product ref set
 *   GET  /ref-image         -> serve a persisted reference image
 *   POST /reveal            -> open the output folder
 *   POST /poster            -> save a size-chart PNG into a chosen folder
 *
 * Every failure is answered as `{ ok: false, code, error }`: `code` is a stable
 * lowercase kebab-case identifier for the client, `error` is the human-readable
 * (Chinese) message.
 */
import { promises as fs, constants as fsConstants } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

const PREFIX = '/api/personal-workbench'

export const inject = ['webServer']

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-image-1'
const DEFAULT_SIZE = '2048x2048'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

// ---------------------------------------------------------- request size limits
// The old reader had one 96MB cap for every route, so even /settings or /models
// could be made to buffer 96MB (and then ~4x that while decoding) before failing.
// Each route now declares the body it can legitimately receive:
//   JSON_BODY_LIMIT            2MB  – settings / test / models / reveal (tiny JSON)
//   referenceJsonBodyLimit(n)  n reference images, base64-expanded (+1MB slack)
// On top of the body limit, reference images are bounded per image (12MB) and per
// request (64MB), so hitting a route directly cannot bypass what the page checks.
const JSON_BODY_LIMIT = 2 * 1024 * 1024
// Size-chart poster upload: 32MB of base64 text carries at most 24MB of PNG.
const POSTER_BODY_LIMIT = 32 * 1024 * 1024
const MAX_POSTER_BYTES = Math.floor((POSTER_BODY_LIMIT * 3) / 4)
const REFERENCE_MAX_BYTES = 12 * 1024 * 1024
const REFERENCE_MAX_TOTAL_BYTES = 64 * 1024 * 1024
const BASE64_EXPANSION = 4 / 3
const GENERATE_REF_LIMIT = 8
const EXTRACT_REF_LIMIT = 4
const EXTRACT_SIZE_REF_LIMIT = 2
// A prompt is counted in code points, so an emoji or any other surrogate pair
// counts once instead of twice. Well past any prompt the page builds (~4k).
const PROMPT_MAX_CHARS = 20000
// Upstream SSE guards: one un-terminated event block, and the whole response.
// The block cap must stay above the largest *legitimate* single event: a gateway
// that returns the finished image in one `completed` event sends the whole
// base64 in that block (a 2048px PNG is ~5-11MB of base64), so 8MB would reject
// real generations. 32MB keeps >3x headroom while still bounding a runaway block;
// the total cap bounds the whole response (16+ images worth).
const SSE_BLOCK_MAX_CHARS = 32 * 1024 * 1024
const SSE_TOTAL_MAX_CHARS = 64 * 1024 * 1024

/** Body limit for a route that accepts up to `count` base64 reference images. */
function referenceJsonBodyLimit(count) {
  const raw = Math.min(REFERENCE_MAX_TOTAL_BYTES, count * REFERENCE_MAX_BYTES)
  return Math.ceil(raw * BASE64_EXPANSION) + 1024 * 1024
}

function formatMegabytes(bytes) {
  return `${Math.round((Number(bytes) / (1024 * 1024)) * 10) / 10}MB`
}

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
    // Optional third-party vision endpoints used by "extract from product photos".
    // activeId '' (or an unknown id) means: use the Harness built-in model.
    vision: { activeId: '', profiles: [] },
  }
}

function newVisionProfileId() {
  return `v-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function normalizeVisionProfile(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    id: typeof source.id === 'string' && source.id ? source.id : newVisionProfileId(),
    name: String(source.name || '').trim() || '视觉接口',
    baseUrl: normalizeOptionalBaseUrl(source.baseUrl),
    model: String(source.model || '').trim(),
    apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
  }
}

/** Supports the multi-endpoint shape and migrates the old single-endpoint one. */
function normalizeVision(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  if (Array.isArray(source.profiles)) {
    const profiles = []
    const seen = new Set()
    let activeId = ''
    for (const rawProfile of source.profiles) {
      const profile = normalizeVisionProfile(rawProfile)
      if (seen.has(profile.id)) continue
      seen.add(profile.id)
      if (profile.id === source.activeId) activeId = profile.id
      profiles.push(profile)
    }
    return { activeId, profiles }
  }
  const legacy = normalizeVisionProfile({
    id: source.id || 'v-legacy',
    name: source.name,
    baseUrl: source.baseUrl,
    model: source.model,
    apiKey: source.apiKey,
  })
  if (legacy.baseUrl || legacy.model) return { activeId: legacy.id, profiles: [legacy] }
  return { activeId: '', profiles: [] }
}

/** The active third-party vision endpoint, or null for the Harness built-in.
 *  An id may point at an incomplete profile while the user is filling it in; the
 *  caller must report that instead of silently pretending built-in was chosen. */
function activeVisionProfile(vision) {
  if (!vision || !Array.isArray(vision.profiles)) return null
  return vision.profiles.find(item => item.id === vision.activeId) || null
}

function publicVision(vision) {
  const source = vision && typeof vision === 'object' ? vision : { activeId: '', profiles: [] }
  return {
    activeId: source.activeId || '',
    profiles: (Array.isArray(source.profiles) ? source.profiles : []).map(profile => {
      const apiKey = String(profile.apiKey || '')
      return {
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        model: profile.model,
        hasApiKey: apiKey.length > 0,
        apiKeyTail: apiKey.length >= 4 ? apiKey.slice(-4) : '',
      }
    }),
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
    quality: String(source.quality || '').trim(),
    // Image request type: `stream` (SSE, default) or `json` (plain response).
    requestType: source.requestType === 'json' ? 'json' : 'stream',
  }
}

/**
 * Accepts both the current multi-profile shape (v2) and the earlier flat
 * single-endpoint shape (v1), so an existing settings.json keeps working.
 */
function migrateSettings(raw) {
  const base = defaults()
  if (!raw || typeof raw !== 'object') {
    // Deterministic fallback id: a random id on every read made the active
    // profile change between requests until the user saved settings once.
    const profile = normalizeProfile({ id: 'p-default' })
    return { ...base, activeId: profile.id, profiles: [profile] }
  }
  const outputDir = typeof raw.outputDir === 'string' && raw.outputDir.trim()
    ? path.resolve(raw.outputDir.trim())
    : base.outputDir
  const vision = normalizeVision(raw.vision)
  if (Array.isArray(raw.profiles) && raw.profiles.length > 0) {
    const profiles = raw.profiles.map(normalizeProfile)
    const activeId = profiles.some(profile => profile.id === raw.activeId) ? raw.activeId : profiles[0].id
    return { version: 2, activeId, outputDir, profiles, vision }
  }
  const profile = normalizeProfile({
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'p-legacy',
    name: DEFAULT_PROFILE_NAME,
    baseUrl: raw.baseUrl,
    model: raw.model,
    apiKey: raw.apiKey,
    quality: raw.quality,
  })
  return { version: 2, activeId: profile.id, outputDir, profiles: [profile], vision }
}

function activeProfile(settings) {
  const list = Array.isArray(settings.profiles) && settings.profiles.length > 0 ? settings.profiles : []
  if (list.length === 0) return normalizeProfile({ id: 'p-default' })
  return list.find(profile => profile.id === settings.activeId) || list[0]
}

function publicProfile(profile) {
  const apiKey = typeof profile.apiKey === 'string' ? profile.apiKey : ''
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    quality: profile.quality,
    requestType: profile.requestType === 'json' ? 'json' : 'stream',
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
    quality: activePublic.quality,
    hasApiKey: activePublic.hasApiKey,
    apiKeyTail: activePublic.apiKeyTail,
    vision: publicVision(settings.vision),
  }
}

// Last settings read outcome. A damaged/unreadable file must never be used as
// the base of a mutation, otherwise the next Save would silently overwrite it
// with factory defaults and lose every profile/API key.
let settingsHealthy = true
let settingsWarning = ''

async function readSettings() {
  const file = settingsFile()
  let raw
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // First run: defaults are legitimate and may be persisted.
      settingsHealthy = true
      settingsWarning = ''
      return migrateSettings(undefined)
    }
    settingsHealthy = false
    settingsWarning = `settings.json 当前无法读取（${error && error.code ? error.code : 'unknown'}），为避免覆盖配置，保存已暂停。`
    console.warn(`[personal-workbench] settings.json 无法读取：${error && error.message ? error.message : error}`)
    return migrateSettings(undefined)
  }
  try {
    const settings = migrateSettings(JSON.parse(raw))
    settingsHealthy = true
    settingsWarning = ''
    return settings
  } catch (parseError) {
    // Prefer the last known-good backup: it usually still contains the real
    // profiles and keys, so restore it instead of falling back to defaults.
    try {
      const backupRaw = await fs.readFile(`${file}.bak`, 'utf8')
      const recovered = migrateSettings(JSON.parse(backupRaw))
      await fs.writeFile(file, backupRaw, 'utf8').catch(() => {})
      settingsHealthy = true
      settingsWarning = ''
      console.warn('[personal-workbench] settings.json 无法解析，已从 settings.json.bak 恢复')
      return recovered
    } catch {
      // No usable backup: keep the original bytes untouched and pause writes.
    }
    settingsHealthy = false
    settingsWarning = 'settings.json 无法解析，原文件已保留；为避免覆盖配置，保存已暂停。可恢复同目录下的 settings.json.bak 后重试。'
    try {
      await fs.copyFile(file, `${file}.corrupt-${stamp()}-${Math.random().toString(36).slice(2, 6)}`)
    } catch {
      // best effort only
    }
    console.warn(`[personal-workbench] settings.json 无法解析：${parseError && parseError.message ? parseError.message : parseError}`)
    return migrateSettings(undefined)
  }
}

/** Writes the settings file atomically so a crash / power loss cannot leave a
 *  half-written JSON file (which the old non-atomic write could do). */
async function writeSettings(next) {
  const file = settingsFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  try {
    // Keep one previous good copy for manual recovery before replacing the file.
    await fs.copyFile(file, `${file}.bak`).catch(() => {})
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
  settingsHealthy = true
  settingsWarning = ''
  return next
}

/** Settings writes are read-modify-write operations: two overlapping saves (for
 *  example "save" and "switch active profile") could otherwise interleave and
 *  drop each other's changes. All mutations go through this single queue. */
let settingsMutationQueue = Promise.resolve()

function mutateSettings(buildNext) {
  const task = settingsMutationQueue.then(async () => {
    const current = await readSettings()
    if (!settingsHealthy) {
      throw wbError('settings-corrupt', settingsWarning || 'settings.json 无法读取，保存已暂停', 409)
    }
    const next = await buildNext(current)
    await writeSettings(next)
    return next
  })
  settingsMutationQueue = task.catch(() => {})
  return task
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

/** An error that carries a stable machine code (and optional HTTP status), so the
 *  route layer answers `{ok:false, code, error}` instead of an opaque 500. */
function wbError(code, message, status) {
  const error = new Error(String(message))
  error.wbCode = String(code)
  if (status) error.wbStatus = Number(status)
  return error
}

/** Upstream failures are recognised by their status/message, so the client can
 *  tell "no key" from "bad key", "no balance", "rate limited" and "timed out"
 *  instead of always seeing internal-error. */
const PROVIDER_ERROR_RULES = [
  { code: 'missing-api-key', status: 400, pattern: /尚未配置 *API *Key/i },
  { code: 'prompt-too-long', status: 400, pattern: /提示词过长/ },
  { code: 'provider-balance', status: 502, pattern: /insufficient balance|余额不足|欠费|额度不足|quota/i },
  { code: 'provider-auth', status: 502, pattern: /unauthorized|invalid api key|invalid_api_key|无效的令牌|无效令牌|HTTP 40[13]|接口返回 40[13]/i },
  { code: 'provider-rate-limit', status: 429, pattern: /rate limit|too many requests|请求过于频繁|429/i },
  { code: 'provider-timeout', status: 504, pattern: /timeout|超时|aborted|ETIMEDOUT|EAI_AGAIN|ECONNRESET/i },
  { code: 'provider-error', status: 502, pattern: /接口|请求 .* 失败|下载生成图片失败|流式|响应体过大|fetch failed|HTTP \d{3}/ },
]

/** Wire pair ({status, code}) for one thrown error: an explicit code wins,
 *  otherwise the upstream status, otherwise the message, otherwise internal-error. */
function classifyError(error) {
  if (error && error.wbCode) {
    return { status: Number(error.wbStatus) || 500, code: String(error.wbCode) }
  }
  const message = String(error && error.message ? error.message : error)
  const upstream = Number(error && error.status) || 0
  if (upstream === 401 || upstream === 403) return { status: 502, code: 'provider-auth' }
  if (upstream === 402) return { status: 502, code: 'provider-balance' }
  if (upstream === 429) return { status: 429, code: 'provider-rate-limit' }
  for (const rule of PROVIDER_ERROR_RULES) {
    if (rule.pattern.test(message)) return { status: rule.status, code: rule.code }
  }
  if (upstream >= 400) return { status: 502, code: 'provider-error' }
  return { status: 500, code: 'internal-error' }
}

/** `sendError(res, status, code, message)`; the old 3-argument form
 *  `sendError(res, status, message)` still works (code defaults to internal-error).
 *  `error` always keeps a readable message because the page shows it verbatim. */
function sendError(res, status, code, message) {
  const hasMessage = message !== undefined
  const errorCode = String((hasMessage ? code : '') || 'internal-error')
  const errorMessage = String((hasMessage ? message : code) || 'unknown error')
  sendJson(res, status, { ok: false, code: errorCode, error: errorMessage })
}

function methodAllowed(req, res, methods) {
  const method = String(req.method || 'GET').toUpperCase()
  if (methods.indexOf(method) >= 0) return true
  sendError(res, 405, 'method-not-allowed', '请求方法不被允许')
  return false
}

/** Reads a JSON body with a per-route limit (default JSON_BODY_LIMIT). A route
 *  that carries reference images passes `referenceJsonBodyLimit(n)` instead, so a
 *  small endpoint can never be made to buffer a huge payload. */
async function readJsonBody(req, options) {
  const requested = Number(options && options.limit)
  const limit = requested > 0 ? requested : JSON_BODY_LIMIT
  const tooLarge = () => wbError('body-too-large', `请求体过大（上限 ${formatMegabytes(limit)}）`, 413)
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw tooLarge()
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw tooLarge()
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw wbError('invalid-json', '请求体不是合法 JSON', 400)
  }
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

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** Errors worth retrying: upstream hiccups, rate limits, timeouts and network
 *  failures. Account/key/quota errors are NOT transient - retrying them only
 *  makes a whole queue fail N times. */
function isTransientFailure(error) {
  const message = String(error && error.message ? error.message : error)
  if (/insufficient balance|余额不足|欠费|额度不足|无效的令牌|无效令牌|unauthorized|invalid api key|api key/i.test(message)) return false
  if (/接口返回 4\d\d|HTTP 4\d\d/.test(message) && !/429/.test(message)) return false
  return /接口返回 5\d\d|HTTP 5\d\d|429|rate limit|too many requests|请求过于频繁|请求失败|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|timeout|超时/i.test(message)
}

const JOB_BUDGET_MS = 6 * 60 * 1000

/** Retry a transiently failed provider call once. Rate limits get a longer,
 *  jittered backoff so concurrent jobs do not retry in lock-step; `deadlineAt`
 *  stops retrying once the whole job has used its time budget. */
async function withTransientRetry(fn, attempts = 2, deadlineAt = Infinity) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts || !isTransientFailure(error)) throw error
      const message = String(error && error.message ? error.message : error)
      const rateLimited = /429|rate limit|too many requests|请求过于频繁/i.test(message)
      const delay = (rateLimited ? 3000 : 1200 * attempt) + Math.floor(Math.random() * 600)
      if (Date.now() + delay >= deadlineAt) throw error
      await sleep(delay)
    }
  }
  throw lastError
}

/** Users often paste a full resource URL (…/chat/completions, …/models,
 *  …/images/edits) where a base URL is expected. Strip a known endpoint suffix
 *  so the plugin never calls …/v1/chat/completions/chat/completions. */
function stripKnownEndpointSuffix(value) {
  return value.replace(/\/(?:chat\/completions|completions|models|images\/(?:generations|edits))\/?$/i, '')
}

function normalizeBaseUrl(raw) {
  const value = stripKnownEndpointSuffix(String(raw || '').trim()).replace(/\/+$/, '')
  if (!value) return DEFAULT_BASE_URL
  return value
}

/** Like normalizeBaseUrl but keeps an empty value empty (optional endpoint). */
function normalizeOptionalBaseUrl(raw) {
  return stripKnownEndpointSuffix(String(raw || '').trim()).replace(/\/+$/, '')
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
  // `wx` makes an accidental name collision fail instead of overwriting an older
  // image (and its sidecar) silently.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 8)}`
    const name = `model-${stamp()}-${index + 1}-${suffix}${ext}`
    const file = path.join(outputDir, name)
    try {
      await fs.writeFile(file, buffer, { flag: 'wx' })
      return name
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
    }
  }
  throw new Error('保存生成图片失败：文件名连续冲突，请重试')
}

/** Writes a tiny probe file before the paid provider call, so an unwritable
 *  output folder fails before credits are spent. */
async function ensureOutputDirWritable(outputDir) {
  const probe = path.join(outputDir, `.write-probe-${process.pid}-${Date.now().toString(36)}`)
  try {
    await fs.writeFile(probe, 'ok')
  } catch (error) {
    throw wbError(
      'output-dir-unwritable',
      `输出目录不可写：${outputDir}（${error && error.message ? error.message : error}）`,
      500,
    )
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {})
  }
}

// ------------------------------------------------- generation diagnostics
// Every generated file gets a small sidecar in <outputDir>/.workbench-meta/ with
// the profile, model, prompt and timings that produced it, and history attaches
// it to the item. Without this record it is impossible to tell afterwards which
// interface/model made a picture.
const META_DIR = '.workbench-meta'

function imageMetaDir(outputDir) {
  return path.join(outputDir, META_DIR)
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function writeImageMeta(outputDir, name, meta) {
  if (!name) return
  try {
    await fs.mkdir(imageMetaDir(outputDir), { recursive: true })
    await fs.writeFile(path.join(imageMetaDir(outputDir), `${name}.json`), JSON.stringify(meta, null, 2), 'utf8')
  } catch {
    // diagnostics only; never fail a generation over it
  }
}

async function readImageMetaMap(outputDir) {
  const dir = imageMetaDir(outputDir)
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return new Map()
  }
  const map = new Map()
  // Image names start with model-<timestamp>, so newest-first keeps the map in
  // sync with the most recent history window; older sidecars are not needed.
  const files = names
    .filter(name => name.startsWith('model-') && name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, 400)
  await Promise.all(files.map(async name => {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
      if (parsed && typeof parsed === 'object') map.set(name.slice(0, -'.json'.length), parsed)
    } catch {
      // unreadable sidecar is skipped
    }
  }))
  return map
}

/** Record a generation the host refused to save (gateway echoed the reference). */
async function writeRejection(outputDir, details) {
  try {
    await fs.mkdir(imageMetaDir(outputDir), { recursive: true })
    const name = `rejected-${stamp()}-${Math.random().toString(36).slice(2, 6)}.json`
    await fs.writeFile(path.join(imageMetaDir(outputDir), name), JSON.stringify(details, null, 2), 'utf8')
  } catch {
    // diagnostics only
  }
}

/** Record a failed generation (provider error, network error, timeout, ...) so a
 *  "multi-concurrency keeps failing" report can be diagnosed afterwards. */
async function writeFailure(outputDir, details) {
  try {
    await fs.mkdir(imageMetaDir(outputDir), { recursive: true })
    const name = `failed-${stamp()}-${Math.random().toString(36).slice(2, 6)}.json`
    await fs.writeFile(path.join(imageMetaDir(outputDir), name), JSON.stringify(details, null, 2), 'utf8')
  } catch {
    // diagnostics only
  }
}

function looksLikeImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true
  return false
}

/** Real media type from the bytes, ignoring what the client claimed. */
function detectImageMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return ''
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return ''
}

/** Decode one API entry (b64 payload or download URL) into bytes. */
async function resolveImagePayload(entry, profile) {
  const item = typeof entry === 'string' ? { url: entry } : (entry || {})
  if (typeof item.b64_json === 'string' && item.b64_json) {
    const buffer = Buffer.from(item.b64_json, 'base64')
    if (buffer.length === 0) return null
    if (!looksLikeImageBuffer(buffer)) throw new Error('接口返回的图片数据不是有效图片')
    return { buffer, contentType: '' }
  }
  if (typeof item.url === 'string' && item.url) {
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
    const buffer = Buffer.from(await imageResponse.arrayBuffer())
    if (buffer.length === 0) return null
    // A gateway error page returned with HTTP 200 must never be saved as .png.
    if (!looksLikeImageBuffer(buffer)) throw new Error('下载到的内容不是有效图片（接口可能返回了错误页面）')
    return { buffer, contentType: imageResponse.headers.get('content-type') || '' }
  }
  return null
}

function parseImageResponse(text, status, ok) {
  let json
  try {
    json = JSON.parse(text)
  } catch {
    if (!ok) throw imageApiError(`接口返回 ${status}：${trim(text, 400)}`, status)
    throw imageApiError(`接口返回了非 JSON 内容：${trim(text, 400)}`, status)
  }
  if (!ok) {
    const detail = json && (json.error?.message || json.message || json.msg)
    throw imageApiError(`接口返回 ${status}：${trim(detail || text, 400)}`, status)
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
  if (data.length === 0) throw imageApiError(`接口未返回图片：${trim(text, 400)}`, status)
  return data
}

/** An image-request failure that remembers the HTTP status, so the edit path can
 *  still tell a field-spelling 4xx from an auth/balance/rate-limit failure. */
function imageApiError(message, status) {
  const error = new Error(message)
  if (status) error.status = status
  return error
}

function isEventStreamResponse(response) {
  const type = String((response.headers && response.headers.get('content-type')) || '').toLowerCase()
  return type.includes('text/event-stream')
}

/** `url` or `b64_json` payload of one API entry, else null. */
function imageEntryOf(value) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.b64_json === 'string' && value.b64_json) return { b64_json: value.b64_json }
  if (typeof value.url === 'string' && value.url) return { url: value.url }
  return null
}

/** Image entries from one SSE event object, accepting the shapes gateways use. */
function imageEntriesOfEvent(json) {
  const entries = []
  const push = value => {
    const entry = imageEntryOf(value)
    if (entry) entries.push(entry)
  }
  push(json)
  for (const key of ['data', 'images', 'output', 'image', 'result']) {
    const value = json[key]
    if (Array.isArray(value)) for (const item of value) push(item)
    else push(value)
  }
  return entries
}

/**
 * Read an OpenAI-compatible Images SSE stream (`stream: true`).
 *
 * The documented event pair is `image_generation.partial_image` (intermediate)
 * and `image_generation.completed` (final, carrying `b64_json`/`url`). Relays
 * disagree: some name the type `image_edit.completed`, some send a bare
 * `{data:[...]}` chunk, some only ever send partials. Completed events win;
 * otherwise a plain image chunk; otherwise the last partial.
 */
async function consumeImageStream(response, endpoint) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw imageApiError(`流式响应不可读：${endpoint}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let received = 0
  let completed = null
  let fallback = null
  let lastPartial = null

  /** A gateway that keeps streaming (or never terminates an event block) must not
   *  be able to grow this function's buffers without a bound: stop reading and
   *  report it as an upstream failure. */
  const oversize = async message => {
    try {
      await reader.cancel()
    } catch {
      // stream already closed
    }
    return wbError('provider-error', `${message}，已中止接收：${endpoint}`, 502)
  }

  const handleBlock = block => {
    const dataLines = []
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n').trim()
    if (!payload || payload === '[DONE]') return
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    if (json && json.error) {
      const detail = json.error.message || json.error.code || JSON.stringify(json.error)
      throw imageApiError(`接口返回错误（流式）：${trim(String(detail), 300)}`, 200)
    }
    const type = String((json && json.type) || '').toLowerCase()
    const entries = imageEntriesOfEvent(json)
    if (entries.length === 0) return
    if (type.includes('partial')) {
      lastPartial = entries[entries.length - 1]
      return
    }
    if (type.includes('completed')) {
      completed = entries
      return
    }
    fallback = entries
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      received += value && typeof value.length === 'number' ? value.length : 0
      if (received > SSE_TOTAL_MAX_CHARS) {
        throw await oversize(`接口流式响应体过大（超过 ${formatMegabytes(SSE_TOTAL_MAX_CHARS)}）`)
      }
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > SSE_BLOCK_MAX_CHARS) {
        throw await oversize(`接口流式响应的单个事件过大（超过 ${formatMegabytes(SSE_BLOCK_MAX_CHARS)}）`)
      }
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer)
        if (!match) break
        handleBlock(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) handleBlock(buffer)
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // stream already closed
    }
  }

  if (completed && completed.length > 0) return completed
  if (fallback && fallback.length > 0) return fallback
  if (lastPartial) return [lastPartial]
  throw imageApiError(`流式响应没有返回图片：${endpoint}`)
}

/** True when the gateway rejected the `stream` parameter itself (as opposed to
 *  a real auth/balance/model error), which is worth one plain retry. A 200 body
 *  that carries such an error counts too: some relays answer with HTTP 200 and a
 *  JSON error object instead of a 4xx. */
function isStreamRejection(status, text) {
  if (![200, 400, 404, 405, 415, 422, 500].includes(Number(status))) return false
  const detail = String(text || '').toLowerCase()
  if (!detail.includes('stream')) return false
  return /(not support|unsupported|unknown|invalid|unrecognized|unexpected|not allowed|不允许|不支持|未知|无效|无法识别)/.test(detail)
}

async function sendImageRequest(endpoint, request, timeoutMs) {
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: timeoutSignal(timeoutMs),
    })
  } catch (error) {
    throw imageApiError(`请求 ${endpoint} 失败：${error && error.message ? error.message : error}`)
  }
  // Read the body here: the stream-but-rejected case needs the text to decide the
  // retry, and an ok JSON response can be parsed from the same buffer.
  if (response.ok && !isEventStreamResponse(response)) {
    const text = await response.text().catch(() => '')
    return { ok: true, response, status: response.status, text }
  }
  if (response.ok) return { ok: true, response, status: response.status }
  const text = await response.text().catch(() => '')
  return { ok: false, response, status: response.status, text }
}

/**
 * One logical image request: build(useStream) produces the wire request.
 * Streaming is the configured request type; a gateway that explicitly rejects
 * the `stream` parameter (4xx, or a 200 JSON error) is retried once without it,
 * and a gateway that ignores it (plain JSON answer) is parsed as before.
 */
async function performImageRequest(endpoint, build, timeoutMs, streaming) {
  let result = await sendImageRequest(endpoint, build(streaming), timeoutMs)
  if (streaming && result.text && isStreamRejection(result.status, result.text)) {
    result = await sendImageRequest(endpoint, build(false), timeoutMs)
  }
  if (!result.ok) throw imageApiError(`接口返回 ${result.status}：${trim(result.text, 400)}`, result.status)
  if (isEventStreamResponse(result.response)) {
    try {
      return await consumeImageStream(result.response, endpoint)
    } catch (error) {
      // A failure detected locally (oversized stream) keeps its own code and
      // message instead of being re-wrapped with the endpoint prefix.
      if (error && error.wbCode) throw error
      // A stream whose event shape we cannot decode (some relays stream chat-style
      // chunks) is retried once as a plain request instead of failing the job.
      if (streaming && /流式响应没有返回图片/.test(String(error && error.message))) {
        const plain = await sendImageRequest(endpoint, build(false), timeoutMs)
        if (!plain.ok) throw imageApiError(`接口返回 ${plain.status}：${trim(plain.text, 400)}`, plain.status)
        if (isEventStreamResponse(plain.response)) return consumeImageStream(plain.response, endpoint)
        const text = typeof plain.text === 'string' ? plain.text : await plain.response.text()
        return parseImageResponse(text, plain.status, true)
      }
      throw imageApiError(`流式接收 ${endpoint} 失败：${error && error.message ? error.message : error}`, result.status)
    }
  }
  if (typeof result.text === 'string') return parseImageResponse(result.text, result.status, true)
  const text = await result.response.text()
  return parseImageResponse(text, result.status, true)
}

async function callImagesApi(settings, prompt, size, modelOverride, timeoutMs = 240000) {
  const apiKey = String(settings.apiKey || '').trim()
  if (!apiKey) throw new Error('尚未配置 API Key，请在工作台「设置」中填写')

  const base = normalizeBaseUrl(settings.baseUrl)
  const endpoint = `${base}/images/generations`
  const model = String(modelOverride || settings.model || DEFAULT_MODEL).trim()
  const payload = {
    model,
    prompt,
    n: 1,
    size: String(size || DEFAULT_SIZE),
  }
  const quality = String(settings.quality || '').trim()
  if (quality) payload.quality = quality
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
  // Streaming is the configured request type (see the workbench "请求类型"
  // setting); `performImageRequest` falls back to plain JSON when the gateway
  // rejects `stream`.
  const streaming = settings.requestType !== 'json'
  const data = await performImageRequest(
    endpoint,
    useStream => ({
      headers,
      body: JSON.stringify(useStream ? { ...payload, stream: true } : payload),
    }),
    timeoutMs,
    streaming,
  )
  return { data, endpoint, model }
}

function buildEditForm(settings, prompt, size, model, references, strategy, stream) {
  const quality = String(settings.quality || '').trim()
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt)
  form.append('n', '1')
  form.append('size', String(size || DEFAULT_SIZE))
  if (quality) form.append('quality', quality)
  if (stream) form.append('stream', 'true')
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
 * The request type follows the profile (`stream` by default).
 */
async function callImageEditApi(settings, prompt, size, references, modelOverride, timeoutMs = 240000) {
  const apiKey = String(settings.apiKey || '').trim()
  if (!apiKey) throw new Error('尚未配置 API Key，请在工作台「设置」中填写')

  const base = normalizeBaseUrl(settings.baseUrl)
  const endpoint = `${base}/images/edits`
  const model = String(modelOverride || settings.model || DEFAULT_MODEL).trim()
  const headers = { authorization: `Bearer ${apiKey}` }
  const streaming = settings.requestType !== 'json'

  const requestFor = strategy => performImageRequest(
    endpoint,
    useStream => ({
      headers,
      body: buildEditForm(settings, prompt, size, model, references, strategy, useStream),
    }),
    timeoutMs,
    streaming,
  )

  let data
  try {
    data = await requestFor('default')
  } catch (error) {
    // Only the field-name spelling is worth a second try; auth/balance/rate-limit
    // failures will fail identically with the other spelling.
    const status = Number(error && error.status)
    const fieldProblem = status >= 400 && status < 500 && status !== 401 && status !== 402 && status !== 403 && status !== 429
    if (!fieldProblem) throw error
    try {
      data = await requestFor('alternate')
    } catch {
      throw error
    }
  }

  return { data, endpoint, model }
}

function normalizeReference(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const base64 = String(raw.dataBase64 || '').trim()
  if (!base64) return undefined
  // Reject an oversized payload *before* decoding it: decoding first and checking
  // the bytes afterwards held two full copies of the image in memory at once.
  if (base64.length > Math.ceil(REFERENCE_MAX_BYTES * BASE64_EXPANSION) + 8) {
    throw wbError('reference-too-large', `参考图过大（上限 ${formatMegabytes(REFERENCE_MAX_BYTES)}）`, 413)
  }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) return undefined
  if (buffer.length > REFERENCE_MAX_BYTES) {
    throw wbError('reference-too-large', `参考图过大（上限 ${formatMegabytes(REFERENCE_MAX_BYTES)}）`, 413)
  }
  // Trust the bytes, not the declared media type: a garbage payload must not be
  // persisted/served as a PNG.
  const mediaType = detectImageMediaType(buffer)
  if (!mediaType) throw wbError('invalid-reference', '参考图不是有效图片（支持 PNG / JPG / WebP）', 400)
  const extension = mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/webp' ? '.webp' : '.png'
  const base = String(raw.name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const name = `${base || 'reference'}${extension}`
  return { buffer, mediaType, name, originalName: String(raw.name || '').slice(0, 80) }
}

/**
 * The single place that decides how many reference images a route accepts and how
 * large the whole set may be. The page has its own limits, but a request sent
 * straight to the route must obey exactly the same ones instead of being silently
 * truncated (`/ref/products`, `/extract`) or failing with a bare 500
 * (`/generate`). Entries that are not images at all are skipped as before.
 */
function fillReferences(rawList, limit) {
  const list = Array.isArray(rawList) ? rawList : []
  const references = []
  let total = 0
  for (const raw of list) {
    // Skip entries that carry no image data at all (cheap, no decoding).
    if (!raw || typeof raw !== 'object' || !String(raw.dataBase64 || '').trim()) continue
    // Count *before* decoding: the (limit + 1)-th image used to be decoded first
    // and then reported as "too large" when it happened to exceed the per-image
    // cap, which hid the real reason. Priority: count > per-image > total.
    if (references.length >= limit) {
      throw wbError('reference-count', `参考图最多 ${limit} 张`, 400)
    }
    const reference = normalizeReference(raw)
    if (!reference) continue
    total += reference.buffer.length
    if (total > REFERENCE_MAX_TOTAL_BYTES) {
      throw wbError(
        'reference-total-size',
        `参考图总大小超出上限（${formatMegabytes(REFERENCE_MAX_TOTAL_BYTES)}），请减少张数或压缩后重试`,
        413,
      )
    }
    references.push(reference)
  }
  return references
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

/** Prompt block for the vision model that recognises product reference photos.
 *  It locks the 12 core product features before the extraction task, so the
 *  recognised description that reaches the generation prompt is faithful. */
const EXTRACT_LOCK_RULES = [
  '【商品细节严格锁定｜最高优先级】',
  '以用户上传的真实商品参考图为唯一设计依据，严格锁定裤子的12项核心特征：①原始颜色与色彩分布；②面料材质、织纹及质感；③整体版型与轮廓；④腰臀裆腿及裤脚尺寸比例；⑤腰头结构；⑥门襟结构；⑦口袋数量、形状与位置；⑧缝线走向、裁片及拼接关系；⑨水洗、磨白、做旧与磨损分布；⑩破洞、刺绣、印花、贴布、铆钉等特殊设计；⑪裤腿与裤脚结构；⑫所有设计元素的相对位置、左右归属及连接关系。',
  '上述特征必须与原始商品保持一致，禁止擅自增加、删除、替换、移动、镜像、简化、重绘或重新设计任何可辨认细节。允许因人体穿着、动作、重力及光照产生合理的自然褶皱、垂坠和明暗变化，但不得改变商品原始颜色、材质、版型及永久性设计特征。参考图未清晰展示的细节不得凭空编造。无论模特、动作、角度、光线及背景如何变化，商品身份与关键结构均须保持一致。当视觉美观与商品真实性冲突时，始终以原始商品为准，确保生成结果呈现同一件商品，而非相似款或重新设计款。',
].join('\n\n')

function extractInstruction() {
  return [
    EXTRACT_LOCK_RULES,
    '',
    '请分析这些商品参考图（可能是同一商品的多角度图或细节图），提取该商品的关键设计元素，用于生成电商模特图的商品描述。',
    '输出要求：',
    '1. 只描述商品本身，不要描述模特、人物、背景、构图、光线或拍摄效果。',
    '2. 必须输出一个严格合法的 JSON 对象：键名与下面 12 个维度完全一致，值为该维度的中文描述字符串，顺序也保持一致：',
    `{${EXTRACT_LABELS.map(label => `"${label}":"…"`).join(',')}}`,
    '3. 颜色要具体（如“黑色水洗做旧”“米白色”）；面料写材质与质感；版型与尺寸比例写宽松程度、轮廓、长短等。',
    '4. 看不清或没有把握的维度，值写“无法判断”；12 个键都必须存在，绝对不能编造。',
    '5. 如果商品不是裤装，请按实际品类替换第 5~11 项的维度名称（如裙装可写“腰头结构 / 裙门襟 / 裙摆结构”等），其余维度保持，键名使用替换后的名称。',
    '6. 只输出这个 JSON 对象本身（第一个字符必须是 {，最后一个字符必须是 }），不要 markdown 代码块、不要编号、不要任何解释文字。',
  ].join('\n')
}

/** The recognised description is stored and prompted as a JSON object: a
 *  structured "key: value" prompt is easier for the image model to follow than
 *  loose lines. Vision models sometimes ignore the format instruction, so the
 *  normaliser also accepts a fenced JSON block, a bare object/array, or plain
 *  「维度：描述」 lines and always returns valid, pretty-printed JSON. */
const EXTRACT_VALUE_MAX = 600
const EXTRACT_KEY_MAX = 24
const EXTRACT_MAX_KEYS = 20

function normalizeExtractedKey(rawKey) {
  return String(rawKey === undefined || rawKey === null ? '' : rawKey)
    .replace(/\*\*|__|`|#|>/g, '')
    .replace(/^\s*(?:[①-⑳]|\d{1,2}\s*[.、)．])\s*/u, '')
    .replace(/^[\s"'“”「」【】\[\]{}]+|[\s"'“”「」【】\[\]{}]+$/gu, '')
    .trim()
    .slice(0, EXTRACT_KEY_MAX)
}

function normalizeExtractedValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return ''
  if (typeof rawValue === 'string') {
    return rawValue.replace(/\s+/g, ' ').trim().slice(0, EXTRACT_VALUE_MAX)
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') return String(rawValue)
  if (Array.isArray(rawValue)) {
    return rawValue
      .map(item => normalizeExtractedValue(item))
      .filter(Boolean)
      .join('；')
      .slice(0, EXTRACT_VALUE_MAX)
  }
  if (typeof rawValue === 'object') {
    return Object.keys(rawValue)
      .map(key => `${normalizeExtractedKey(key)}：${normalizeExtractedValue(rawValue[key])}`)
      .filter(item => !item.endsWith('：'))
      .join('；')
      .slice(0, EXTRACT_VALUE_MAX)
  }
  return ''
}

function extractedEntriesToJson(entries) {
  const byKey = new Map()
  for (const entry of entries) {
    const key = normalizeExtractedKey(entry.key)
    if (key && !byKey.has(key)) byKey.set(key, entry.value)
  }
  const ordered = []
  const seen = new Set()
  const push = (key, value) => {
    if (!key || seen.has(key) || ordered.length >= EXTRACT_MAX_KEYS) return
    seen.add(key)
    ordered.push({ key, value: normalizeExtractedValue(value) || '无法判断' })
  }
  const knownFound = EXTRACT_LABELS.some(label => byKey.has(label))
  // Custom dimension names (dresses, tops, ...) replace some of the 12 standard
  // dimensions, so they are kept as reported. For a plain 12-dimension answer the
  // missing dimensions are completed with 无法判断 so the JSON always has 12 keys.
  const hasCustom = [...byKey.keys()].some(key => EXTRACT_LABELS.indexOf(key) < 0)
  if (knownFound && !hasCustom) {
    for (const label of EXTRACT_LABELS) push(label, byKey.get(label))
  } else {
    for (const label of EXTRACT_LABELS) {
      if (byKey.has(label)) push(label, byKey.get(label))
    }
    for (const [key, value] of byKey) {
      if (EXTRACT_LABELS.indexOf(key) < 0) push(key, value)
    }
  }
  if (ordered.length === 0) return ''
  const object = {}
  for (const entry of ordered) object[entry.key] = entry.value
  return JSON.stringify(object, null, 2)
}

/** Every balanced JSON value in `text`, starting with the whole trimmed text.
 *  Handles prose before/after the JSON, several objects, and braces inside
 *  strings (balanced scan skips string content). */
function jsonCandidates(text) {
  const source = String(text || '').trim()
  const candidates = []
  if (!source) return candidates
  if (source.charAt(0) === '{' || source.charAt(0) === '[') candidates.push(source)
  for (let index = 0; index < source.length; index += 1) {
    const open = source.charAt(index)
    if (open !== '{' && open !== '[') continue
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escaped = false
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const char = source.charAt(cursor)
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === open) depth += 1
      else if (char === close) {
        depth -= 1
        if (depth === 0) {
          candidates.push(source.slice(index, cursor + 1))
          index = cursor
          break
        }
      }
    }
  }
  return candidates
}

function parseJsonCandidate(candidate) {
  const text = String(candidate || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // Tolerate a trailing comma before a closing brace/bracket.
  }
  try {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))
  } catch {
    return null
  }
}

function parseExtractedJson(text) {
  for (const candidate of jsonCandidates(text)) {
    const parsed = parseJsonCandidate(candidate)
    if (!parsed || typeof parsed !== 'object') continue
    if (Array.isArray(parsed)) {
      const entries = []
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const key = item.key !== undefined ? item.key : (item.name !== undefined ? item.name : undefined)
        if (key !== undefined) {
          entries.push({ key, value: item.value !== undefined ? item.value : item.description })
          continue
        }
        for (const name of Object.keys(item)) entries.push({ key: name, value: item[name] })
      }
      if (entries.length > 0) return entries
      continue
    }
    const keys = Object.keys(parsed)
    if (keys.length === 0) continue
    return keys.map(key => ({ key, value: parsed[key] }))
  }
  return null
}

function parseExtractedLines(text) {
  const entries = []
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (const line of lines) {
    const cleaned = line
      .replace(/^[-*•·\s]+/u, '')
      .replace(/^[①-⑳]\s*/u, '')
      .replace(/^\d{1,2}\s*[.、)．]\s*/u, '')
      .trim()
    if (!cleaned) continue
    const match = cleaned.match(/^([^：:]{1,24})[：:]\s*(.+)$/u)
    if (match) {
      entries.push({ key: match[1].trim(), value: match[2].trim() })
    } else if (entries.length > 0) {
      // A wrapped continuation line belongs to the previous dimension.
      const last = entries[entries.length - 1]
      last.value = `${last.value} ${cleaned}`.trim().slice(0, EXTRACT_VALUE_MAX)
    }
  }
  return entries
}

function normalizeExtractedDescription(raw) {
  let text = String(raw === undefined || raw === null ? '' : raw).trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()
  if (!text) return ''
  const jsonEntries = parseExtractedJson(text)
  if (jsonEntries && jsonEntries.length > 0) {
    const json = extractedEntriesToJson(jsonEntries)
    if (json) return json
  }
  const lineEntries = parseExtractedLines(text)
  if (lineEntries.length > 0) {
    const json = extractedEntriesToJson(lineEntries)
    if (json) return json
  }
  // Last resort: keep the model's answer inside a JSON envelope so the
  // description field is always valid JSON, even for a non-conforming model.
  return extractedEntriesToJson([{ key: '描述', value: text }])
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

/** Third-party OpenAI-compatible vision model (chat/completions with image_url). */
async function extractTextWithCustomVision(vision, references, instruction, system, maxTokens) {
  const base = normalizeOptionalBaseUrl(vision.baseUrl)
  if (!base) throw new Error('视觉模型接口地址为空')
  const endpoint = `${base}/chat/completions`
  const apiKey = String(vision.apiKey || '').trim()
  const content = [
    { type: 'text', text: instruction },
    ...references.map(reference => ({
      type: 'image_url',
      image_url: { url: `data:${reference.mediaType};base64,${reference.buffer.toString('base64')}` },
    })),
  ]
  const payload = {
    model: vision.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  }
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: timeoutSignal(180000),
    })
  } catch (error) {
    throw new Error(`请求 ${endpoint} 失败：${error && error.message ? error.message : error}`)
  }
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // non-JSON error body is reported below
  }
  if (!response.ok) {
    const detail = json && (json.error?.message || json.message || json.msg)
    throw new Error(`视觉模型接口返回 ${response.status}：${trim(detail || text, 400)}`)
  }
  const choice = json && Array.isArray(json.choices) && json.choices[0] ? json.choices[0] : null
  const message = choice ? choice.message : null
  let output = ''
  if (message && typeof message.content === 'string') {
    output = message.content
  } else if (message && Array.isArray(message.content)) {
    output = message.content
      .map(part => (typeof part === 'string' ? part : String((part && part.text) || '')))
      .join('')
  }
  if (choice && choice.finish_reason === 'length') throw new Error('提取结果被截断，请重试')
  if (!output.trim()) throw new Error('视觉模型没有返回内容')
  return { text: output, provider: 'custom-vision', model: vision.model, imageCount: references.length }
}

/** Vision extraction entry point: active third-party endpoint first, otherwise
 *  the Harness built-in model. */
async function extractText(ctx, settings, references, instruction, system, maxTokens) {
  const vision = activeVisionProfile(settings && settings.vision)
  if (vision) {
    // Never fall back to the built-in model behind the user's back: an active but
    // incomplete endpoint must surface as an actionable configuration error.
    if (!vision.baseUrl || !vision.model) {
      throw new Error('视觉接口未配置完整（需要接口地址和模型名）。请到「设置 → 商品图识别模型」补全，或点击「Harness 内置视觉模型」改用内置模型。')
    }
    return extractTextWithCustomVision(vision, references, instruction, system, maxTokens)
  }
  return extractTextWithModel(ctx, references, instruction, system, maxTokens)
}

async function extractKeyElements(ctx, settings, references) {
  const result = await extractText(ctx, settings, references, extractInstruction(), EXTRACT_SYSTEM, 8000)
  const cleaned = normalizeExtractedDescription(result.text)
  if (!cleaned) throw new Error('模型没有返回可用的提取结果，请换一张更清晰的商品图重试')
  return { ...result, text: cleaned }
}

function normalizeSizeColumnName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[（(]\s*(cm|厘米|公分)\s*[）)]/g, '')
    .replace(/(cm|厘米|公分)/g, '')
    .replace(/[\s:：]/g, '')
}

/** One size-chart cell: number, "72cm", "72.5", "72,5", "72~74"/"72-74"
 *  (range -> midpoint). Anything else is empty, never a concatenated number. */
function parseSizeCell(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const value = parseSizeCell(item)
      if (value !== null) return value
    }
    return null
  }
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim().toLowerCase()
    .replace(/[（(]\s*(cm|厘米|公分)\s*[）)]/g, '')
    .replace(/(cm|厘米|公分)/g, '')
    .replace(/[，,]/g, '.')
    .trim()
  if (!text) return null
  const range = text.match(/^(\d+(?:\.\d+)?)\s*[-~–—/]\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    const low = Number(range[1])
    const high = Number(range[2])
    return Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : null
  }
  const single = text.match(/^(\d+(?:\.\d+)?)$/)
  return single ? Number(single[1]) : null
}

function parseSizeTableText(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  let json = null
  for (const candidate of jsonCandidates(text)) {
    const parsed = parseJsonCandidate(candidate)
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.columns) && Array.isArray(parsed.rows)) {
      json = parsed
      break
    }
  }
  if (!json) return null
  const rawColumns = json.columns
  const columns = []
  const seen = new Set()
  for (const item of rawColumns) {
    const rawName = typeof item === 'string'
      ? item.trim()
      : (item && typeof item.name === 'string' ? item.name.trim() : '')
    if (!rawName) continue
    const name = rawName.replace(/[（(]\s*(cm|厘米|公分)\s*[）)]/gi, '').replace(/(cm|厘米|公分)/gi, '').trim()
    if (!name || seen.has(name) || columns.length >= 8) continue
    seen.add(name)
    columns.push({ key: `c${columns.length}`, name: name.slice(0, 12) })
  }
  const rawRows = json.rows
  const rows = []
  for (const item of rawRows) {
    if (!item || typeof item !== 'object') continue
    const size = String(item.size !== undefined ? item.size : (item.label !== undefined ? item.label : '')).trim()
    if (!size) continue
    const source = item.values && typeof item.values === 'object' ? item.values : item
    const sourceMap = new Map()
    for (const key of Object.keys(source)) sourceMap.set(normalizeSizeColumnName(key), source[key])
    const values = {}
    for (const column of columns) {
      const normalized = normalizeSizeColumnName(column.name)
      const rawValue = sourceMap.has(normalized) ? sourceMap.get(normalized) : source[column.name]
      values[column.key] = parseSizeCell(rawValue)
    }
    rows.push({ size: size.slice(0, 12), values })
    if (rows.length >= 12) break
  }
  if (columns.length === 0 || rows.length === 0) return null
  return { columns, rows }
}

async function extractSizeTable(ctx, settings, references) {
  const result = await extractText(ctx, settings, references, sizeExtractInstruction(), SIZE_EXTRACT_SYSTEM, 8000)
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
  const allowEmptyKey = Boolean(override && override.allowEmptyKey)
  if (!apiKey && !allowEmptyKey) throw new Error('尚未配置 API Key，请先填写 Key（保存前也可拉取）')
  const endpoint = `${base}/models`
  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
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
  if (!prompt) throw wbError('missing-prompt', '提示词不能为空', 400)
  const promptLength = Array.from(prompt).length
  if (promptLength > PROMPT_MAX_CHARS) {
    throw wbError('prompt-too-long', `提示词过长（上限 ${PROMPT_MAX_CHARS} 字符，当前 ${promptLength}）`, 400)
  }
  const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
  // A queued job remembers which API profile it was submitted with; fall back to
  // the current profile when that id no longer exists.
  const submittedProfile = body.profileId
    ? settings.profiles.find(item => item.id === body.profileId)
    : undefined
  const profile = submittedProfile || activeProfile(settings)
  // A queued job carries the model of the profile it was submitted with. When
  // that profile was deleted/renamed the job falls back to the current profile,
  // and the stale model override must not be mixed into the new profile.
  const modelOverride = submittedProfile ? body.model : undefined
  await fs.mkdir(outputDir, { recursive: true })
  await ensureOutputDirWritable(outputDir)

  const references = fillReferences([
    ...(Array.isArray(body.references) ? body.references : []),
    ...(body.reference ? [body.reference] : []),
  ], GENERATE_REF_LIMIT)

  const referenceHashes = new Set(references.map(reference => hashBuffer(reference.buffer)))
  // A transient upstream failure (5xx / 429 / timeout / network) is retried once
  // inside a single job so concurrency does not turn one hiccup into a failed job.
  // The whole job shares a time budget so a hanging upstream cannot keep a queue
  // slot occupied indefinitely (240s timeout x 2 attempts x echo retry).
  const deadlineAt = startedAt + JOB_BUDGET_MS
  const remainingTimeout = () => Math.max(15000, Math.min(240000, deadlineAt - Date.now()))
  const requestOnce = () => withTransientRetry(() => (references.length > 0
    ? callImageEditApi(profile, prompt, body.size, references, modelOverride, remainingTimeout())
    : callImagesApi(profile, prompt, body.size, modelOverride, remainingTimeout())), 2, deadlineAt)

  const providerStartedAt = Date.now()
  let data = []
  let endpoint = ''
  let model = ''
  let attempts = 0
  let echoRetried = false
  let payloads = []
  // Guard against gateways that answer a failed /images/edits with HTTP 200 and
  // the *uploaded reference image* instead of an error (observed on relays that
  // fall back to a worker without edit support). Saving that would look like a
  // successful generation that is just the user's own photo, so an echo triggers
  // one automatic retry and is otherwise reported as a failure.
  for (;;) {
    attempts += 1
    const response = await requestOnce()
    data = response.data
    endpoint = response.endpoint
    model = response.model
    // Persist nothing until the response is known to be a real generation: b64
    // payloads decode locally while URL payloads download in parallel.
    payloads = (await Promise.all(data.map(entry => resolveImagePayload(entry, profile)))).filter(Boolean)
    if (payloads.length === 0) throw wbError('no-image-returned', '接口返回成功，但没有可用的图片数据', 502)
    const echoes = payloads.filter(payload => referenceHashes.has(hashBuffer(payload.buffer)))
    if (echoes.length === 0) break
    if (attempts === 1) {
      echoRetried = true
      continue
    }
    payloads = payloads.filter(payload => !referenceHashes.has(hashBuffer(payload.buffer)))
    if (payloads.length === 0) {
      await writeRejection(outputDir, {
        at: Date.now(),
        mode: references.length > 0 ? 'edit' : 'generate',
        profileId: profile.id,
        profileName: profile.name,
        model,
        endpoint,
        size: String(body.size || DEFAULT_SIZE),
        refCount: references.length,
        attempts,
        prompt: prompt.slice(0, 2000),
      })
      throw wbError(
        'reference-echoed',
        '接口把你上传的参考图原样返回了，没有真正生成（对接方降级/兜底返回）。已自动重试 1 次仍然如此：请重新生成，或到「设置」里更换接口 / 模型。',
        502,
      )
    }
    break
  }
  const providerMs = Date.now() - providerStartedAt

  const saveStartedAt = Date.now()
  const items = await Promise.all(payloads.map(async (payload, index) => {
    const name = await saveImageBuffer(outputDir, payload.buffer, payload.contentType, index)
    return {
      name,
      url: `${PREFIX}/image?name=${encodeURIComponent(name)}`,
      size: payload.buffer.length,
    }
  }))
  const saveMs = Date.now() - saveStartedAt
  const metaBase = {
    createdAt: Date.now(),
    mode: references.length > 0 ? 'edit' : 'generate',
    profileId: profile.id,
    profileName: profile.name,
    model,
    endpoint,
    size: String(body.size || DEFAULT_SIZE),
    refCount: references.length,
    requestType: profile.requestType === 'json' ? 'json' : 'stream',
    attempts,
    echoRetried,
    providerMs,
    saveMs,
    prompt,
  }
  await Promise.all(items.map(item => writeImageMeta(outputDir, item.name, { ...metaBase, name: item.name })))
  return {
    ok: true,
    items: items.map(item => ({ ...item, meta: { ...metaBase, name: item.name } })),
    model,
    endpoint,
    outputDir,
    mode: metaBase.mode,
    referenceCount: references.length,
    profile: { id: profile.id, name: profile.name },
    timings: { providerMs, saveMs, totalMs: Date.now() - startedAt, attempts, echoRetried },
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
  const metaMap = await readImageMetaMap(outputDir)
  const items = rows.slice(0, Math.max(1, Math.min(200, limit || 60))).map(row => {
    const item = { ...row, url: `${PREFIX}/image?name=${encodeURIComponent(row.name)}` }
    if (metaMap.has(row.name)) item.meta = metaMap.get(row.name)
    return item
  })
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

/**
 * Resolve one file that is about to be served to a real path that is still inside
 * `rootDir`. Returns `{ path }` when it may be served, `{ reason: 'missing' }`
 * when it is not there, `{ reason: 'refused' }` when it resolves outside the
 * folder.
 *
 * `path.basename` already keeps a request from naming another directory, but a
 * link *inside* the folder can still point elsewhere:
 *   - a symlink / junction is followed by `realpath`, and the result must stay
 *     inside the folder (compared on both real paths, so a symlinked folder or a
 *     different casing cannot confuse the check);
 *   - a hard link (`mklink /H`, no admin needed) is the *same file*, so
 *     `realpath` reports the in-folder name and cannot see it. Such a file has
 *     more than one link, so it is refused instead: the plugin never creates hard
 *     links, every generated image and stored reference has exactly one.
 */
async function containedFile(rootDir, file) {
  try {
    const stats = await fs.lstat(file)
    if (stats.nlink > 1) return { reason: 'refused' }
    const realFile = await fs.realpath(file)
    if (!isPathInside(await fs.realpath(rootDir), realFile)) return { reason: 'refused' }
    return { path: realFile }
  } catch {
    return { reason: 'missing' }
  }
}

async function serveImage(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return
  const url = new URL(req.url, 'http://127.0.0.1')
  const settings = await readSettings()
  const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
  const file = resolveImagePath(outputDir, url.searchParams.get('name'))
  if (!file) return sendError(res, 400, 'invalid-image-name', 'invalid image name')
  const contained = await containedFile(outputDir, file)
  if (!contained.path) return sendError(res, 404, 'image-not-found', 'image not found')
  let buffer
  try {
    buffer = await fs.readFile(contained.path)
  } catch {
    return sendError(res, 404, 'image-not-found', 'image not found')
  }
  const ext = path.extname(contained.path).toLowerCase()
  const type = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  res.statusCode = 200
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  res.setHeader('x-content-type-options', 'nosniff')
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

async function writeFileAtomic(file, data) {
  const temp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  await fs.writeFile(temp, data)
  try {
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

async function writeRef(kind, buffer, mediaType) {
  const definition = refKind(kind)
  if (!definition) throw new Error('unknown reference kind')
  const dir = profileRefsDir()
  await fs.mkdir(dir, { recursive: true })
  const name = `${definition.base}${extensionFor(buffer, mediaType)}`
  // Write the replacement first; only then delete an older copy with a different
  // extension, so a failed write can never remove the last good reference.
  await writeFileAtomic(path.join(dir, name), buffer)
  for (const oldName of await listRefFiles(kind)) {
    if (oldName === name) continue
    await fs.rm(path.join(dir, oldName), { force: true }).catch(() => {})
  }
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

/** Product-photo writes replace the whole set; two overlapping requests from
 *  separate tabs must not interleave their delete/write phases. */
let productRefsMutationQueue = Promise.resolve()

function queueProductRefsMutation(task) {
  const run = productRefsMutationQueue.then(task, task)
  productRefsMutationQueue = run.catch(() => {})
  return run
}

async function writeProductRefs(references) {
  const dir = profileRefsDir()
  await fs.mkdir(dir, { recursive: true })
  const existing = await listProductRefFiles()
  const pending = []
  const meta = []
  for (let index = 0; index < references.length && index < PRODUCT_REF_LIMIT; index += 1) {
    const reference = references[index]
    const extension = extensionFor(reference.buffer, reference.mediaType)
    const finalName = `product-${index}${extension}`
    pending.push({ reference, finalName })
    meta.push({ file: finalName, name: reference.originalName || reference.name })
  }
  // Stage every file under a temporary name first, then move them into place and
  // only after that delete stale photos. A failed upload therefore never wipes
  // the previously persisted product reference set.
  const staged = []
  try {
    for (const item of pending) {
      const tempPath = path.join(dir, `.${item.finalName}.tmp-${process.pid}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`)
      await fs.writeFile(tempPath, item.reference.buffer)
      staged.push({ tempPath, finalPath: path.join(dir, item.finalName), moved: false })
    }
    for (const item of staged) {
      await fs.rename(item.tempPath, item.finalPath)
      item.moved = true
    }
  } catch (error) {
    for (const item of staged) {
      if (!item.moved) await fs.rm(item.tempPath, { force: true }).catch(() => {})
    }
    throw error
  }
  const keep = new Set(pending.map(item => item.finalName))
  for (const name of existing) {
    if (keep.has(name)) continue
    await fs.rm(path.join(dir, name), { force: true }).catch(() => {})
  }
  if (meta.length > 0) {
    await writeFileAtomic(path.join(dir, PRODUCT_REF_META), JSON.stringify(meta))
  } else {
    await fs.rm(path.join(dir, PRODUCT_REF_META), { force: true }).catch(() => {})
  }
  return productRefItems(pending.map(item => item.finalName), meta)
}

async function deleteProductRefs() {
  const dir = profileRefsDir()
  for (const name of await listProductRefFiles()) {
    await fs.rm(path.join(dir, name), { force: true })
  }
  await fs.rm(path.join(dir, PRODUCT_REF_META), { force: true })
}

async function serveRefImage(req, res) {
  if (!methodAllowed(req, res, ['GET'])) return
  const url = new URL(req.url, 'http://127.0.0.1')
  const name = path.basename(String(url.searchParams.get('name') || ''))
  const allowed = PRODUCT_REF_PATTERN.test(name)
    || Object.keys(REF_KINDS).some(kind => REF_KINDS[kind].pattern.test(name))
  if (!allowed) return sendError(res, 400, 'invalid-ref-name', 'invalid ref name')
  const dir = profileRefsDir()
  // Same containment as /image: the name is whitelisted, but a link stored in the
  // refs folder must not become a way to read a file from outside it.
  const contained = await containedFile(dir, path.join(dir, name))
  if (contained.reason === 'missing') return sendError(res, 404, 'ref-not-found', 'ref not found')
  if (!contained.path) return sendError(res, 400, 'ref-outside-dir', '参考图路径不在参考图目录内')
  let buffer
  try {
    buffer = await fs.readFile(contained.path)
  } catch {
    return sendError(res, 404, 'ref-not-found', 'ref not found')
  }
  res.statusCode = 200
  res.setHeader('content-type', refMediaTypeFor(name))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(buffer)
}

/**
 * GET/POST/DELETE for one persisted reference kind ('model' or 'scene').
 */
function makeRefHandler(kind) {
  return async (req, res) => {
    if (!methodAllowed(req, res, ['GET', 'POST', 'DELETE'])) return
    const method = String(req.method || 'GET').toUpperCase()
    if (method === 'GET') {
      const item = await readRef(kind)
      return sendJson(res, 200, { ok: true, item })
    }
    if (method === 'DELETE') {
      await deleteRef(kind)
      return sendJson(res, 200, { ok: true })
    }
    const body = await readJsonBody(req, { limit: referenceJsonBodyLimit(1) })
    const reference = normalizeReference(body)
    if (!reference) return sendError(res, 400, 'missing-reference', '参考图为空')
    const item = await writeRef(kind, reference.buffer, reference.mediaType)
    sendJson(res, 200, { ok: true, item })
  }
}

// Focus an already-open Explorer window for `dir` instead of stacking duplicate
// windows; the caller opens a new window only when this script reports NOTFOUND.
const FOCUS_EXPLORER_SCRIPT = `$ErrorActionPreference = 'SilentlyContinue'
$target = $env:DSH_PW_FOLDER
if ([string]::IsNullOrWhiteSpace($target)) { Write-Output 'NOTFOUND'; exit 0 }
try { $target = [System.IO.Path]::GetFullPath($target).TrimEnd('\\') } catch { Write-Output 'NOTFOUND'; exit 0 }
$found = $null
try {
  $shell = New-Object -ComObject Shell.Application
  foreach ($window in $shell.Windows()) {
    try {
      $path = $window.Document.Folder.Self.Path
      if ([string]::IsNullOrWhiteSpace($path)) { continue }
      $normalized = [System.IO.Path]::GetFullPath($path).TrimEnd('\\')
      if ([string]::Equals($normalized, $target, [System.StringComparison]::OrdinalIgnoreCase)) { $found = $window; break }
    } catch { }
  }
} catch { }
if ($null -eq $found) { Write-Output 'NOTFOUND'; exit 0 }
try {
  $found.Visible = $true
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DshFocusExistingFolder {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@
  $handle = [IntPtr][int64]$found.HWND
  # A hidden/minimized window left by an earlier launch must not be "focused"
  # into nothing: restore and show it first. If it still cannot be made visible,
  # report NOTFOUND so the caller opens a fresh visible window instead.
  [void][DshFocusExistingFolder]::ShowWindow($handle, 9)
  [void][DshFocusExistingFolder]::ShowWindow($handle, 5)
  if (-not [DshFocusExistingFolder]::IsWindowVisible($handle)) { [void][DshFocusExistingFolder]::ShowWindow($handle, 1) }
  if (-not [DshFocusExistingFolder]::IsWindowVisible($handle)) {
    Write-Output 'NOTFOUND'
    exit 0
  }
  $foreground = [DshFocusExistingFolder]::GetForegroundWindow()
  $foregroundPid = [uint32]0
  $foregroundThread = [DshFocusExistingFolder]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $currentThread = [DshFocusExistingFolder]::GetCurrentThreadId()
  if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
    [void][DshFocusExistingFolder]::AttachThreadInput($currentThread, $foregroundThread, $true)
    [void][DshFocusExistingFolder]::BringWindowToTop($handle)
    [void][DshFocusExistingFolder]::SetForegroundWindow($handle)
    [void][DshFocusExistingFolder]::AttachThreadInput($currentThread, $foregroundThread, $false)
  } else {
    [void][DshFocusExistingFolder]::BringWindowToTop($handle)
    [void][DshFocusExistingFolder]::SetForegroundWindow($handle)
  }
  [DshFocusExistingFolder]::SwitchToThisWindow($handle, $true)
} catch { }
try {
  $wscript = New-Object -ComObject WScript.Shell
  [void]$wscript.AppActivate([string]$found.LocationName)
} catch { }
Write-Output 'FOUND'
exit 0`

const POWERSHELL_EXE = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

/**
 * Spawn a detached GUI helper and report whether the OS really started it.
 * `spawn()` does not throw for a missing executable: the failure arrives as an
 * `error` event, which used to be swallowed while the caller still returned true
 * (so "打开输出目录" reported success without opening anything). Resolves false on
 * any spawn error, true once the child is up, and true after a short grace period
 * if the platform emits neither event.
 */
function openDetached(command, args) {
  return new Promise(resolve => {
    let settled = false
    const settle = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let child
    try {
      // No windowsHide: Explorer is a GUI app and a hidden-start window would never
      // become visible (that made "打开输出目录" look broken).
      child = spawn(command, args, { detached: true, stdio: 'ignore' })
    } catch {
      settle(false)
      return
    }
    child.once('error', () => settle(false))
    child.once('spawn', () => settle(true))
    child.unref()
    setTimeout(() => settle(true), 500).unref?.()
  })
}

function openNewWindow(dir) {
  return openDetached('explorer.exe', [dir])
}

/** Resolves 'focused' (an existing Explorer window was brought forward),
 *  'opened' (a new window/file manager was started) or false (nothing was
 *  started, so the caller must report a real failure). */
async function openFolder(dir) {
  if (process.platform !== 'win32') {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
    return (await openDetached(command, [dir])) ? 'opened' : false
  }
  return new Promise(resolve => {
    const openFresh = () => {
      openNewWindow(dir).then(opened => resolve(opened ? 'opened' : false))
    }
    try {
      // Try to focus an existing window first; fall back to a new Explorer window.
      execFile(
        POWERSHELL_EXE,
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', FOCUS_EXPLORER_SCRIPT],
        {
          windowsHide: true,
          timeout: 8000,
          env: { ...process.env, DSH_PW_FOLDER: String(dir || '') },
        },
        (error, stdout) => {
          // Only an exact FOUND means an existing window was focused; NOTFOUND and
          // any failure open a fresh Explorer window.
          const focused = String(stdout || '').trim() === 'FOUND'
          if (focused) resolve('focused')
          else openFresh()
        },
      )
    } catch {
      openFresh()
    }
  })
}

/**
 * True when `candidate` is `rootDir` itself or something below it. Both sides are
 * resolved first, so a relative path, `..`, a trailing separator or a
 * differently-cased spelling on Windows cannot slip out; the comparison is
 * separator-aware so `C:\out2` is not accepted for the root `C:\out`.
 */
function isPathInside(rootDir, candidate) {
  const normalize = value => (process.platform === 'win32' ? value.toLowerCase() : value)
  const root = normalize(path.resolve(rootDir))
  const target = normalize(path.resolve(candidate))
  if (root === target) return true
  return target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
}

/** True when both values point at the same directory (case-insensitive on
 *  Windows), so `C:\Out` and `c:\out` are the same folder. */
function isSamePath(a, b) {
  const normalize = value => (process.platform === 'win32' ? value.toLowerCase() : value)
  return normalize(path.resolve(a)) === normalize(path.resolve(b))
}

/** Resolved directory `/reveal` may open, or undefined when it is outside the
 *  output folder. The real paths are re-checked when they exist, so a
 *  symlink/junction inside the output folder is not a way out either. */
async function resolveRevealDir(outputDir, requested) {
  const root = path.resolve(outputDir)
  const target = requested ? path.resolve(requested) : root
  if (!isPathInside(root, target)) return undefined
  try {
    const realRoot = await fs.realpath(root)
    const realTarget = await fs.realpath(target)
    if (!isPathInside(realRoot, realTarget)) return undefined
  } catch {
    // Target (or the output folder itself) does not exist yet: the lexical check
    // above is the contract, and only a directory inside it is created below.
  }
  return target
}

/** Builds the next settings object from a POST body without mutating the current
 *  one. Profile ids are merged so an empty apiKey keeps the previously saved key
 *  and duplicate ids cannot create two active-profile candidates. */
function applySettingsBody(current, body) {
  const next = {
    version: 2,
    activeId: current.activeId,
    outputDir: current.outputDir,
    profiles: current.profiles.map(profile => ({ ...profile })),
    vision: {
      activeId: current.vision.activeId,
      profiles: (current.vision.profiles || []).map(profile => ({ ...profile })),
    },
  }
  if (typeof body.outputDir === 'string') {
    const trimmed = body.outputDir.trim()
    // An explicitly cleared field means "reset to the default folder" instead of
    // silently snapping back to the old path in the UI.
    next.outputDir = trimmed ? path.resolve(trimmed) : defaultOutputDir()
  }

  // Optional third-party vision endpoints for product/size-chart recognition.
  // activeId '' means the Harness built-in model. An empty apiKey keeps the
  // saved key; clearApiKey removes it.
  if (body.vision && typeof body.vision === 'object') {
    const existing = new Map((current.vision.profiles || []).map(profile => [profile.id, profile]))
    if (Array.isArray(body.vision.profiles)) {
      const merged = []
      const seenIds = new Set()
      for (const raw of body.vision.profiles) {
        if (!raw || typeof raw !== 'object') continue
        const id = typeof raw.id === 'string' && raw.id ? raw.id : newVisionProfileId()
        if (seenIds.has(id)) continue
        seenIds.add(id)
        const previous = existing.get(id) || {}
        const profile = normalizeVisionProfile({
          id,
          name: raw.name !== undefined ? raw.name : previous.name,
          baseUrl: raw.baseUrl !== undefined ? raw.baseUrl : previous.baseUrl,
          model: raw.model !== undefined ? raw.model : previous.model,
          apiKey: previous.apiKey || '',
        })
        if (raw.clearApiKey === true) profile.apiKey = ''
        if (typeof raw.apiKey === 'string' && raw.apiKey.trim()) profile.apiKey = raw.apiKey.trim()
        merged.push(profile)
      }
      const wantedId = typeof body.vision.activeId === 'string' ? body.vision.activeId : ''
      next.vision = {
        activeId: merged.some(profile => profile.id === wantedId) ? wantedId : '',
        profiles: merged,
      }
    } else if (typeof body.vision.baseUrl === 'string' || typeof body.vision.model === 'string') {
      // Legacy flat payload from a page that has not been refreshed yet.
      const first = (current.vision.profiles || [])[0] || normalizeVisionProfile({ name: '视觉接口' })
      const updated = normalizeVisionProfile({
        ...first,
        name: body.vision.name !== undefined ? body.vision.name : first.name,
        baseUrl: body.vision.baseUrl !== undefined ? body.vision.baseUrl : first.baseUrl,
        model: body.vision.model !== undefined ? body.vision.model : first.model,
        apiKey: first.apiKey || '',
      })
      if (body.vision.clearApiKey === true) updated.apiKey = ''
      if (typeof body.vision.apiKey === 'string' && body.vision.apiKey.trim()) updated.apiKey = body.vision.apiKey.trim()
      next.vision = { activeId: updated.id, profiles: [updated] }
    }
    // Switching between already-saved visual endpoints can be persisted on its
    // own, exactly like the image profile chips, so extraction uses it at once.
    if (
      !Array.isArray(body.vision.profiles)
      && typeof body.vision.baseUrl !== 'string'
      && typeof body.vision.model !== 'string'
      && typeof body.vision.activeId === 'string'
    ) {
      const wanted = body.vision.activeId
      next.vision.activeId = next.vision.profiles.some(profile => profile.id === wanted) ? wanted : ''
    }
  }

  if (Array.isArray(body.profiles)) {
    const existing = new Map(current.profiles.map(profile => [profile.id, profile]))
    const merged = []
    const seenIds = new Set()
    for (const raw of body.profiles) {
      if (!raw || typeof raw !== 'object') continue
      const id = typeof raw.id === 'string' && raw.id ? raw.id : newProfileId()
      if (seenIds.has(id)) continue
      seenIds.add(id)
      const previous = existing.get(id) || {}
      const profile = normalizeProfile({
        id,
        name: raw.name !== undefined ? raw.name : previous.name,
        baseUrl: raw.baseUrl !== undefined ? raw.baseUrl : previous.baseUrl,
        model: raw.model !== undefined ? raw.model : previous.model,
        quality: raw.quality !== undefined ? raw.quality : previous.quality,
        requestType: raw.requestType !== undefined ? raw.requestType : previous.requestType,
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
  const flatKeys = ['baseUrl', 'model', 'quality', 'apiKey', 'clearApiKey']
  if (!Array.isArray(body.profiles) && flatKeys.some(key => key in body)) {
    const targetId = next.activeId
    next.profiles = next.profiles.map(profile => {
      if (profile.id !== targetId) return profile
      const updated = { ...profile }
      if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) updated.baseUrl = normalizeBaseUrl(body.baseUrl)
      if (typeof body.model === 'string' && body.model.trim()) updated.model = body.model.trim()
      if (typeof body.quality === 'string') updated.quality = body.quality.trim()
      if (body.clearApiKey === true) updated.apiKey = ''
      if (typeof body.apiKey === 'string' && body.apiKey.trim()) updated.apiKey = body.apiKey.trim()
      return updated
    })
  }
  return next
}

/** Credentials for the /test and /models probes. A caller-supplied baseUrl that
 *  differs from the saved profile endpoint must never be combined with the saved
 *  secret, otherwise the key would be sent to a caller-chosen (possibly hostile)
 *  URL. In that case an explicit body.apiKey is required. */
function resolveProbeCredentials(settings, body) {
  const requestedId = typeof body.profileId === 'string' && body.profileId ? body.profileId : ''
  const fallbackProfile = activeProfile(settings)
  const savedProfile = requestedId ? settings.profiles.find(item => item.id === requestedId) || null : null
  const hasBaseOverride = typeof body.baseUrl === 'string' && body.baseUrl.trim() !== ''
  const requestedBase = hasBaseOverride ? normalizeOptionalBaseUrl(body.baseUrl) : ''
  const referenceProfile = savedProfile || (requestedId ? null : fallbackProfile)
  const referenceBase = referenceProfile ? normalizeOptionalBaseUrl(referenceProfile.baseUrl) : ''
  const baseDiffers = hasBaseOverride && (!referenceProfile || requestedBase !== referenceBase)
  const trustedSource = !requestedId || Boolean(savedProfile)
  const base = normalizeBaseUrl(hasBaseOverride ? requestedBase : (referenceProfile ? referenceProfile.baseUrl : ''))
  let apiKey = ''
  if (body.apiKey !== undefined) {
    apiKey = String(body.apiKey || '')
  } else if (trustedSource && !baseDiffers && referenceProfile) {
    apiKey = referenceProfile.apiKey || ''
  }
  return { base, apiKey: apiKey.trim(), savedProfile, baseDiffers }
}

function createHandlers(ctx) {
  const handlers = {
    async health(req, res) {
      if (!methodAllowed(req, res, ['GET'])) return
      const settings = await readSettings()
      const active = activeProfile(settings)
      const activePublic = publicProfile(active)
      const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
      // "Why can't I generate?" has to be answerable from this one response:
      // profile + key, model, and whether the output folder really exists and is
      // writable (a read-only or removed folder used to fail only at save time).
      let outputDirExists = false
      try {
        outputDirExists = (await fs.stat(outputDir)).isDirectory()
      } catch {
        outputDirExists = false
      }
      let outputDirWritable = false
      if (outputDirExists) {
        try {
          await fs.access(outputDir, fsConstants.W_OK)
          outputDirWritable = true
        } catch {
          outputDirWritable = false
        }
      }
      const reasons = []
      if (!settingsHealthy) reasons.push('settings-corrupt')
      if (!activePublic.hasApiKey) reasons.push('missing-api-key')
      if (!outputDirExists) reasons.push('output-dir-missing')
      else if (!outputDirWritable) reasons.push('output-dir-unwritable')
      sendJson(res, 200, {
        ok: true,
        canGenerate: reasons.length === 0,
        reasons,
        settingsFile: settingsFile(),
        settingsHealthy,
        warning: settingsWarning || undefined,
        outputDir,
        outputDirExists,
        outputDirWritable,
        hasApiKey: activePublic.hasApiKey,
        activeProfile: {
          id: active.id,
          name: active.name,
          model: active.model,
          baseUrl: active.baseUrl,
          requestType: activePublic.requestType,
          quality: activePublic.quality,
        },
        profileCount: settings.profiles.length,
        vision: {
          activeId: settings.vision.activeId || '',
          profileCount: (settings.vision.profiles || []).length,
          ready: Boolean(activeVisionProfile(settings.vision)),
        },
        platform: process.platform,
        node: process.version,
      })
    },

    async getSettings(req, res) {
      const settings = await readSettings()
      sendJson(res, 200, { ok: true, settings: publicSettings(settings), warning: settingsWarning || undefined })
    },

    async settingsRoute(req, res) {
      if (!methodAllowed(req, res, ['GET', 'POST', 'PUT'])) return
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'POST' || method === 'PUT') return handlers.postSettings(req, res)
      return handlers.getSettings(req, res)
    },

    async postSettings(req, res) {
      const body = await readJsonBody(req)
      // Settings are a read-modify-write resource: serialise overlapping saves
      // (e.g. "save" racing "switch active profile") so neither loses the other.
      const next = await mutateSettings(current => applySettingsBody(current, body))
      sendJson(res, 200, { ok: true, settings: publicSettings(next) })
    },

    async test(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req)
      const settings = await readSettings()
      const { base, apiKey, savedProfile, baseDiffers } = resolveProbeCredentials(settings, body)
      if (!apiKey) {
        return sendError(res, 400, 'missing-api-key', baseDiffers
          ? '填写的接口地址与已保存配置不同，请先填写对应接口的 API Key 再测试'
          : '尚未配置 API Key（可先填写再测试，无需保存）')
      }
      const endpoint = `${base}/models`
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}` },
          signal: timeoutSignal(20000),
        })
        const text = await response.text()
        if (!response.ok) {
          const detail = `HTTP ${response.status}: ${trim(text, 300)}`
          return sendJson(res, 200, { ok: false, code: classifyError(imageApiError(detail, response.status)).code, error: detail })
        }
        const label = savedProfile ? savedProfile.name : base
        sendJson(res, 200, { ok: true, endpoint, message: `${label} · API Key 可用（/models 探测成功）` })
      } catch (error) {
        const message = String(error && error.message ? error.message : error)
        sendJson(res, 200, { ok: false, code: classifyError(error).code, error: message })
      }
    },

    async models(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req)
      const settings = await readSettings()
      // The optional vision model has its own endpoint/key, so model discovery
      // must not borrow the active image profile's key.
      if (body.source === 'vision') {
        const vision = settings.vision
        const saved = (body.profileId && (vision.profiles || []).find(item => item.id === body.profileId)) || null
        const hasBase = typeof body.baseUrl === 'string' && body.baseUrl.trim() !== ''
        const baseUrl = hasBase ? body.baseUrl : (saved && saved.baseUrl) || ''
        const savedBase = saved ? normalizeOptionalBaseUrl(saved.baseUrl) : ''
        const baseDiffers = hasBase && (!saved || normalizeOptionalBaseUrl(body.baseUrl) !== savedBase)
        const apiKey = body.apiKey !== undefined
          ? String(body.apiKey || '')
          : (saved && !baseDiffers ? saved.apiKey : '')
        if (!baseUrl) throw new Error('请先填写视觉接口地址，再拉取模型')
        const result = await fetchModelIds(
          { baseUrl, apiKey },
          { baseUrl, apiKey, allowEmptyKey: true },
        )
        return sendJson(res, 200, { ok: true, ...result, source: 'vision', profileId: saved ? saved.id : undefined })
      }
      const { base: resolvedBase, apiKey: resolvedKey } = resolveProbeCredentials(settings, body)
      const result = await fetchModelIds(
        { baseUrl: resolvedBase, apiKey: resolvedKey },
        { baseUrl: resolvedBase, apiKey: resolvedKey },
      )
      sendJson(res, 200, { ok: true, ...result })
    },

    refModel: makeRefHandler('model'),

    refScene: makeRefHandler('scene'),

    refLogo: makeRefHandler('logo'),

    async refProducts(req, res) {
      if (!methodAllowed(req, res, ['GET', 'POST', 'DELETE'])) return
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        return sendJson(res, 200, { ok: true, items: await readProductRefs() })
      }
      if (method === 'DELETE') {
        await queueProductRefsMutation(() => deleteProductRefs())
        return sendJson(res, 200, { ok: true, items: [] })
      }
      const body = await readJsonBody(req, { limit: referenceJsonBodyLimit(PRODUCT_REF_LIMIT) })
      // Over the limit is an error, not a silent truncation: the page keeps at
      // most PRODUCT_REF_LIMIT photos, so a longer list can only come from a
      // request that bypassed the page.
      const references = fillReferences(body.references, PRODUCT_REF_LIMIT)
      // An empty body must not silently wipe the saved product photos; clearing
      // is an explicit action (client sends clear:true, or uses DELETE).
      if (references.length === 0 && body.clear !== true) {
        return sendError(res, 400, 'missing-reference', '没有有效的商品参考图；如需清空请使用 DELETE 或 clear:true')
      }
      const items = await queueProductRefsMutation(() => writeProductRefs(references))
      sendJson(res, 200, { ok: true, items })
    },

    async extract(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req, { limit: referenceJsonBodyLimit(EXTRACT_REF_LIMIT) })
      const settings = await readSettings()
      const references = fillReferences(body.references, EXTRACT_REF_LIMIT)
      if (references.length === 0) return sendError(res, 400, 'missing-reference', '请先上传商品参考图')
      sendJson(res, 200, { ok: true, ...(await extractKeyElements(ctx, settings, references)) })
    },

    async extractSize(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req, { limit: referenceJsonBodyLimit(EXTRACT_SIZE_REF_LIMIT) })
      const settings = await readSettings()
      const references = fillReferences(body.references, EXTRACT_SIZE_REF_LIMIT)
      if (references.length === 0) return sendError(res, 400, 'missing-reference', '请先上传尺码表图片')
      sendJson(res, 200, { ok: true, ...(await extractSizeTable(ctx, settings, references)) })
    },

    async generate(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req, { limit: referenceJsonBodyLimit(GENERATE_REF_LIMIT) })
      const settings = await readSettings()
      try {
        sendJson(res, 200, await generateImages(settings, body))
      } catch (error) {
        // Keep a small failure record next to the generated-image sidecars; a
        // "concurrency keeps failing" report can then be diagnosed from disk.
        // Only upstream/internal failures are worth a record: a rejected request
        // (too many references, bad image, prompt too long, body too large, ...) is
        // answered with a 4xx and must not litter the output folder with files the
        // user has to wonder about.
        const failure = classifyError(error)
        if (failure.status >= 500) {
          try {
            const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
            const profile = (body.profileId && settings.profiles.find(item => item.id === body.profileId)) || activeProfile(settings)
            const references = Array.isArray(body.references) ? body.references : []
            const referenceCount = references.length + (body.reference ? 1 : 0)
            await writeFailure(outputDir, {
              at: Date.now(),
              code: failure.code,
              error: String(error && error.message ? error.message : error),
              mode: referenceCount > 0 ? 'edit' : 'generate',
              profileId: profile.id,
              profileName: profile.name,
              model: String(body.model || profile.model || ''),
              size: String(body.size || ''),
              refCount: referenceCount,
              prompt: String(body.prompt || '').slice(0, 2000),
            })
          } catch {
            // diagnostics only; the caller still gets the real error
          }
        }
        throw error
      }
    },

    async history(req, res) {
      if (!methodAllowed(req, res, ['GET'])) return
      const url = new URL(req.url, 'http://127.0.0.1')
      const limit = Number(url.searchParams.get('limit') || 60)
      const settings = await readSettings()
      sendJson(res, 200, { ok: true, ...(await listHistory(settings, Number.isFinite(limit) ? limit : 60)) })
    },

    /** Saves a rendered size-chart PNG into a folder the user picked. The folder
     *  must already exist; nothing outside it is touched, and the file name is
     *  reduced to a safe basename (the client only ever sends `size-chart-*.png`). */
    async savePoster(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const body = await readJsonBody(req, { limit: POSTER_BODY_LIMIT })
      const dir = typeof body.dir === 'string' ? body.dir.trim() : ''
      if (!dir) return sendError(res, 400, 'missing-dir', '缺少保存目录')
      const targetDir = path.resolve(dir)
      let stats
      try {
        stats = await fs.stat(targetDir)
      } catch {
        return sendError(res, 404, 'dir-not-found', `目录不存在：${targetDir}`)
      }
      if (!stats.isDirectory()) return sendError(res, 404, 'dir-not-found', `不是目录：${targetDir}`)
      const base64 = typeof body.dataBase64 === 'string' ? body.dataBase64.trim() : ''
      if (!base64) return sendError(res, 400, 'missing-image', '海报内容为空')
      const buffer = Buffer.from(base64, 'base64')
      if (buffer.length === 0) return sendError(res, 400, 'missing-image', '海报内容为空')
      // base64 inflates 4:3, so the text limit already caps the decoded bytes at
      // MAX_POSTER_BYTES; this check trips at that exact ceiling (and stays the
      // real guard if POSTER_BODY_LIMIT is ever raised).
      if (buffer.length >= MAX_POSTER_BYTES) {
        return sendError(
          res,
          413,
          'body-too-large',
          `海报过大（上限 ${formatMegabytes(MAX_POSTER_BYTES)}，请求体上限 ${formatMegabytes(POSTER_BODY_LIMIT)}）`,
        )
      }
      if (detectImageMediaType(buffer) !== 'image/png') {
        return sendError(res, 400, 'invalid-reference', '海报不是有效的 PNG')
      }
      const requested = path.basename(typeof body.name === 'string' ? body.name : '')
      const safe = /^[A-Za-z0-9._-]{1,80}\.png$/i.test(requested) ? requested : 'size-chart.png'
      const stem = safe.replace(/\.png$/i, '')
      let finalName = safe
      for (let index = 1; index < 1000; index += 1) {
        try {
          await fs.access(path.join(targetDir, finalName))
          finalName = `${stem}-${index}.png`
        } catch {
          break
        }
      }
      await writeFileAtomic(path.join(targetDir, finalName), buffer)
      sendJson(res, 200, { ok: true, path: path.join(targetDir, finalName), dir: targetDir })
    },

    async reveal(req, res) {
      if (!methodAllowed(req, res, ['POST'])) return
      const settings = await readSettings()
      const outputDir = path.resolve(String(settings.outputDir || defaultOutputDir()))
      // Nothing but the output folder (or a subfolder of it) may be opened: a
      // caller-supplied `path` is accepted for convenience, but it is resolved and
      // contained here instead of being handed to Explorer as-is.
      const body = await readJsonBody(req)
      const requested = typeof body.path === 'string' ? body.path.trim() : ''
      const target = await resolveRevealDir(outputDir, requested)
      if (!target) {
        return sendError(res, 403, 'reveal-outside-output-dir', '只能打开输出目录或其子目录')
      }
      // Only the output folder itself is created on demand (so "打开输出目录"
      // works before the first image exists). A caller-supplied subfolder is never
      // created: that turned /reveal into a recursive mkdir for any depth inside
      // the folder, and it must only ever open something that already exists.
      if (isSamePath(target, outputDir)) {
        try {
          await fs.mkdir(target, { recursive: true })
        } catch {
          // opening can still report the failure below
        }
      } else {
        let stats
        try {
          stats = await fs.stat(target)
        } catch {
          return sendError(res, 404, 'dir-not-found', `目录不存在：${target}`)
        }
        if (!stats.isDirectory()) {
          return sendError(res, 404, 'dir-not-found', `不是目录：${target}`)
        }
      }
      const result = await openFolder(target)
      // `openFolder` only resolves false when nothing was started, so this is a
      // real failure now instead of an unconditional ok:true.
      if (result === false) {
        return sendError(res, 500, 'open-failed', `无法打开输出目录：${target}`)
      }
      sendJson(res, 200, {
        ok: true,
        focused: result === 'focused',
        outputDir,
        path: target,
      })
    },

  }
  return handlers
}

/** Trust for the raw webServer routes.
 *
 *  `trustedOrigins` holds the exact `scheme//host:port` keys the GUI is served
 *  from (loopback + the URLs the harness advertises). `trustedLocalEndpoints`
 *  holds the `scheme//port` of the trusted origins that are bound locally, so a
 *  loopback alias (`localhost` / `127.0.0.1` / `[::1]`) of *that same scheme and
 *  port* is accepted too — and nothing else: another port or another scheme
 *  (`https://127.0.0.1:58074` for an `http://` server) stays untrusted.
 *  `trustedRequestHostnames` stays a hostname set for the Host-header check. */
const trustedOrigins = new Set()
const trustedLocalEndpoints = new Set()
const trustedRequestHostnames = new Set()

/** `scheme//host:port` of an absolute http(s) URL, with the default port made
 *  explicit (`http://localhost` === `http://localhost:80`); '' when unusable. */
function originKeyOf(value) {
  let url
  try {
    url = new URL(String(value == null ? '' : value).trim())
  } catch {
    return ''
  }
  const scheme = url.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') return ''
  const host = url.hostname.toLowerCase()
  if (!host) return ''
  const port = url.port || (scheme === 'https:' ? '443' : '80')
  return `${scheme}//${host}:${port}`
}

function splitOriginKey(key) {
  const separator = key.indexOf('//')
  const scheme = key.slice(0, separator)
  const rest = key.slice(separator + 2)
  const colon = rest.lastIndexOf(':')
  return { scheme, host: rest.slice(0, colon), port: rest.slice(colon + 1) }
}

function configureRequestTrust(ctx) {
  trustedOrigins.clear()
  trustedLocalEndpoints.clear()
  trustedRequestHostnames.clear()
  const remember = value => {
    const key = originKeyOf(value)
    if (!key) return
    const parts = splitOriginKey(key)
    trustedOrigins.add(key)
    trustedRequestHostnames.add(parts.host)
    // A wildcard bind (0.0.0.0 / ::) serves the same port locally, so it trusts
    // the loopback aliases of that endpoint as well.
    if (isLoopbackHostname(parts.host) || parts.host === '0.0.0.0' || parts.host === '::') {
      trustedLocalEndpoints.add(`${parts.scheme}//${parts.port}`)
    }
  }
  try {
    remember(ctx.webServer.getOrigin())
  } catch {
    // older webServer without getOrigin
  }
  try {
    const webApp = ctx.get ? ctx.get('webApp') : ctx.webApp
    if (webApp && typeof webApp.getAdvertisedUrl === 'function') remember(webApp.getAdvertisedUrl())
  } catch {
    // webApp is optional
  }
  // With no usable origin every request that carries an Origin header is refused,
  // which would look like "the workbench page is broken". Say so once instead.
  if (trustedOrigins.size === 0) {
    console.warn('[personal-workbench] 未能获取 Web GUI 的 Origin，所有带 Origin 的请求都会被拒绝；请检查 webServer.getOrigin()')
  }
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost'
    || value === '::1'
    || value === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(value)
}

function isTrustedHostname(hostname) {
  return isLoopbackHostname(hostname) || trustedRequestHostnames.has(String(hostname || '').toLowerCase())
}

/** An Origin/Referer URL is trusted only on an exact scheme+host+port match, or
 *  as a loopback alias of a trusted local endpoint (same scheme, same port). */
function isTrustedOrigin(value) {
  const key = originKeyOf(value)
  if (!key) return false
  if (trustedOrigins.has(key)) return true
  const parts = splitOriginKey(key)
  if (!isLoopbackHostname(parts.host)) return false
  return trustedLocalEndpoints.has(`${parts.scheme}//${parts.port}`)
}

const HOST_HEADER_PATTERN = /^[A-Za-z0-9.\-:\[\]]+$/

function hostnameFromHostHeader(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  // Fail closed on anything that is not a plain host[:port]: the WHATWG parser
  // would happily read `localhost#@evil` as `localhost`, which would let a
  // hand-written Host header pass as a trusted name.
  if (!HOST_HEADER_PATTERN.test(value)) return ''
  try {
    return new URL(`http://${value}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Raw webServer routes bypass the Harness API authentication, so they must
 *  reject browser CSRF *and* DNS-rebinding attempts themselves:
 *  - `Sec-Fetch-Site: cross-site` is refused outright;
 *  - the Host must be a loopback/advertised hostname and a plain host[:port]
 *    (rebinding sends another hostname while the socket reaches 127.0.0.1);
 *  - a present `Origin` (else `Referer`) must match a trusted origin exactly:
 *    same scheme, same host, same port — a page on `localhost:<other port>` is a
 *    different origin and must not drive this API;
 *  - requests without either header are local scripts/CLI and stay usable. */
function requestOriginAllowed(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (site === 'cross-site') return false
  const hostName = hostnameFromHostHeader(req.headers.host)
  if (!hostName || !isTrustedHostname(hostName)) return false
  const origin = String(req.headers.origin || '')
  if (origin) {
    // "Origin: null" (sandboxed iframe / opaque origin) is never a URL, so it
    // fails here and is never trusted.
    return isTrustedOrigin(origin)
  }
  const referer = String(req.headers.referer || '')
  if (referer) return isTrustedOrigin(referer)
  return true
}

function wrap(handler) {
  return (req, res) => {
    if (!requestOriginAllowed(req)) {
      sendError(res, 403, 'cross-site-denied', '跨站请求已拒绝：请从工作台页面操作')
      return
    }
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(error => {
        try {
          const failure = classifyError(error)
          sendError(res, failure.status, failure.code, error && error.message ? error.message : String(error))
        } catch {
          // response already finished
        }
      })
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    configureRequestTrust(ctx)
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
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/poster`, handler: wrap(handlers.savePoster) }),
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
