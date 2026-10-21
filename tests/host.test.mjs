import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const root = await mkdtemp(path.join(os.tmpdir(), 'replica-host-'))
process.env.DSH_PROFILE_DIR = root

const { createHandlers } = await import('../lib/api.js')
const { encodePng, decodePng } = await import('../lib/png.js')
const { getTask } = await import('../lib/tasks.js').catch(() => ({}))

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600))
  }
}

/* readBody attaches its listeners asynchronously (after earlier awaits), so the
   payload must only be pushed once someone is listening for it. */
class FakeReq extends EventEmitter {
  constructor(method, url, body) {
    super()
    this.method = method
    this.url = url
    this.headers = { host: '127.0.0.1:52434' }
    this.body = body === undefined ? null : Buffer.from(JSON.stringify(body))
    this.pumped = false
    if (this.body) this.headers['content-length'] = String(this.body.length)
  }
  destroy() {
    this.destroyed = true
  }
  on(event, listener) {
    super.on(event, listener)
    if (!this.pumped && (event === 'end' || event === 'data')) {
      this.pumped = true
      setImmediate(() => {
        if (this.destroyed) return
        if (this.body) this.emit('data', this.body)
        super.emit('end')
      })
    }
    return this
  }
  async *[Symbol.asyncIterator]() {
    if (this.body) yield this.body
  }
}

const pump = req => req

class FakeRes {
  constructor() {
    this.status = 0
    this.headers = {}
    this.chunks = []
    this.headersSent = false
  }
  writeHead(status, headers) {
    this.status = status
    this.headers = headers || {}
    this.headersSent = true
  }
  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk))
    this.done = true
  }
  json() {
    const text = Buffer.concat(this.chunks).toString('utf8')
    try {
      return JSON.parse(text)
    } catch {
      return { raw: text }
    }
  }
  buffer() {
    return Buffer.concat(this.chunks)
  }
}

const handlers = createHandlers()

const { toErrorPayload } = await import('../lib/errors.js')

async function call(handler, method, url, body, ...rest) {
  const res = new FakeRes()
  try {
    await handler(pump(new FakeReq(method, url, body)), res, ...rest)
  } catch (error) {
    // The real route wrapper turns a thrown AppError into a JSON response; the
    // test calls handlers directly, so it performs the same translation.
    const { status, payload } = toErrorPayload(error)
    return { status, body: payload, res }
  }
  return { status: res.status, body: res.json(), res }
}

const solid = (w, h, rgba) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]
    data[i + 1] = rgba[1]
    data[i + 2] = rgba[2]
    data[i + 3] = rgba[3]
  }
  return { width: w, height: h, data }
}

const pngDataUrl = (w, h, rgba) => `data:image/png;base64,${encodePng(solid(w, h, rgba)).toString('base64')}`

const scenePayload = {
  schema_version: '1.0',
  reference_type: 'ecommerce',
  camera: { angle: 'eye_level', expected_product_view: 'front', confidence: 0.9 },
  lighting: { direction: 'top_left', softness: 'soft', temperature: 'warm', confidence: 0.8 },
  support_surface: { type: 'tabletop', orientation: 'horizontal', contact_point_hint: 'bottom_center' },
  placement: { preferred_region: 'center', clearance: 'clear', needs_user_confirmation: true },
  scene_description: 'white studio table with warm light',
  color_palette: [{ name: 'warm white', hex: '#F3EEE6' }],
  style_tags: ['clean', 'studio'],
  reference_texts: [],
  risks: [],
}

const calls = []
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options })
  if (String(url).includes('/chat/completions')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(scenePayload) } }],
        usage: { total_tokens: 42 },
      })),
    }
  }
  if (String(url).includes('/images/generations')) {
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from(JSON.stringify({ data: [{ b64_json: encodePng(solid(64, 64, [240, 235, 225, 255])).toString('base64') }] })),
    }
  }
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from('{}'),
  }
}

