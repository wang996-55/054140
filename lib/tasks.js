/**
 * Task records, settings and the call budget (文档 §7 / §8).
 *
 * One task = one directory. Every mutation goes through `updateTask`, which locks,
 * re-reads, applies the mutator and writes atomically, so two route handlers can
 * never overwrite each other's fields.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from './errors.js'
import {
  rootDir, taskDir, ensureRoot, ensureDir, readJson, writeJsonAtomic, writeBytesAtomic,
  withLock, safeId, newId, sha256, exportsDir,
} from './store.js'

export const STATE_FLOW = [
  'created', 'analyzing', 'scene_review', 'mask_review', 'background_review', 'editing', 'exporting', 'done',
]

export const TERMINAL_STATES = ['done', 'cancelled', 'failed', 'remote_outcome_unknown', 'mask_rejected']

const ALLOWED = {
  created: ['analyzing', 'scene_review', 'cancelled', 'failed'],
  analyzing: ['scene_review', 'remote_outcome_unknown', 'cancelled', 'failed'],
  scene_review: ['analyzing', 'mask_review', 'cancelled', 'failed'],
  mask_review: ['background_review', 'mask_rejected', 'cancelled', 'failed'],
  mask_rejected: ['mask_review', 'cancelled', 'failed'],
  background_review: ['editing', 'cancelled', 'failed'],
  editing: ['exporting', 'cancelled', 'failed'],
  exporting: ['done', 'editing', 'cancelled', 'failed'],
  done: [],
  cancelled: [],
  failed: [],
  remote_outcome_unknown: ['scene_review', 'analyzing', 'cancelled'],
}

export function canTransition(from, to) {
  if (from === to) return true
  return (ALLOWED[from] || []).indexOf(to) >= 0
}

// ------------------------------------------------------------ config files

export function settingsFile() {
  return path.join(rootDir(), 'settings.json')
}

export function secretsFile() {
  return path.join(rootDir(), 'secrets.json')
}

export async function readSettings() {
  const raw = await readJson(settingsFile(), null)
  return raw && typeof raw === 'object' ? raw : null
}

export async function writeSettings(value) {
  await ensureRoot()
  await writeJsonAtomic(settingsFile(), value)
  return value
}

export async function readSecrets() {
  const raw = await readJson(secretsFile(), null)
  return raw && typeof raw === 'object' ? raw : null
}

export async function writeSecrets(value) {
  await ensureRoot()
  const file = secretsFile()
  await writeJsonAtomic(file, value)
  try {
    await fs.chmod(file, 0o600)
  } catch {
    // Windows has no POSIX mode; the directory is already user-private.
  }
  return value
}

export async function clearSecrets() {
  await fs.rm(secretsFile(), { force: true }).catch(() => {})
}

// ------------------------------------------------------------------ tasks

function stamp() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function taskFile(id) {
  return path.join(taskDir(id), 'task.json')
}

export function fingerprint(parts) {
  return sha256(JSON.stringify(parts)).slice(0, 32)
}

export async function createTask({ form, assets = {}, budget = {} }) {
  await ensureRoot()
  const id = `${stamp()}-${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()
  const task = {
    id,
    created_at: now,
    updated_at: now,
    state: 'created',
    version: 1,
    submitted: { form, assets },
    budget: {
      max_vision_calls: Number(budget.max_vision_calls) || 1,
      max_image_calls: Number(budget.max_image_calls) || 1,
      vision_calls: 0,
      image_calls: 0,
    },
    calls: [],
    scene: { analysis_asset: null, review_asset: null, confirmed: false },
    cutout: { mode: 'none', product_asset: null, mask_asset: null, reviewed: false, width: 0, height: 0 },
    backgrounds: [],
    compatibility: { checked: false, level: 'ok', issues: [], confirmed: false },
    composition: { saved: false, updated_at: null },
    exports: [],
    accept: { rating: 0, notes: '', accepted_at: null },
    error: null,
  }
  await ensureDir(taskDir(id))
  await ensureDir(path.join(taskDir(id), 'assets'))
  await ensureDir(exportsDir(id))
  await ensureDir(path.join(taskDir(id), 'logs'))
  await writeJsonAtomic(taskFile(id), task)
  await touchHistory(task)
  return task
}

export async function loadTask(id) {
  const safe = safeId(id)
  if (!safe) throw new AppError('bad-request', '任务编号不合法')
  const task = await readJson(taskFile(safe), null)
  if (!task || typeof task !== 'object') throw new AppError('task-not-found', '任务不存在或已被删除')
  return task
}

export async function updateTask(id, mutator) {
  const safe = safeId(id)
  if (!safe) throw new AppError('bad-request', '任务编号不合法')
  const key = `task:${safe}`
  return withLock(key, async () => {
    const task = await loadTask(safe)
    const draft = JSON.parse(JSON.stringify(task))
    const result = await mutator(draft)
    const next = result && typeof result === 'object' ? result : draft
    next.updated_at = new Date().toISOString()
    next.version = (Number(task.version) || 1) + 1
    await writeJsonAtomic(taskFile(safe), next)
    await touchHistory(next)
    return next
  })
}

export async function setState(id, state, extra) {
  return updateTask(id, task => {
    if (!canTransition(task.state, state)) {
      throw new AppError('invalid-state', `当前阶段（${task.state}）不能切换到 ${state}`)
    }
    task.state = state
    if (extra && typeof extra === 'object') Object.assign(task, extra)
    return task
  })
}

/** Machine-readable history index; rebuilt from task.json files when missing. */
async function touchHistory(task) {
  const file = path.join(rootDir(), 'history.json')
  const existing = await readJson(file, null)
  const list = Array.isArray(existing) ? existing : []
  const entry = {
    id: task.id,
    created_at: task.created_at,
    updated_at: task.updated_at,
    state: task.state,
    reference_type: task.submitted && task.submitted.form ? task.submitted.form.reference_type : 'unknown',
    product_name: task.submitted && task.submitted.assets && task.submitted.assets.product
      ? task.submitted.assets.product.name || ''
      : '',
    thumbnail: task.backgrounds && task.backgrounds.find(item => item.selected)
      ? `background:${task.backgrounds.find(item => item.selected).asset}`
      : task.submitted && task.submitted.assets && task.submitted.assets.reference
        ? `asset:${task.submitted.assets.reference.asset_id}`
        : '',
    export: task.exports && task.exports.length ? task.exports[task.exports.length - 1].file : '',
    rating: task.accept ? task.accept.rating : 0,
  }
  const next = [entry, ...list.filter(item => item && item.id !== task.id)].slice(0, 200)
  await writeJsonAtomic(file, next)
}

