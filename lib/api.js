/**
 * Route handlers for /api/ai-replica. Every gate from 文档 §2 lives here:
 * scene review, mask review, view compatibility, background review, export.
 * The Client can never skip a gate by calling the next route early — the task
 * state machine rejects it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { AppError, toErrorPayload } from './errors.js'
import {
  rootDir, saveAsset, readAssetBuffer, taskDir, containedPath, sha256, newId,
} from './store.js'
import {
  normalizeScene, validateScene, mergeSceneReview, unconfirmedAfterReview,
} from './schema.js'
import * as schema from './schema.js'
import {
  normalizeProviderSettings, resolveChannelKey, keyState, callVision, generateImage, testProvider,
  RelayError, AUTH_STYLES, VISION_PROVIDERS, IMAGE_PROVIDERS,
} from './relay.js'
import { compileScenePrompt, compileBackgroundPrompt } from './prompts.js'
import { checkCompatibility } from './scene.js'
import { decodePng, encodePng } from './png.js'
import { composeExport } from './compositor.js'
import {
  createTask, loadTask, updateTask, setState, listTasks, deleteTask, readSettings, writeSettings,
  readSecrets, writeSecrets, clearSecrets, reserveCall, refundCall, recordCall, logRelay,
  saveExportFile, fingerprint,
} from './tasks.js'

export const PREFIX = '/api/ai-replica'
const VERSION = '2.1.0'
const JSON_LIMIT = 1024 * 1024
const IMAGE_LIMIT = 32 * 1024 * 1024
const MAX_IMAGE_SIDE = 8192

const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req, limit = JSON_LIMIT) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(new AppError('body-too-large', `请求体过大（上限 ${Math.round(limit / 1048576)}MB）`))
      return
    }
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new AppError('body-too-large', `请求体过大（上限 ${Math.round(limit / 1048576)}MB）`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new AppError('invalid-json', '请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function parseDataUrl(value, { maxBytes = IMAGE_LIMIT, kind = '图片' } = {}) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value || '').trim())
  if (!match) throw new AppError('asset-invalid', `${kind}必须是 PNG / JPEG / WebP 的 data URL`)
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  if (buffer.length > maxBytes) throw new AppError('asset-too-large', `${kind}超过 ${Math.round(maxBytes / 1048576)}MB 上限`)
  if (buffer.length < 32) throw new AppError('asset-invalid', `${kind}内容是空的`)
  return { buffer, mime: `image/${match[1].toLowerCase()}` }
}

async function assetUrl(taskId, file) {
  return `${PREFIX}/file?task=${encodeURIComponent(taskId)}&file=${encodeURIComponent(file)}`
}

async function settingsOrDefaults() {
  const stored = await readSettings()
  return { settings: normalizeProviderSettings(stored || {}, null), stored }
}

const RELAY_ENUMS = {
  vision_providers: VISION_PROVIDERS,
  image_providers: IMAGE_PROVIDERS,
  auth_styles: AUTH_STYLES,
}

function sceneFromText(text) {
  const raw = String(text || '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = fenced ? fenced[1] : raw
  try {
    return JSON.parse(body)
  } catch {
    // Some relays wrap the object in prose; take the outermost {...}.
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1))
    }
    throw new AppError('scene-schema-invalid', '视觉接口返回的不是 JSON，已保存原始文本以便排查')
  }
}

async function readJsonFile(id, name) {
  try {
    const raw = await fs.readFile(path.join(taskDir(id), name), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function effectiveScene(task) {
  if (task.scene && task.scene.review_asset) {
    const review = await readJsonFile(task.id, task.scene.review_asset)
    if (review && review.scene) return { scene: review.scene, source: 'review', review }
  }
  if (task.scene && task.scene.analysis_asset) {
    const analysis = await readJsonFile(task.id, task.scene.analysis_asset)
    if (analysis && analysis.scene) return { scene: analysis.scene, source: 'analysis', analysis }
  }
  return { scene: null, source: 'none' }
}

/** Canvas pixel size implied by the submitted form (aspect + short edge). */
function canvasSize(form) {
  const raw = Number(form && form.output_size)
  const edge = Math.round(Math.min(2048, Math.max(512, Number.isFinite(raw) ? raw : 1024)))
  const aspect = String((form && form.aspect) || '1:1')
  if (aspect === '4:5') return { width: edge, height: Math.round((edge * 5) / 4), preset: '4:5' }
  if (aspect === '3:4') return { width: edge, height: Math.round((edge * 4) / 3), preset: '3:4' }
  if (aspect === '16:9') return { width: Math.round((edge * 16) / 9), height: edge, preset: '16:9' }
  return { width: edge, height: edge, preset: '1:1' }
}