// ---------------------------------------------------------------- settings
// 视觉与生图是两条独立通道：不同的中转站、不同的 key。
const saved = await call(handlers.settings, 'PUT', '/api/ai-replica/settings', {
  settings: {
    vision: {
      provider: 'openai_chat',
      base_url: 'https://relay-vision.test/v1',
      path: '/chat/completions',
      model: 'vision-x',
      auth: 'bearer',
    },
    image: {
      provider: 'openai_images',
      base_url: 'https://relay-image.test/v1',
      path: '/images/generations',
      model: 'image-x',
      auth: 'api-key',
    },
  },
  vision_api_key: 'sk-vision-123',
  image_api_key: 'sk-image-456',
})
check('settings saved', saved.status === 200 && saved.body.ok, saved.body)
check('keys hidden', JSON.stringify(saved.body).includes('sk-vision-123') === false && JSON.stringify(saved.body).includes('sk-image-456') === false, saved.body)
check('both channels keyed', saved.body.configured === true && saved.body.vision.has_key && saved.body.image.has_key, saved.body)
const read = await call(handlers.settings, 'GET', '/api/ai-replica/settings')
check('settings readable', read.body.has_key === true && read.body.settings.image.model === 'image-x', read.body.settings)
check('channels are independent', read.body.settings.vision.base_url === 'https://relay-vision.test/v1' && read.body.settings.image.base_url === 'https://relay-image.test/v1', read.body.settings)
check('enums exposed', Array.isArray(read.body.enums['camera.angle']), Object.keys(read.body.enums || {}))
check('relay enums exposed', read.body.relay.vision_providers.includes('anthropic') && read.body.relay.auth_styles.includes('api-key'), read.body.relay)

// 只有一条通道有 key 时，另一条必须单独报缺
const partial = await call(handlers.settings, 'PUT', '/api/ai-replica/settings', { settings: { vision: { model: 'vision-x' } }, image_api_key: '' })
check('missing image key reported', partial.body.configured === false && partial.body.vision.has_key === true && partial.body.image.has_key === false, partial.body)
await call(handlers.settings, 'PUT', '/api/ai-replica/settings', { settings: {}, image_api_key: 'sk-image-456' })

const testWithoutConfirm = await call(handlers.test, 'POST', '/api/ai-replica/settings/test', { kind: 'vision' })
check('test needs confirm', testWithoutConfirm.status === 400, testWithoutConfirm.body)

// -------------------------------------------------------------- create task
const created = await call(handlers.tasks, 'POST', '/api/ai-replica/tasks', {
  form: {
    reference_type: 'ecommerce', mode: 'high_fidelity', fidelity: 0.9, product_view: 'front',
    lang: 'zh', aspect: '1:1', output_size: 512, background_count: 1,
  },
  images: {
    reference: { data_url: pngDataUrl(48, 48, [200, 200, 200, 255]), name: 'ref.png' },
    product: { data_url: pngDataUrl(40, 80, [180, 60, 60, 255]), name: 'bottle.png' },
  },
})
check('task created', created.status === 200 && created.body.task && created.body.task.state === 'scene_review', created.body)
const taskId = created.body.task.id
check('assets stored', Boolean(created.body.task.submitted.assets.product.file), created.body.task.submitted)

const noProduct = await call(handlers.tasks, 'POST', '/api/ai-replica/tasks', {
  form: { reference_type: 'ecommerce' },
  images: { reference: { data_url: pngDataUrl(8, 8, [0, 0, 0, 255]) } },
})
check('product required', noProduct.status === 400 && noProduct.body.code === 'product-required', noProduct.body)

// -------------------------------------------------------------- scene gates
const early = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/export`, {}, taskId, 'export')
check('export blocked before mask', early.status === 409, early.body)

const analyzed = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/analyze`, {}, taskId, 'analyze')
check('analyze ok', analyzed.status === 200 && analyzed.body.task.state === 'scene_review', analyzed.body)
check('analysis stored', analyzed.body.scene.analysis && analyzed.body.scene.analysis.scene.camera.angle === 'eye_level', analyzed.body.scene)
check('one vision call', analyzed.body.task.budget.vision_calls === 1, analyzed.body.task.budget)
check('background prompt compiled', typeof analyzed.body.prompts.background.text === 'string' && analyzed.body.prompts.background.text.includes('禁止'), analyzed.body.prompts)