export async function listTasks({ limit = 50, offset = 0 } = {}) {
  const file = path.join(rootDir(), 'history.json')
  let list = await readJson(file, null)
  if (!Array.isArray(list)) {
    list = []
    const dir = path.join(rootDir(), 'tasks')
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const task = await readJson(path.join(dir, entry.name, 'task.json'), null)
      if (task && task.id) {
        list.push({ id: task.id, created_at: task.created_at, state: task.state, reference_type: task.submitted?.form?.reference_type || 'unknown', rating: task.accept?.rating || 0, export: task.exports?.[task.exports.length - 1]?.file || '', thumbnail: '' })
      }
    }
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    await writeJsonAtomic(file, list).catch(() => {})
  }
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.max(1, Math.min(200, Number(limit) || 50))
  return { total: list.length, items: list.slice(start, start + size) }
}

export async function deleteTask(id) {
  const safe = safeId(id)
  if (!safe) throw new AppError('bad-request', '任务编号不合法')
  await fs.rm(taskDir(safe), { recursive: true, force: true })
  const file = path.join(rootDir(), 'history.json')
  const list = await readJson(file, [])
  if (Array.isArray(list)) await writeJsonAtomic(file, list.filter(item => item && item.id !== safe))
}

// ------------------------------------------------------------- call budget

/** Reserves one call before the request starts; on failure the caller refunds. */
export async function reserveCall(id, kind) {
  return updateTask(id, task => {
    const key = kind === 'image' ? 'image_calls' : 'vision_calls'
    const maxKey = kind === 'image' ? 'max_image_calls' : 'max_vision_calls'
    if (task.budget[key] >= task.budget[maxKey]) {
      throw new AppError('budget-exhausted', `本任务的${kind === 'image' ? '生图' : '视觉'}调用次数预算（${task.budget[maxKey]} 次）已用尽`)
    }
    task.budget[key] += 1
    return task
  })
}

export async function refundCall(id, kind) {
  return updateTask(id, task => {
    const key = kind === 'image' ? 'image_calls' : 'vision_calls'
    task.budget[key] = Math.max(0, task.budget[key] - 1)
    return task
  })
}

export async function recordCall(id, entry) {
  return updateTask(id, task => {
    const seq = (task.calls.length || 0) + 1
    task.calls.push({
      seq,
      kind: entry.kind,
      model: entry.model || '',
      started_at: entry.started_at || new Date().toISOString(),
      finished_at: entry.finished_at || new Date().toISOString(),
      status: entry.status || 'ok',
      error_code: entry.error_code || null,
      fingerprint: entry.fingerprint || '',
      bytes: entry.bytes || 0,
    })
    return task
  })
}

/** Append-only relay log. Never contains the key, the raw base64 or the prompt. */
export async function logRelay(id, entry) {
  const safe = safeId(id)
  if (!safe) return
  try {
    const file = path.join(taskDir(safe), 'logs', 'relay.jsonl')
    await ensureDir(path.dirname(file))
    await fs.appendFile(file, `${JSON.stringify({
      at: new Date().toISOString(),
      kind: entry.kind,
      model: entry.model,
      status: entry.status,
      code: entry.code || null,
      ms: entry.ms || 0,
      bytes: entry.bytes || 0,
      fingerprint: entry.fingerprint || '',
    })}\n`, 'utf8')
  } catch {
    // Logging must never break a task.
  }
}

export async function saveExportFile(id, buffer) {
  const dir = exportsDir(id)
  await ensureDir(dir)
  const name = `export-${stamp()}-${Math.random().toString(36).slice(2, 5)}.png`
  await writeBytesAtomic(path.join(dir, name), buffer)
  return { file: name, sha256: sha256(buffer), bytes: buffer.length }
}