/** One shape for every route that returns a task, so the page never guesses. */
async function snapshot(id) {
  const task = await loadTask(id)
  const analysis = task.scene && task.scene.analysis_asset ? await readJsonFile(id, task.scene.analysis_asset) : null
  const review = task.scene && task.scene.review_asset ? await readJsonFile(id, task.scene.review_asset) : null
  const effective = review && review.scene ? review.scene : analysis ? analysis.scene : null
  const urls = {
    reference: task.submitted.assets.reference ? await assetUrl(id, task.submitted.assets.reference.file) : '',
    product: task.submitted.assets.product ? await assetUrl(id, task.submitted.assets.product.file) : '',
    product_rgba: task.cutout.product_asset ? await assetUrl(id, task.cutout.product_asset.file) : '',
    mask: task.cutout.mask_asset ? await assetUrl(id, task.cutout.mask_asset.file) : '',
    backgrounds: task.backgrounds.map(item => ({ id: item.id, url: item.file ? `${PREFIX}/file?task=${encodeURIComponent(id)}&file=${encodeURIComponent(item.file)}` : '', normalized: item.normalized_file ? `${PREFIX}/file?task=${encodeURIComponent(id)}&file=${encodeURIComponent(item.normalized_file)}` : '' })),
    exports: task.exports.map(item => `${PREFIX}/file?task=${encodeURIComponent(id)}&file=${encodeURIComponent(item.file)}`),
  }
  const size = canvasSize(task.submitted.form)
  const defaults = schema.defaultComposition({
    background_asset_id: task.background_version_id || '',
    product_asset_id: task.cutout.product_asset ? task.cutout.product_asset.asset_id : '',
    mask_id: task.cutout.mask_asset ? task.cutout.mask_asset.asset_id : '',
  })
  defaults.canvas = { width: size.width, height: size.height, preset: size.preset }
  const saved = await readJsonFile(id, 'composition.json')
  return {
    ok: true,
    version: VERSION,
    task,
    scene: {
      analysis: analysis ? { scene: analysis.scene, raw_text: analysis.raw_text, model: analysis.model, created_at: analysis.created_at } : null,
      review: review || null,
      effective,
      missing: effective ? unconfirmedAfterReview(effective, (review && review.confirmed) || {}) : [],
    },
    urls,
    composition: saved || null,
    composition_default: defaults,
    prompts: effective
      ? { background: compileBackgroundPrompt({ lang: task.submitted.form.lang, scene: effective, form: task.submitted.form }) }
      : null,
  }
}

function requireMethod(req, methods) {
  const method = String(req.method || 'GET').toUpperCase()
  if (methods.indexOf(method) < 0) throw new AppError('method-not-allowed', '请求方法不被允许')
  return method
}

// ----------------------------------------------------------------- handlers

