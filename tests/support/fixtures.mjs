/**
 * Real Host snapshots for the headless Client render test.
 *
 * The pipeline is driven through the same handlers the routes use, with the
 * relay stubbed (no network, no cost): vision returns a fixed Scene JSON and
 * the image endpoint returns a solid PNG. Everything else — storage, schema
 * validation, masks, background normalisation, composition, PNG export — runs
 * for real, so the Client is rendered against exactly what the Host produces.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

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
    try {
      return JSON.parse(Buffer.concat(this.chunks).toString('utf8'))
    } catch {
      return { raw: Buffer.concat(this.chunks).toString('utf8') }
    }
  }
}

const sceneJson = {
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

export async function buildSnapshots() {
  const root = await mkdtemp(path.join(tmpdir(), 'replica-render-'))
  process.env.DSH_PROFILE_DIR = root

  const { createHandlers } = await import('../../lib/api.js')
  const { encodePng } = await import('../../lib/png.js')
  const { toErrorPayload } = await import('../../lib/errors.js')

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
  const dataUrl = (w, h, rgba) => `data:image/png;base64,${encodePng(solid(w, h, rgba)).toString('base64')}`

  globalThis.fetch = async url => {
    const target = String(url)
    if (target.includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sceneJson) } }] })),
      }
    }
    if (target.includes('/images/generations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(JSON.stringify({ data: [{ b64_json: encodePng(solid(512, 512, [236, 231, 222, 255])).toString('base64') }] })),
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => Buffer.from('{}') }
  }

  const handlers = createHandlers()
  const call = async (handler, method, url, body, ...rest) => {
    const res = new FakeRes()
    try {
      await handler(new FakeReq(method, url, body), res, ...rest)
    } catch (error) {
      const { status, payload } = toErrorPayload(error)
      return { status, body: payload }
    }
    return { status: res.status, body: res.json() }
  }

  const settings = await call(handlers.settings, 'PUT', '/api/ai-replica/settings', {
    settings: {
      vision: { provider: 'openai_chat', base_url: 'https://relay.test/v1', path: '/chat/completions', model: 'vision-x', auth: 'bearer' },
      image: { provider: 'openai_images', base_url: 'https://relay.test/v1', path: '/images/generations', model: 'image-x', auth: 'bearer' },
    },
    vision_api_key: 'sk-vision-123',
    image_api_key: 'sk-image-123',
  })

  const created = await call(handlers.tasks, 'POST', '/api/ai-replica/tasks', {
    form: {
      reference_type: 'ecommerce',
      mode: 'high_fidelity',
      fidelity: 0.9,
      product_view: 'front',
      product_kind: 'apparel',
      user_requirement: '清透一点',
      lang: 'zh',
      aspect: '1:1',
      output_size: 512,
      background_count: 1,
    },
    images: {
      reference: { data_url: dataUrl(64, 64, [210, 205, 198, 255]), name: 'reference.png' },
      product: { data_url: dataUrl(40, 80, [180, 60, 60, 255]), name: 'bottle.png' },
    },
  })
  if (created.status !== 200) throw new Error(`fixture create failed: ${JSON.stringify(created.body)}`)
  const id = created.body.task.id

  const analyzed = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/analyze`, {}, id, 'analyze')
  if (analyzed.status !== 200) throw new Error(`fixture analyze failed: ${JSON.stringify(analyzed.body)}`)

  const reviewed = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${id}/scene-review`, {
    scene: analyzed.body.scene.effective,
    confirmed: { 'placement.needs_user_confirmation': true },
  }, id, 'scene-review')
  if (reviewed.status !== 200) throw new Error(`fixture review failed: ${JSON.stringify(reviewed.body)}`)

  await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/cutout`, {
    mode: 'auto',
    product_png: dataUrl(40, 80, [180, 60, 60, 255]),
    mask_png: dataUrl(40, 80, [255, 255, 255, 255]),
  }, id, 'cutout')

  const masked = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${id}/mask`, { confirm: true }, id, 'mask')
  if (masked.status !== 200) throw new Error(`fixture mask failed: ${JSON.stringify(masked.body)}`)

  const generated = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/background`, { mode: 'generate' }, id, 'background')
  if (generated.status !== 200) throw new Error(`fixture background failed: ${JSON.stringify(generated.body)}`)

  const selected = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/background`, {
    mode: 'select',
    version_id: generated.body.task.backgrounds[0].id,
    normalized_png: dataUrl(512, 512, [236, 231, 222, 255]),
    confirm: true,
  }, id, 'background')
  if (selected.status !== 200) throw new Error(`fixture select failed: ${JSON.stringify(selected.body)}`)

  const chosen = selected.body.task.backgrounds.find(item => item.selected) || selected.body.task.backgrounds[0]
  const composition = Object.assign({}, selected.body.composition_default, {
    background: { asset_id: chosen.asset, sha256: '' },
    product: Object.assign({}, selected.body.composition_default.product, {
      asset_id: selected.body.task.cutout.product_asset.asset_id,
      mask_id: selected.body.task.cutout.mask_asset.asset_id,
      cx: 0.5,
      cy: 0.62,
      width_ratio: 0.42,
      rotation_deg: 0,
    }),
    text_layers: [{
      id: 't1', text: '限时新品', font_size: 0.06, color: '#111111', align: 'center',
      x: 0.5, y: 0.12, max_width: 0.8, weight: 700, line_height: 1.2, visible: true,
    }],
  })
  const saved = await call(handlers.action, 'PUT', `/api/ai-replica/tasks/${id}/composition`, {
    composition,
  }, id, 'composition')
  if (saved.status !== 200) throw new Error(`fixture composition failed: ${JSON.stringify(saved.body)}`)

  // The composition PUT answers with `{ ok, composition }`; the workbench renders
  // a full snapshot, so read the task back the way the Client does.
  const editing = await call(handlers.taskById, 'GET', `/api/ai-replica/task?id=${id}`, undefined, id)
  if (editing.status !== 200) throw new Error(`fixture reload failed: ${JSON.stringify(editing.body)}`)

  const exported = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/export`, {
    composition: saved.body.composition,
    overlays: {},
  }, id, 'export')
  if (exported.status !== 200) throw new Error(`fixture export failed: ${JSON.stringify(exported.body)}`)

  const accepted = await call(handlers.action, 'POST', `/api/ai-replica/tasks/${id}/accept`, { rating: 5, notes: '好' }, id, 'accept')
  if (accepted.status !== 200) throw new Error(`fixture accept failed: ${JSON.stringify(accepted.body)}`)

  const history = await call(handlers.tasks, 'GET', '/api/ai-replica/tasks?limit=10')
  const settingsNow = await call(handlers.settings, 'GET', '/api/ai-replica/settings')

  return {
    root,
    id,
    created: created.body,
    analyzed: analyzed.body,
    reviewed: reviewed.body,
    masked: masked.body,
    background: generated.body,
    editing: editing.body,
    exported: exported.body,
    done: accepted.body,
    history: history.body,
    settings: settingsNow.body,
  }
}