const badReview = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${taskId}/scene-review`, {
  scene: { camera: { angle: 'unknown' } },
  confirmed: {},
}, taskId, 'scene-review')
check('unknown not confirmed rejected', badReview.status === 409 && badReview.body.code === 'scene-unconfirmed', badReview.body)

const review = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${taskId}/scene-review`, {
  scene: { placement: { needs_user_confirmation: false } },
  confirmed: { 'placement.needs_user_confirmation': true },
}, taskId, 'scene-review')
check('review saved', review.status === 200 && review.body.task.state === 'mask_review', review.body)
check('review is separate file', review.body.scene.review && review.body.scene.analysis.scene.placement.needs_user_confirmation === true, review.body.scene)

// ------------------------------------------------------------- mask gates
const cutout = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/cutout`, {
  mode: 'auto',
  product_png: pngDataUrl(40, 80, [180, 60, 60, 255]),
  mask_png: pngDataUrl(40, 80, [255, 255, 255, 255]),
}, taskId, 'cutout')
check('cutout stored', cutout.status === 200 && cutout.body.task.cutout.reviewed === false, cutout.body.task && cutout.body.task.cutout)

const exportBeforeMask = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/export`, {}, taskId, 'export')
check('export still blocked', exportBeforeMask.status === 409 && exportBeforeMask.body.code === 'mask-unconfirmed', exportBeforeMask.body)

const maskConfirm = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${taskId}/mask`, { confirm: true }, taskId, 'mask')
check('mask confirmed', maskConfirm.status === 200 && maskConfirm.body.task.state === 'background_review', maskConfirm.body)
check('compatibility recorded', maskConfirm.body.task.compatibility.checked === true, maskConfirm.body.task.compatibility)

// --------------------------------------------------------------- background
const bg = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/background`, { mode: 'generate' }, taskId, 'background')
check('background generated', bg.status === 200 && bg.body.task.backgrounds.length === 1, bg.body.task && bg.body.task.backgrounds)
check('image call counted', bg.body.task.budget.image_calls === 1, bg.body.task.budget)

const budget = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/background`, { mode: 'generate' }, taskId, 'background')
check('budget enforced', budget.status === 409 && budget.body.code === 'budget-exhausted', budget.body)

const noConfirm = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/background`, {
  mode: 'select', version_id: bg.body.task.backgrounds[0].id,
  normalized_png: pngDataUrl(512, 512, [240, 235, 225, 255]),
}, taskId, 'background')
check('select without confirm stays', noConfirm.status === 200 && noConfirm.body.task.state === 'background_review', noConfirm.body.task && noConfirm.body.task.state)

const selected = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/background`, {
  mode: 'select', version_id: bg.body.task.backgrounds[0].id,
  normalized_png: pngDataUrl(512, 512, [240, 235, 225, 255]),
  confirm: true,
}, taskId, 'background')
check('select confirmed → editing', selected.status === 200 && selected.body.task.state === 'editing', selected.body.task && selected.body.task.state)

// --------------------------------------------------------------- composition
const composition = {
  schema_version: '1.0',
  canvas: { width: 512, height: 512, preset: '1:1' },
  background: { asset_id: selected.body.task.backgrounds[0].asset, sha256: '' },
  product: {
    asset_id: selected.body.task.cutout.product_asset.asset_id, mask_id: selected.body.task.cutout.mask_asset.asset_id,
    sha256: '', cx: 0.5, cy: 0.6, width_ratio: 0.4, rotation_deg: 0, opacity: 1, visible: true,
  },
  shadow: { enabled: true, offset_x: 0, offset_y: 1.5, blur: 4, opacity: 0.35, color: '#000000', contact: true },
  adjustments: { enabled: false, brightness: 0, warmth: 0 },
  text_layers: [],
  meta: { created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z', params_version: '1.0' },
}
const compositionSaved = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${taskId}/composition`, { composition }, taskId, 'composition')
check('composition saved', compositionSaved.status === 200, compositionSaved.body)