export function createHandlers() {
  const handlers = {}

  handlers.health = async (req, res) => {
    const secrets = await readSecrets()
    json(res, 200, {
      ok: true,
      version: VERSION,
      root: rootDir(),
      ...keyState(secrets),
      cutout: 'local-browser',
      compositor: 'host-node',
    })
  }

  handlers.settings = async (req, res) => {
    const method = requireMethod(req, ['GET', 'PUT'])
    if (method === 'GET') {
      const { settings } = await settingsOrDefaults()
      const secrets = await readSecrets()
      json(res, 200, {
        ok: true,
        settings,
        ...keyState(secrets),
        enums: schema.SCENE_ENUMS,
        labels: schema.SCENE_LABELS_ZH,
        composition_enums: schema.COMPOSITION_ENUMS,
        relay: RELAY_ENUMS,
        versions: { scene_prompt: '1', background_prompt: '1', params: '1.0' },
      })
      return
    }
    const body = await readBody(req)
    const current = (await settingsOrDefaults()).settings
    let next
    try {
      next = normalizeProviderSettings(body.settings || body, current)
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('bad-request', String(error.message || error))
    }
    await writeSettings(next)
    // 两条通道各存各的 key；同时接受旧的单 key 字段（写入两边）。
    const patch = {}
    const put = (field, value) => {
      if (typeof value !== 'string') return
      const trimmed = value.trim()
      if (trimmed) patch[field] = trimmed
      else patch[field] = ''
    }
    put('vision_api_key', body.vision_api_key)
    put('image_api_key', body.image_api_key)
    if (typeof body.api_key === 'string') {
      put('vision_api_key', body.api_key)
      put('image_api_key', body.api_key)
    }
    if (Object.keys(patch).length > 0) {
      const previous = (await readSecrets()) || {}
      const merged = { ...previous }
      for (const [field, value] of Object.entries(patch)) {
        if (value) merged[field] = value
        else delete merged[field]
      }
      delete merged.api_key
      merged.saved_at = new Date().toISOString()
      if (Object.keys(merged).length === 1) await clearSecrets()
      else await writeSecrets(merged)
    }
    const secrets = await readSecrets()
    json(res, 200, { ok: true, settings: next, ...keyState(secrets) })
  }

  handlers.test = async (req, res) => {
    requireMethod(req, ['POST'])
    const body = await readBody(req)
    if (body.confirm_cost !== true) {
      throw new AppError('bad-request', '测试会真实消耗一次请求，请先确认费用')
    }
    const { settings } = await settingsOrDefaults()
    const secrets = await readSecrets()
    const kind = body.kind === 'image' ? 'image' : 'vision'
    const visionKey = resolveChannelKey('vision', secrets).key
    const imageKey = resolveChannelKey('image', secrets).key
    if (!visionKey && !imageKey) throw new AppError('provider-missing', '尚未配置 API Key')
    const started = Date.now()
    try {
      const result = await testProvider({ settings, visionKey, imageKey, kind })
      json(res, 200, { ok: true, kind, ms: Date.now() - started, ...result })
    } catch (error) {
      const { payload, status } = toErrorPayload(error)
      json(res, status, { ...payload, kind, ms: Date.now() - started })
    }
  }

  handlers.tasks = async (req, res) => {
    const method = requireMethod(req, ['GET', 'POST'])
    if (method === 'GET') {
      const url = new URL(req.url, 'http://127.0.0.1')
      const result = await listTasks({
        limit: Number(url.searchParams.get('limit')) || 50,
        offset: Number(url.searchParams.get('offset')) || 0,
      })
      json(res, 200, { ok: true, ...result })
      return
    }
    const body = await readBody(req, IMAGE_LIMIT)
    const form = body.form && typeof body.form === 'object' ? body.form : {}
    if (!form.reference_type) throw new AppError('bad-request', '缺少参考图类型')
    const images = body.images && typeof body.images === 'object' ? body.images : {}
    if (!images.reference) throw new AppError('bad-request', '缺少参考图')
    const creative = form.creative_mode === true
    if (!images.product && !creative) {
      throw new AppError('product-required', '保真复刻必须有商品图；如需无商品图请先打开创意模式')
    }
    const normalizedForm = {
      reference_type: String(form.reference_type),
      mode: form.mode === 'high_fidelity' ? 'high_fidelity' : 'style_reference',
      fidelity: Math.max(0, Math.min(1, Number(form.fidelity) || 0.8)),
      creative_mode: creative,
      product_view: ['front', 'side', 'back', 'top', 'angle_45', 'unknown'].indexOf(form.product_view) >= 0 ? form.product_view : 'front',
      product_kind: form.product_kind === 'non_apparel' ? 'non_apparel' : 'apparel',
      user_requirement: String(form.user_requirement || '').slice(0, 800),
      lang: form.lang === 'en' ? 'en' : 'zh',
      aspect: ['1:1', '4:5', '3:4', '16:9'].indexOf(form.aspect) >= 0 ? form.aspect : '1:1',
      output_size: Math.max(512, Math.min(2048, Number(form.output_size) || 1024)),
      background_count: form.background_count === 2 ? 2 : 1,
    }
    const task = await createTask({
      form: normalizedForm,
      budget: { max_vision_calls: 1, max_image_calls: normalizedForm.background_count },
    })
    const reference = parseDataUrl(images.reference.data_url, { kind: '参考图' })
    const referenceAsset = await saveAsset(task.id, reference.buffer, { kind: 'reference' })
    let productAsset = null
    if (images.product) {
      const product = parseDataUrl(images.product.data_url, { kind: '商品图' })
      productAsset = await saveAsset(task.id, product.buffer, { kind: 'product' })
    }
    await updateTask(task.id, draft => {
      draft.submitted.assets = {
        reference: { ...referenceAsset, name: String(images.reference.name || 'reference') },
        product: productAsset ? { ...productAsset, name: String(images.product.name || 'product') } : null,
      }
      draft.state = 'scene_review'
      return draft
    })
    json(res, 200, await snapshot(task.id))
  }

  handlers.taskById = async (req, res, id) => {
    const method = requireMethod(req, ['GET', 'DELETE'])
    const url = new URL(req.url, 'http://127.0.0.1')
    if (method === 'DELETE') {
      if (url.searchParams.get('confirm') !== '1') throw new AppError('bad-request', '删除任务需要显式确认')
      await deleteTask(id)
      json(res, 200, { ok: true, deleted: id })
      return
    }
    json(res, 200, await snapshot(id))
  }

  handlers.action = async (req, res, id, action) => {
    const task = await loadTask(id)
    if (action === 'analyze') {
      requireMethod(req, ['POST'])
      await analyzeScene(task)
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'scene-review') {
      requireMethod(req, ['PUT', 'POST'])
      const body = await readBody(req)
      const analysis = await readJsonFile(id, task.scene.analysis_asset || '')
      if (!analysis || !analysis.scene) throw new AppError('scene-missing', '还没有场景分析结果')
      const merged = mergeSceneReview(analysis.scene, body)
      const missing = unconfirmedAfterReview(merged.scene, body.confirmed || {})
      if (missing.length > 0) {
        throw new AppError('scene-unconfirmed', `还有 ${missing.length} 项无法确认，请逐项确认后再继续`, { detail: { missing } })
      }
      const valid = validateScene(merged.scene)
      if (!valid.ok) throw new AppError('scene-schema-invalid', '审核后的场景数据不符合契约', { detail: { errors: valid.errors } })
      const review = {
        scene: merged.scene,
        confirmed: body.confirmed || {},
        updated_at: new Date().toISOString(),
      }
      await fs.writeFile(path.join(taskDir(id), 'scene_review.json'), JSON.stringify(review, null, 2), 'utf8')
      await updateTask(id, draft => {
        draft.scene.review_asset = 'scene_review.json'
        draft.scene.confirmed = true
        if (draft.state === 'scene_review' || draft.state === 'created') draft.state = 'mask_review'
        return draft
      })
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'cutout') {
      requireMethod(req, ['POST'])
      if (task.state !== 'mask_review' && task.state !== 'mask_rejected') {
        throw new AppError('invalid-state', '当前阶段不能提交抠图结果')
      }
      const body = await readBody(req, IMAGE_LIMIT)
      const product = parseDataUrl(body.product_png, { kind: '抠图结果' })
      const mask = parseDataUrl(body.mask_png, { kind: '蒙版' })
      const productImage = decodePng(product.buffer)
      const maskImage = decodePng(mask.buffer)
      if (productImage.width !== maskImage.width || productImage.height !== maskImage.height) {
        throw new AppError('mask-invalid', '抠图结果与蒙版尺寸不一致')
      }
      if (productImage.width > MAX_IMAGE_SIDE || productImage.height > MAX_IMAGE_SIDE) {
        throw new AppError('asset-too-large', '抠图结果尺寸过大')
      }
      const productAsset = await saveAsset(id, product.buffer, { kind: 'rgba' })
      const maskAsset = await saveAsset(id, mask.buffer, { kind: 'mask' })
      await updateTask(id, draft => {
        draft.cutout = {
          mode: body.mode === 'transparent' ? 'transparent' : 'auto',
          product_asset: productAsset,
          mask_asset: maskAsset,
          reviewed: false,
          width: productImage.width,
          height: productImage.height,
        }
        draft.state = 'mask_review'
        return draft
      })
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'mask') {
      requireMethod(req, ['PUT', 'POST'])
      const body = await readBody(req, IMAGE_LIMIT)
      if (body.product_png) {
        const product = parseDataUrl(body.product_png, { kind: '抠图结果' })
        const mask = parseDataUrl(body.mask_png, { kind: '蒙版' })
        const productAsset = await saveAsset(id, product.buffer, { kind: 'rgba' })
        const maskAsset = await saveAsset(id, mask.buffer, { kind: 'mask' })
        await updateTask(id, draft => {
          draft.cutout.product_asset = productAsset
          draft.cutout.mask_asset = maskAsset
          draft.cutout.reviewed = false
          return draft
        })
      }
      if (body.confirm !== true) {
        throw new AppError('mask-unconfirmed', '请先确认蒙版（人工审核是强制门禁）')
      }
      const current = await loadTask(id)
      if (!current.cutout.product_asset || !current.cutout.mask_asset) {
        throw new AppError('mask-invalid', '还没有可用的抠图结果')
      }
      const effective = await effectiveScene(current)
      const compat = checkCompatibility({
        scene: effective.scene || normalizeScene({}),
        productView: current.submitted.form.product_view,
        form: current.submitted.form,
        cutout: current.cutout,
      })
      await updateTask(id, draft => {
        draft.cutout.reviewed = true
        draft.compatibility = { checked: true, level: compat.level, issues: compat.issues, confirmed: compat.level === 'ok' }
        if (draft.state === 'mask_review' || draft.state === 'mask_rejected') draft.state = 'background_review'
        return draft
      })
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'compatibility') {
      requireMethod(req, ['POST'])
      const body = await readBody(req)
      const effective = await effectiveScene(task)
      const compat = checkCompatibility({
        scene: effective.scene || normalizeScene({}),
        productView: task.submitted.form.product_view,
        form: task.submitted.form,
        cutout: task.cutout,
      })
      const confirmed = body.confirm_continue === true
      await updateTask(id, draft => {
        draft.compatibility = { checked: true, level: compat.level, issues: compat.issues, confirmed }
        return draft
      })
      if (compat.level !== 'ok' && !confirmed) {
        throw new AppError('view-mismatch', '视角检查有警告：请确认后再继续', { detail: { issues: compat.issues } })
      }
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'background') {
      requireMethod(req, ['POST'])
      await background(task, req, res)
      return
    }
    if (action === 'composition') {
      requireMethod(req, ['PUT', 'POST'])
      const body = await readBody(req)
      const composition = schema.normalizeComposition(body.composition)
      const valid = schema.validateComposition(composition)
      if (!valid.ok) throw new AppError('composition-invalid', '画布参数不符合契约', { detail: { errors: valid.errors } })
      if (!composition.background.asset_id) throw new AppError('background-missing', '还没有选定背景')
      if (task.state !== 'editing' && task.state !== 'exporting' && task.state !== 'done') {
        throw new AppError('invalid-state', '当前阶段还不能编辑画布')
      }
      await fs.writeFile(path.join(taskDir(id), 'composition.json'), JSON.stringify(composition, null, 2), 'utf8')
      await updateTask(id, draft => {
        draft.composition = { saved: true, updated_at: new Date().toISOString() }
        return draft
      })
      json(res, 200, { ok: true, composition })
      return
    }
    if (action === 'export') {
      requireMethod(req, ['POST'])
      await exportComposite(task, req, res)
      return
    }
    if (action === 'accept') {
      requireMethod(req, ['POST'])
      const body = await readBody(req)
      const rating = Math.round(Number(body.rating) || 0)
      if (rating < 1 || rating > 5) throw new AppError('bad-request', '验收评分必须是 1-5')
      if (!task.exports.length) throw new AppError('invalid-state', '还没有导出结果，不能验收')
      await updateTask(id, draft => {
        draft.accept = { rating, notes: String(body.notes || '').slice(0, 600), accepted_at: new Date().toISOString() }
        draft.state = 'done'
        return draft
      })
      json(res, 200, await snapshot(id))
      return
    }
    if (action === 'cancel') {
      requireMethod(req, ['POST'])
      const current = await loadTask(id)
      if (current.state === 'done') throw new AppError('invalid-state', '任务已完成，不能取消')
      await setState(id, 'cancelled')
      json(res, 200, await snapshot(id))
      return
    }
    throw new AppError('bad-request', `未知操作：${action}`)
  }

  handlers.file = async (req, res) => {
    requireMethod(req, ['GET'])
    const url = new URL(req.url, 'http://127.0.0.1')
    const taskId = String(url.searchParams.get('task') || '')
    const file = String(url.searchParams.get('file') || '')
    const candidates = [
      containedPath(path.join(taskDir(taskId), 'assets'), file),
      containedPath(path.join(taskDir(taskId), 'exports'), file),
    ].filter(Boolean)
    if (candidates.length === 0) throw new AppError('bad-request', '文件路径不合法')
    let target = null
    let buffer = null
    for (const candidate of candidates) {
      try {
        buffer = await fs.readFile(candidate)
        target = candidate
        break
      } catch {
        // try the next directory
      }
    }
    if (!target || !buffer) throw new AppError('asset-invalid', '文件不存在')
    const mime = target.endsWith('.png') ? 'image/png'
      : target.endsWith('.jpg') || target.endsWith('.jpeg') ? 'image/jpeg'
        : target.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store', 'content-length': buffer.length })
    res.end(buffer)
  }

  handlers.reveal = async (req, res) => {
    requireMethod(req, ['POST'])
    const body = await readBody(req)
    const id = String(body.task_id || '')
    const dir = id ? path.join(taskDir(id), 'exports') : path.join(rootDir(), 'tasks')
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const ok = await new Promise(resolve => {
      try {
        const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' })
        child.on('error', () => resolve(false))
        child.unref()
        resolve(true)
      } catch {
        resolve(false)
      }
    })
    if (!ok) throw new AppError('internal-error', '无法打开目录')
    json(res, 200, { ok: true, dir })
  }

  return handlers
}

