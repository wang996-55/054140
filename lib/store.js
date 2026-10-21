/**
 * Storage primitives: every byte the replica pipeline produces lives under one
 * root so "任务与本地文件" is answerable. Writes are atomic (temp + fsync +
 * rename) and per-key locks keep concurrent routes from interleaving.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { AppError } from './errors.js'

export const ROOT_NAME = 'ai-replica'

export function profileRoot() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv && String(fromEnv).trim()) return path.resolve(String(fromEnv))
  return path.join(os.homedir(), '.dsh')
}

export function rootDir() {
  return path.join(profileRoot(), ROOT_NAME)
}

export function taskDir(id) {
  const safe = safeId(id)
  if (!safe) throw new AppError('bad-request', '任务编号不合法')
  return path.join(rootDir(), 'tasks', safe)
}

export function assetsDir(taskId) {
  return path.join(taskDir(taskId), 'assets')
}

export function exportsDir(taskId) {
  return path.join(taskDir(taskId), 'exports')
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function ensureRoot() {
  await ensureDir(path.join(rootDir(), 'tasks'))
  return rootDir()
}

export function sha256(input) {
  const hash = createHash('sha256')
  hash.update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input)
  return hash.digest('hex')
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function safeId(value) {
  const text = String(value == null ? '' : value).trim()
  return ID_PATTERN.test(text) && !text.includes('..') ? text : ''
}

export function newId(prefix = 'x') {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
}

/** Resolves `relative` inside `root`; null when it would escape (path traversal,
 *  absolute paths, drive letters, `..` segments). */
export function containedPath(root, relative) {
  const base = path.resolve(root)
  const raw = String(relative == null ? '' : relative).replace(/\\/g, '/')
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.split('/').includes('..')) return null
  const target = path.resolve(base, raw)
  if (target !== base && !target.startsWith(base + path.sep)) return null
  return target
}

async function fsyncDir(dir) {
  try {
    const handle = await fs.open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Directory fsync is best-effort (and unsupported on some platforms).
  }
}

export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file))
  const temp = `${file}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  const text = `${JSON.stringify(value, null, 2)}\n`
  const handle = await fs.open(temp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temp, file)
  await fsyncDir(path.dirname(file))
}

export async function writeBytesAtomic(file, buffer) {
  await ensureDir(path.dirname(file))
  const temp = `${file}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  const handle = await fs.open(temp, 'w')
  try {
    await handle.writeFile(buffer)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temp, file)
  await fsyncDir(path.dirname(file))
}

/** Readers only ever see a complete file: a half-written temp file is invisible. */
export async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const locks = new Map()

/** Serialises mutations on one key in this process. A second holder waits, and
 *  a wait longer than `timeoutMs` fails loudly instead of corrupting state. */
export async function withLock(key, fn, timeoutMs = 5000) {
  const start = Date.now()
  while (locks.has(key)) {
    if (Date.now() - start > timeoutMs) throw new AppError('task-locked', '任务正被占用，请稍后再试')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  locks.set(key, true)
  try {
    return await fn()
  } finally {
    locks.delete(key)
  }
}

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { mime: 'image/jpeg', ext: 'jpg', width: readJpegSize(buffer).width, height: readJpegSize(buffer).height }
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp', width: 0, height: 0 }
  }
  return null
}

function readJpegSize(buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return { width: 0, height: 0 }
}

/** Saves one asset under the task directory and returns its identity. */
export async function saveAsset(taskId, buffer, { kind = 'asset', ext } = {}) {
  const type = detectImageType(buffer)
  if (!type) throw new AppError('asset-invalid', '素材无法识别：请使用 PNG / JPEG / WebP 图片')
  const assetId = safeId(`${kind}-${sha256(buffer).slice(0, 16)}`)
  const file = `${assetId}.${ext || MIME_EXT[type.mime] || type.ext}`
  const dir = assetsDir(taskId)
  await ensureDir(dir)
  const target = path.join(dir, file)
  const existing = await fs.readFile(target).catch(() => null)
  if (!existing || sha256(existing) !== sha256(buffer)) await writeBytesAtomic(target, buffer)
  return {
    asset_id: assetId,
    file,
    sha256: sha256(buffer),
    bytes: buffer.length,
    media_type: type.mime,
    width: type.width || 0,
    height: type.height || 0,
  }
}

export async function readAssetFile(taskId, assetId) {
  const dir = assetsDir(taskId)
  const entries = await fs.readdir(dir).catch(() => [])
  const name = entries.find(entry => entry.startsWith(`${safeId(assetId)}.`))
  if (!name) throw new AppError('asset-invalid', '素材不存在')
  const file = containedPath(dir, name)
  if (!file) throw new AppError('asset-invalid', '素材路径不合法')
  return { file, buffer: await fs.readFile(file) }
}

/** PNG decode of an asset, used by export and by compatibility checks. */
export async function readAssetBuffer(taskId, assetId) {
  const { buffer } = await readAssetFile(taskId, assetId)
  return buffer
}