const exported = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/export`, {
  composition,
  overlays: { front: pngDataUrl(512, 512, [0, 0, 0, 0]) },
}, taskId, 'export')
check('export ok', exported.status === 200 && exported.body.export.width === 512, exported.body)
check('export listed', exported.body.task.exports.length === 1, exported.body.task.exports)

if (exported.status === 200) {
  const file = await call(handlers.file, 'GET', `/api/ai-replica/file?task=${taskId}&file=${encodeURIComponent(exported.body.export.file.split('/').pop())}`)
  const png = decodePng(file.res.buffer())
  check('export decodes', png.width === 512 && png.height === 512, { w: png.width, h: png.height })
}

const accepted = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${taskId}/accept`, { rating: 4, notes: 'ok' }, taskId, 'accept')
check('accepted → done', accepted.status === 200 && accepted.body.task.state === 'done', accepted.body.task && accepted.body.task.state)

const history = await call(handlers.tasks, 'GET', '/api/ai-replica/tasks?limit=10')
check('history lists task', history.body.items.some(item => item.id === taskId), history.body.items)

// ---------------------------------------------------------- timeout & safety
globalThis.fetch = async () => {
  const error = new Error('aborted')
  error.name = 'AbortError'
  throw error
}
const second = await call(handlers.tasks, 'POST', '/api/ai-replica/tasks', {
  form: { reference_type: 'ecommerce', product_view: 'front' },
  images: {
    reference: { data_url: pngDataUrl(16, 16, [1, 2, 3, 255]) },
    product: { data_url: pngDataUrl(16, 16, [9, 9, 9, 255]) },
  },
})
const timeout = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${second.body.task.id}/analyze`, {}, second.body.task.id, 'analyze')
check('timeout mapped', timeout.status === 504 && timeout.body.code === 'provider-timeout-unknown', timeout.body)
const afterTimeout = await call(handlers.taskById, 'GET', `/api/ai-replica/tasks/${second.body.task.id}`, {}, second.body.task.id)
check('timeout state', afterTimeout.body.task.state === 'remote_outcome_unknown', afterTimeout.body.task.state)
check('timeout refunded budget', afterTimeout.body.task.budget.vision_calls === 0, afterTimeout.body.task.budget)

const traversal = await call(handlers.file, 'GET', `/api/ai-replica/file?task=${taskId}&file=../../secrets.json`)
check('traversal rejected', traversal.status === 400, traversal.body)

const badKey = await call(handlers.settings, 'PUT', '/api/ai-replica/settings', { settings: { base_url: 'not-a-url' } })
check('bad base url rejected', badKey.status === 400, badKey.body)

globalThis.fetch = async () => ({
  ok: false,
  status: 401,
  headers: { get: () => null },
  arrayBuffer: async () => Buffer.from('{"error":"invalid api key"}'),
})
await call(handlers.settings, 'PUT', '/api/ai-replica/settings', { settings: { base_url: 'https://relay.test/v1' }, api_key: 'sk-bad' })
const third = await call(handlers.tasks, 'POST', '/api/ai-replica/tasks', {
  form: { reference_type: 'ecommerce' },
  images: {
    reference: { data_url: pngDataUrl(16, 16, [1, 2, 3, 255]) },
    product: { data_url: pngDataUrl(16, 16, [9, 9, 9, 255]) },
  },
})
const authFail = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${third.body.task.id}/analyze`, {}, third.body.task.id, 'analyze')
check('401 mapped', authFail.status === 502 && authFail.body.code === 'provider-auth', authFail.body)

await rm(root, { recursive: true, force: true })
console.log(`PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