// ------------------------------------------------------------------- steps

async function analyzeScene(task) {
  const id = task.id
  if (task.state === 'analyzing') throw new AppError('invalid-state', '分析已经开始')
  if (task.scene.analysis_asset && task.state !== 'mask_review' && task.state !== 'background_review') {
    // Re-analysis is allowed only before the mask gate.
  }
  const { settings } = await settingsOrDefaults()
  const secrets = await readSecrets()
  const { key } = resolveChannelKey('vision', secrets)
  if (!key) throw new AppError('provider-missing', '视觉通道尚未配置 API Key，请先在设置里填写视觉通道')

  const reference = await readAssetBuffer(id, task.submitted.assets.reference.asset_id)
  const mime = task.submitted.assets.reference.media_type || 'image/png'
  const dataUrl = `data:${mime};base64,${reference.toString('base64')}`
  const prompt = compileScenePrompt({ lang: task.submitted.form.lang, form: task.submitted.form })
  const startedAt = new Date().toISOString()
  const started = Date.now()
  await setState(id, 'analyzing')
  await reserveCall(id, 'vision')
  const fp = fingerprint({
    kind: 'scene',
    reference: task.submitted.assets.reference.sha256,
    model: settings.vision.model,
    prompt: `${prompt.system}\n${prompt.user}`,
    version: prompt.version,
    form: task.submitted.form,
  })
  await recordCall(id, { kind: 'vision', model: settings.vision.model, started_at: startedAt, status: 'pending', fingerprint: fp })
  try {
    const result = await callVision({
      channel: settings.vision,
      apiKey: key,
      prompt: `${prompt.system}\n\n${prompt.user}`,
      images: [dataUrl],
    })
    let parsed
    try {
      parsed = sceneFromText(result.text)
    } catch (error) {
      await fs.writeFile(path.join(taskDir(id), 'scene_raw.txt'), String(result.text || ''), 'utf8')
      throw error
    }
    const normalized = normalizeScene(parsed)
    const validation = validateScene(normalized)
    if (!validation.ok) {
      throw new AppError('scene-schema-invalid', '场景数据不符合契约，已阻止后续步骤', { detail: { errors: validation.errors } })
    }
    const record = {
      scene: normalized,
      raw_text: String(result.text || '').slice(0, 20000),
      model: settings.vision.model,
      prompt_version: prompt.version,
      created_at: new Date().toISOString(),
      confidence_note: 'confidence 仅为模型自述，不作为准确率',
    }
    await fs.writeFile(path.join(taskDir(id), 'scene_analysis.json'), JSON.stringify(record, null, 2), 'utf8')
    await updateTask(id, draft => {
      draft.scene.analysis_asset = 'scene_analysis.json'
      draft.scene.review_asset = null
      draft.scene.confirmed = false
      draft.state = 'scene_review'
      draft.calls[draft.calls.length - 1] = { ...draft.calls[draft.calls.length - 1], status: 'ok', finished_at: new Date().toISOString() }
      return draft
    })
    await logRelay(id, { kind: 'vision', model: settings.vision.model, status: 'ok', ms: Date.now() - started, fingerprint: fp })
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'provider-error'
    await refundCall(id, 'vision').catch(() => {})
    await updateTask(id, draft => {
      const last = draft.calls[draft.calls.length - 1]
      if (last) {
        last.status = code === 'provider-timeout-unknown' ? 'unknown' : 'error'
        last.error_code = code
        last.finished_at = new Date().toISOString()
      }
      draft.state = code === 'provider-timeout-unknown' ? 'remote_outcome_unknown' : 'scene_review'
      draft.error = { code, message: String(error.message || '') }
      return draft
    }).catch(() => {})
    await logRelay(id, { kind: 'vision', model: settings.vision.model, status: 'error', code, ms: Date.now() - started, fingerprint: fp })
    throw error
  }
}

async function background(task, req, res) {
  const id = task.id
  const body = await readBody(req, IMAGE_LIMIT)
  const mode = String(body.mode || '')
  if (task.state !== 'background_review' && task.state !== 'editing') {
    throw new AppError('invalid-state', '当前阶段不能处理背景')
  }
  if (mode === 'generate') {
    const effective = await effectiveScene(task)
    if (!effective.scene) throw new AppError('scene-missing', '还没有确认后的场景数据')
    const { settings } = await settingsOrDefaults()
    const secrets = await readSecrets()
    const { key } = resolveChannelKey('image', secrets)
    if (!key) throw new AppError('provider-missing', '生图通道尚未配置 API Key，请先在设置里填写生图通道')
    const prompt = compileBackgroundPrompt({ lang: task.submitted.form.lang, scene: effective.scene, form: task.submitted.form })
    const size = `${task.submitted.form.output_size}x${task.submitted.form.output_size}`
    const started = Date.now()
    const startedAt = new Date().toISOString()
    await reserveCall(id, 'image')
    const fp = fingerprint({
      kind: 'background', prompt: prompt.text, version: prompt.version,
      model: settings.image.model, protocol: settings.image.provider, size,
    })
    await recordCall(id, { kind: 'image', model: settings.image.model, started_at: startedAt, status: 'pending', fingerprint: fp })
    try {
      const result = await generateImage({ channel: settings.image, shared: settings, apiKey: key, prompt: prompt.text, size })
      const asset = await saveAsset(id, result.bytes, { kind: 'bg' })
      const version = {
        id: `bg${task.backgrounds.length + 1}`,
        source: 'generated',
        asset: asset.asset_id,
        file: asset.file,
        sha256: asset.sha256,
        created_at: new Date().toISOString(),
        prompt_version: prompt.version,
        prompt_hash: prompt.hash,
        prompt_text: prompt.text,
        model: settings.image.model,
        selected: false,
        normalized_file: null,
        bytes: result.bytes.length,
        source_kind: result.source,
      }
      await updateTask(id, draft => {
        draft.backgrounds.push(version)
        draft.state = 'background_review'
        const last = draft.calls[draft.calls.length - 1]
        if (last) {
          last.status = 'ok'
          last.finished_at = new Date().toISOString()
          last.bytes = result.bytes.length
        }
        return draft
      })
      await logRelay(id, { kind: 'image', model: settings.image.model, status: 'ok', ms: Date.now() - started, bytes: result.bytes.length, fingerprint: fp })
      json(res, 200, await snapshot(id))
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'provider-error'
      await refundCall(id, 'image').catch(() => {})
      await updateTask(id, draft => {
        const last = draft.calls[draft.calls.length - 1]
        if (last) {
          last.status = code === 'provider-timeout-unknown' ? 'unknown' : 'error'
          last.error_code = code
          last.finished_at = new Date().toISOString()
        }
        if (code === 'provider-timeout-unknown') draft.state = 'remote_outcome_unknown'
        draft.error = { code, message: String(error.message || '') }
        return draft
      }).catch(() => {})
      await logRelay(id, { kind: 'image', model: settings.image.model, status: 'error', code, ms: Date.now() - started, fingerprint: fp })
      throw error
    }
    return
  }

  if (mode === 'upload') {
    const image = parseDataUrl(body.data_url, { kind: '背景图' })
    let meta = { width: 0, height: 0 }
    try {
      const decoded = decodePng(image.buffer)
      meta = { width: decoded.width, height: decoded.height }
    } catch {
      // A non-PNG upload is accepted here; the client normalises it to PNG before
      // it can be selected, so the export path always sees PNG.
    }
    const asset = await saveAsset(id, image.buffer, { kind: 'bg' })
    const version = {
      id: `bg${task.backgrounds.length + 1}`,
      source: 'uploaded',
      asset: asset.asset_id,
      file: asset.file,
      sha256: asset.sha256,
      created_at: new Date().toISOString(),
      prompt_version: null,
      prompt_hash: null,
      prompt_text: null,
      model: null,
      selected: false,
      normalized_file: null,
      width: meta.width,
      height: meta.height,
      bytes: image.buffer.length,
      source_kind: 'upload',
    }
    await updateTask(id, draft => {
      draft.backgrounds.push(version)
      draft.state = 'background_review'
      return draft
    })
    json(res, 200, await snapshot(id))
    return
  }

  if (mode === 'select') {
    const versionId = String(body.version_id || '')
    const target = task.backgrounds.find(item => item.id === versionId)
    if (!target) throw new AppError('background-missing', '背景版本不存在')
    if (!body.normalized_png) throw new AppError('bad-request', '缺少标准化后的 PNG')
    const image = parseDataUrl(body.normalized_png, { kind: '背景图（标准化）' })
    const decoded = decodePng(image.buffer)
    if (decoded.width > MAX_IMAGE_SIDE || decoded.height > MAX_IMAGE_SIDE) throw new AppError('asset-too-large', '背景尺寸过大')
    const asset = await saveAsset(id, image.buffer, { kind: 'bgnorm' })
    const confirm = body.confirm === true
    await updateTask(id, draft => {
      draft.backgrounds = draft.backgrounds.map(item => ({
        ...item,
        selected: item.id === versionId,
        normalized_file: item.id === versionId ? asset.file : item.normalized_file,
        sha256_normalized: item.id === versionId ? asset.sha256 : item.sha256_normalized,
        checked: item.id === versionId ? { at: new Date().toISOString(), by: 'user' } : item.checked,
      }))
      if (confirm) draft.state = 'editing'
      return draft
    })
    json(res, 200, await snapshot(id))
    return
  }

  throw new AppError('bad-request', '背景操作只支持 generate / upload / select')
}

async function exportComposite(task, req, res) {
  const id = task.id
  const body = await readBody(req, IMAGE_LIMIT)
  const composition = schema.normalizeComposition(body.composition || (await readJsonFile(id, 'composition.json')) || {})
  const validation = schema.validateComposition(composition)
  if (!validation.ok) throw new AppError('composition-invalid', '画布参数不符合契约', { detail: { errors: validation.errors } })
  if (!task.cutout.reviewed || !task.cutout.product_asset) throw new AppError('mask-unconfirmed', '蒙版尚未人工确认，不能导出')
  if (!composition.background.asset_id) throw new AppError('background-missing', '还没有选定背景')
  const backgroundVersion = task.backgrounds.find(item => item.selected && item.normalized_file)
  if (!backgroundVersion) throw new AppError('background-missing', '背景还没有标准化，请重新选择一次背景')

  const bgFile = await fs.readFile(path.join(taskDir(id), 'assets', backgroundVersion.normalized_file))
  const productFile = await fs.readFile(path.join(taskDir(id), 'assets', task.cutout.product_asset.file))
  const maskFile = await fs.readFile(path.join(taskDir(id), 'assets', task.cutout.mask_asset.file))
  const background = decodePng(bgFile)
  const product = decodePng(productFile)
  const mask = decodePng(maskFile)

  const overlays = body.overlays && typeof body.overlays === 'object' ? body.overlays : {}
  const front = overlays.front ? decodePng(parseDataUrl(overlays.front, { kind: '文字图层' }).buffer) : null
  const behind = overlays.behind ? decodePng(parseDataUrl(overlays.behind, { kind: '文字图层' }).buffer) : null

  await setState(id, 'exporting')
  const width = composition.canvas.width
  const height = composition.canvas.height
  let composed
  try {
    composed = composeExport({
      composition: {
        ...composition,
        product: { ...composition.product, source_width: product.width, source_height: product.height },
      },
      background,
      product,
      mask,
      overlayBehind: behind,
      overlayFront: front,
      output: { width, height },
    })
  } catch (error) {
    await setState(id, 'editing').catch(() => {})
    throw new AppError('export-failed', `合成失败：${error.message}`)
  }
  if (composed.width !== width || composed.height !== height) {
    await setState(id, 'editing').catch(() => {})
    throw new AppError('export-failed', '导出尺寸与画布不一致')
  }
  const png = encodePng(composed)
  // Verify the artefact by decoding it again: a broken encoder must never be
  // reported as a successful export.
  const verify = decodePng(png)
  if (verify.width !== width || verify.height !== height) {
    await setState(id, 'editing').catch(() => {})
    throw new AppError('export-failed', '导出文件自检失败（尺寸不符）')
  }
  const saved = await saveExportFile(id, png)
  const entry = {
    id: newId('exp'),
    file: `exports/${saved.file}`,
    width,
    height,
    bytes: saved.bytes,
    sha256: saved.sha256,
    created_at: new Date().toISOString(),
    composition_sha256: sha256(JSON.stringify(composition)),
  }
  await fs.writeFile(path.join(taskDir(id), 'composition.json'), JSON.stringify(composition, null, 2), 'utf8')
  await updateTask(id, draft => {
    draft.composition = { saved: true, updated_at: new Date().toISOString() }
    draft.exports.push(entry)
    return draft
  })
  json(res, 200, { ok: true, export: entry, url: `${PREFIX}/file?task=${encodeURIComponent(id)}&file=${encodeURIComponent(saved.file)}`, ...(await snapshot(id)) })
}

export { snapshot }
