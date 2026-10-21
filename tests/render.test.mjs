/**
 * Headless render suite for the Client half.
 *
 * There is no browser here, so this file supplies a tiny React stand-in (hooks +
 * createElement produce plain objects) plus the DOM globals the fragments touch,
 * evaluates the shipped `client.js`, and calls every stage component once with a
 * snapshot produced by the real Host pipeline. A throw, a hook-order change or a
 * missing prop therefore fails the suite instead of silently breaking the page.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSnapshots } from './support/fixtures.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600))
  }
}

// ------------------------------------------------------------------ React shim
/* Every rendered component instance owns one slot list; the renderer keys it by
   component name + tree path so state survives the re-render rounds. */
const hookStack = []
const slotStore = new Map()

const current = () => hookStack[hookStack.length - 1]

function currentHook(init) {
  const state = current()
  const index = state.index
  state.index += 1
  if (state.list[index] === undefined) state.list[index] = typeof init === 'function' ? init() : init
  return { index, slot: state.list[index] }
}

const React = {
  Fragment: Symbol('Fragment'),
  Component: class Component {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }
    setState() {}
    forceUpdate() {}
  },
  PureComponent: class PureComponent {
    constructor(props) {
      this.props = props || {}
      this.state = {}
    }
    setState() {}
    forceUpdate() {}
  },
  createElement(type, props, ...children) {
    const flat = []
    const push = value => {
      if (Array.isArray(value)) value.forEach(push)
      else if (value !== null && value !== undefined && value !== false && value !== true) flat.push(value)
    }
    children.forEach(push)
    const merged = Object.assign({}, props || {})
    if (flat.length > 0) merged.children = flat.length === 1 ? flat[0] : flat
    return { type, props: merged, children: flat }
  },
  useState(initial) {
    const { index, slot } = currentHook(initial)
    const state = current()
    const set = next => {
      state.list[index] = typeof next === 'function' ? next(state.list[index]) : next
    }
    return [slot, set]
  },
  useReducer(reducer, initial) {
    const { index, slot } = currentHook(initial)
    const state = current()
    const dispatch = action => {
      state.list[index] = reducer(state.list[index], action)
    }
    return [slot, dispatch]
  },
  useRef(initial) {
    const { slot } = currentHook({ current: initial })
    return slot
  },
  useMemo(factory) {
    const { slot } = currentHook(() => factory())
    return slot
  },
  useCallback(fn) {
    const state = current()
    const index = state.index
    state.index += 1
    if (state.list[index] === undefined) state.list[index] = fn
    return state.list[index]
  },
  useEffect(effect) {
    current().effects.push({ effect, kind: 'effect' })
  },
  useLayoutEffect(effect) {
    current().effects.push({ effect, kind: 'layout' })
  },
  useContext(context) {
    return context.__value === undefined ? {} : context.__value
  },
  createContext(value) {
    return { __value: value, Provider: Symbol('Provider'), Consumer: Symbol('Consumer') }
  },
  memo: component => component,
  forwardRef: component => component,
  createRef: () => ({ current: null }),
  isValidElement: value => Boolean(value && typeof value === 'object' && 'type' in value),
  cloneElement: (element, props) => ({ type: element.type, props: Object.assign({}, element.props, props), children: element.children }),
  Children: { map: (children, fn) => (Array.isArray(children) ? children.map(fn) : []), toArray: children => (Array.isArray(children) ? children : []) },
  useId: () => 'id-1',
  version: '18.0.0-shim',
}

// Mark the shim classes as class components so the renderer uses `new` + render().
React.Component.prototype.isReactComponent = true
React.PureComponent.prototype.isReactComponent = true

// ------------------------------------------------------------------ DOM stubs
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const makeElement = tagName => {
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    width: 0,
    height: 0,
    className: '',
    value: '',
    setAttribute() {},
    removeAttribute() {},
    appendChild(child) {
      element.children.push(child)
      return child
    },
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    getContext: () => ({
      clearRect() {},
      fillRect() {},
      drawImage() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      ellipse() {},
      quadraticCurveTo() {},
      roundRect() {},
      clip() {},
      fillText() {},
      measureText: text => ({ width: String(text).length * 8 }),
      putImageData() {},
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      setTransform() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      filter: 'none',
      shadowColor: '',
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'top',
    }),
    toDataURL: () => 'data:image/png;base64,AAAA',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 }),
    focus() {},
    blur() {},
    click() {},
    remove() {},
  }
  return element
}

class StubImage {
  constructor() {
    this.naturalWidth = 320
    this.naturalHeight = 240
    this.width = 320
    this.height = 240
    this.complete = true
  }
  set src(value) {
    this._src = value
    if (typeof this.onload === 'function') setTimeout(() => this.onload(), 0)
  }
  get src() {
    return this._src
  }
  addEventListener() {}
  removeEventListener() {}
  decode() {
    return Promise.resolve()
  }
}

const storage = new Map()
const fetchLog = []
let canned = {}

const patchBody = { exclusive_timeout_ms: 60000, status: 'idle', wait: async () => ({ status: 'idle' }), unwatch() {}, dispose() {} }

globalThis.window = globalThis
globalThis.window.__AI_REPLICA_TEST__ = {}
globalThis.window.setInterval = () => 1
globalThis.window.clearInterval = () => {}
globalThis.window.setTimeout = (fn, ms) => ({
  ms,
  // Timers are never fired: the render suite only checks the render output.
})
globalThis.window.clearTimeout = () => {}
globalThis.window.requestAnimationFrame = () => 1
globalThis.window.cancelAnimationFrame = () => {}
globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
globalThis.window.ResizeObserver = StubObserver
globalThis.window.devicePixelRatio = 2
globalThis.window.innerWidth = 1280
globalThis.window.innerHeight = 800
globalThis.window.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.window.confirm = () => true
globalThis.window.alert = () => {}
globalThis.window.open = () => null
globalThis.document = {
  createElement: makeElement,
  createElementNS: (ns, tag) => makeElement(tag),
  body: makeElement('body'),
  documentElement: makeElement('html'),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
}
globalThis.document.body.appendChild = child => child
globalThis.Image = StubImage
const navigatorStub = { clipboard: { writeText: async () => {} }, language: 'zh-CN', userAgent: 'node' }
Object.defineProperty(globalThis, 'navigator', { value: navigatorStub, configurable: true, writable: true })
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
globalThis.fetch = async (url, options) => {
  const target = String(url).split('?')[0]
  const entry = { url: String(url), method: (options && options.method) || 'GET' }
  if (options && typeof options.body === 'string') {
    try {
      entry.body = JSON.parse(options.body)
    } catch {
      entry.body = options.body
    }
  }
  fetchLog.push(entry)
  const key = Object.keys(canned).find(suffix => target.endsWith(suffix))
  const payload = key ? canned[key] : { ok: true }
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}
globalThis.FileReader = class {
  readAsDataURL(blob) {
    this.result = 'data:image/png;base64,AAAA'
    if (this.onload) this.onload({ target: this })
  }
}

// ------------------------------------------------------------------- the bundle
let factory = null
globalThis.window.__ModuleLoader__ = {
  load({ id, factory: created }) {
    factory = created
  },
}

const source = await readFile(path.join(root, 'client.js'), 'utf8')
const loaderCalls = []
new Function('window', 'document', 'navigator', 'Image', 'fetch', 'FileReader', source)(
  globalThis.window,
  globalThis.document,
  globalThis.navigator,
  globalThis.Image,
  globalThis.fetch,
  globalThis.FileReader,
)
check('bundle called the module loader', typeof factory === 'function')

const moduleApi = factory(name => {
  loaderCalls.push(name)
  if (name === 'react' || name === 'react-dom') return React
  throw new Error(`unexpected module request: ${name}`)
})
check('bundle exports inject + apply', Array.isArray(moduleApi.inject) && typeof moduleApi.apply === 'function', moduleApi.inject)
check('bundle requested only react', loaderCalls.every(name => name === 'react' || name === 'react-dom'), loaderCalls)

// ------------------------------------------------------------------ fake ctx
const registered = []
const fakeCtx = {
  slots: {
    inject(name, callback) {
      if (typeof callback === 'function') callback()
    },
    register(target, render) {
      registered.push({ target, render })
      return () => {}
    },
  },
  locale: {
    getLocale: () => ({ id: 'zh-CN' }),
    subscribe: () => () => {},
    t: (key, fallback) => fallback || key,
  },
  theme: { subscribe: () => () => {}, getTheme: () => ({ mode: 'light' }) },
  layout: { subscribe: () => () => {} },
  uiWorkspace: { subscribe: () => () => {} },
  effect: fn => {
    const disposer = fn()
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  get: () => patchBody,
  logger: { info() {}, warn() {}, error() {}, debug() {} },
}

moduleApi.apply(fakeCtx)
check('registers the main panel', registered.some(item => item.target && item.target.name === 'main' && item.target.key === 'ai-replica'), registered.map(item => item.target))
check('registers the sidebar entry', registered.some(item => item.target && item.target.name === 'sidebar.panellist' && item.target.id === 'ai-replica'), registered.map(item => item.target))

const internals = globalThis.window.__AI_REPLICA_TEST__.internals
check('test seam exposed the stages', Boolean(internals && internals.SceneStage && internals.Workbench && internals.AcceptStage))

// -------------------------------------------------------------- the renderer
/* A miniature renderer: it walks the element tree, invokes function components
   (each with its own hook slots) and class components, collects their effects,
   then flushes promises and re-renders for a few rounds. That is enough to make
   an async load effect resolve into visible text while still failing loudly on a
   real render error. Timers never fire, so nothing runs away. */
const flush = () => new Promise(resolve => setImmediate(resolve))
const errorTexts = list => list.map(error => (error && error.message) || String(error))

function renderNode(node, depth, sink, path) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, depth + 1, sink, `${path}.${index}`)).join(' ')
  if (typeof node !== 'object') return ''
  // Only a runaway guard: real trees reach ~20 levels (card → grid → field →
  // row → button). A tight limit silently truncated the settings card, which is
  // exactly how a missing button could hide from this suite.
  if (depth > 40) return ''
  const type = node.type
  if (typeof type === 'string') return renderNode(node.children, depth + 1, sink, path)
  if (typeof type !== 'function') return renderNode(node.children, depth + 1, sink, path)

  const name = type.name || 'anonymous'
  const key = `${name}@${path}`
  if (sink.nodes) sink.nodes.push(node)
  if (!slotStore.has(key)) slotStore.set(key, { list: [], index: 0, effects: [] })
  const state = slotStore.get(key)
  state.index = 0
  state.effects = []
  hookStack.push(state)
  let output = null
  try {
    if (type.prototype && type.prototype.isReactComponent) {
      const instance = new type(node.props)
      instance.props = node.props || {}
      output = instance.render()
    } else {
      output = type(node.props || {})
    }
  } catch (error) {
    sink.errors.push(error)
    return ''
  } finally {
    hookStack.pop()
  }
  sink.effects.push(...state.effects)
  return renderNode(output, depth + 1, sink, path)
}

async function render(component, props, rounds = 6) {
  const errors = []
  let text = ''
  let nodes = []
  for (let round = 0; round < rounds; round += 1) {
    const sink = { errors: [], effects: [], nodes: [] }
    text = renderNode({ type: component, props: props || {}, children: [] }, 0, sink, 'root')
    nodes = sink.nodes
    errors.push(...sink.errors)
    if (sink.errors.length > 0) break
    for (const item of sink.effects) {
      try {
        const result = item.effect()
        if (result && typeof result.then === 'function') result.catch(error => errors.push(error))
      } catch (error) {
        errors.push(error)
      }
    }
    await flush()
    await flush()
  }
  return { text, errors, nodes }
}

const dryRun = async (name, component, props) => {
  slotStore.clear()
  const { text, errors } = await render(component, props)
  check(`${name} renders`, errors.length === 0, errorTexts(errors))
  check(`${name} produced output`, text.length > 0, text.slice(0, 120))
  return { text }
}

const fixtures = await buildSnapshots()
canned = {
  '/api/ai-replica/health': { ok: true, version: '2.0.0', has_key: true, source: 'secrets', cutout: 'local-browser', compositor: 'host-node' },
  '/api/ai-replica/settings': fixtures.settings,
  '/api/ai-replica/tasks': { ok: true, total: fixtures.history.total, items: fixtures.history.items },
  '/api/ai-replica/settings/models': { ok: true, kind: 'vision', count: 2, models: ['pick-a', 'pick-b'], ms: 4 },
  '/api/ai-replica/describe': fixtures.described,
  '/api/ai-replica/product-profile': fixtures.described,
}
const notify = () => {}
const noop = async () => {}

// Controls: prove the harness itself catches throws and really does re-render
// after an async effect, so a green run below means something.
const throwing = await render(() => {
  throw new Error('control-throw')
}, {})
check('renderer surfaces component errors', throwing.errors.some(error => String(error.message).includes('control-throw')), errorTexts(throwing.errors))

const asyncState = await render(function AsyncControl() {
  const [value, setValue] = React.useState('loading')
  React.useEffect(() => {
    Promise.resolve().then(() => setValue('ready'))
  }, [])
  return value
}, {})
check('renderer re-renders after an async effect', asyncState.text === 'ready', asyncState.text)

const home = await dryRun('home', internals.HomeView, { settings: fixtures.settings, snapshot: null, notify, onCreated: noop })
check('home shows the upload gate', home.text.includes('参考图') || home.text.includes('商品'), home.text.slice(0, 200))

const scene = await dryRun('scene stage', internals.SceneStage, { snapshot: fixtures.analyzed, settings: fixtures.settings, onChanged: noop, notify })
check('scene stage shows the analysis', scene.text.includes('场景') || scene.text.includes('机位'), scene.text.slice(0, 200))

const mask = await dryRun('mask stage', internals.MaskStage, { snapshot: fixtures.reviewed, onChanged: noop, notify })
check('mask stage shows the confirm gate', mask.text.includes('蒙版') || mask.text.includes('抠图'), mask.text.slice(0, 200))

const background = await dryRun('background stage', internals.BackgroundStage, { snapshot: fixtures.background, onChanged: noop, notify })
check('background stage lists the version', background.text.includes('背景'), background.text.slice(0, 200))

const workbench = await dryRun('workbench', internals.Workbench, { snapshot: fixtures.editing, onChanged: noop, notify })
check('workbench shows the export action', workbench.text.includes('导出') || workbench.text.includes('合成'), workbench.text.slice(0, 200))

const accept = await dryRun('accept stage', internals.AcceptStage, { snapshot: fixtures.done, onChanged: noop, notify })
check('accept stage shows the rating gate', accept.text.includes('评分') || accept.text.includes('验收'), accept.text.slice(0, 200))

const history = await dryRun('history', internals.HistoryView, { items: fixtures.history.items, notify, onOpen: noop, onChanged: noop })
check('history lists the task', history.text.includes(fixtures.id), history.text.slice(0, 200))

const settingsView = await dryRun('settings', internals.SettingsView, {
  settings: fixtures.settings.settings,
  health: { has_key: true, key_source: 'secrets', version: '2.0.0' },
  onSettings: () => {},
  notify,
})
check('settings shows the relay fields', settingsView.text.includes('中转') || settingsView.text.includes('模型'), settingsView.text.slice(0, 200))

const named = (list, name) => list.filter(node => node && typeof node.type === 'function' && node.type.name === name)

/* 商品信息（商品描述词）：上传商品图后由视觉模型提取，卡片要显示结果，
   「重新提取」要真的调用 Host，改完要能保存。 */
const sceneProps = {
  snapshot: fixtures.reviewed,
  settings: fixtures.settings,
  notify,
  onChanged: () => {},
}
slotStore.clear()
const sceneRender = await render(internals.SceneStage, sceneProps)
check('scene stage renders the product card', sceneRender.errors.length === 0, errorTexts(sceneRender.errors))
check('product card shows the extracted name', sceneRender.text.includes('测试保温杯 500ml'), sceneRender.text.slice(0, 200))
check('product card shows the colour', sceneRender.text.includes('哑光黑'), sceneRender.text.slice(0, 300))
check('product card labels the three sections', ['1. 商品名称', '2. 核心卖点', '3. 规格参数'].every(label => sceneRender.text.includes(label)), sceneRender.text.slice(0, 300))
const sceneButtons = named(sceneRender.nodes, 'Btn')
const redescribe = sceneButtons.find(node => node.props && node.props.children === '重新提取')
check('product card exposes a re-extract button', Boolean(redescribe && typeof redescribe.props.onClick === 'function'), sceneButtons.map(node => node.props && node.props.children))
fetchLog.length = 0
let describeFailure = null
try {
  await redescribe.props.onClick()
  await flush()
  await flush()
} catch (error) {
  describeFailure = error
}
check('re-extract did not throw', describeFailure === null, describeFailure && describeFailure.message)
const describeRequest = fetchLog.find(entry => entry.method === 'POST' && entry.url.includes('/describe'))
check('re-extract calls the host describe route', Boolean(describeRequest && describeRequest.url.includes(fixtures.id)), fetchLog)

/* Interaction: the save button must really produce a two-channel PUT, and the
   fetch-models button must really ask the Host. A render that merely "looks
   fine" is what lets a broken settings page ship. */
slotStore.clear()
const settingsRender = await render(internals.SettingsView, { onSettings: () => {}, notify })
check('settings renders for interaction', settingsRender.errors.length === 0, errorTexts(settingsRender.errors))
check('settings shows the three tab labels', ['视觉通道', '生图通道', '全局'].every(label => settingsRender.text.includes(label)), settingsRender.text.slice(0, 200))
const buttons = named(settingsRender.nodes, 'Btn')
const saveButton = buttons.find(node => node.props && node.props.variant === 'primary')
check('settings save button exists', Boolean(saveButton && typeof saveButton.props.onClick === 'function'), buttons.map(node => node.props && node.props.children))

let saveFailure = null
fetchLog.length = 0
try {
  await saveButton.props.onClick()
  await flush()
  await flush()
} catch (error) {
  saveFailure = error
}
const putRequest = fetchLog.find(entry => entry.method === 'PUT' && entry.url.includes('/settings'))
check('settings save did not throw', saveFailure === null, saveFailure && saveFailure.message)
check('settings save issued a PUT', Boolean(putRequest), fetchLog)
check('settings save sends both channels', Boolean(putRequest
  && putRequest.body.settings.vision
  && putRequest.body.settings.image
  && typeof putRequest.body.settings.vision.base_url === 'string'
  && typeof putRequest.body.settings.image.base_url === 'string'), putRequest && Object.keys(putRequest.body))
check('settings save never sends a key', Boolean(putRequest
  && !('api_key' in putRequest.body)
  && !('vision_api_key' in putRequest.body)
  && !('image_api_key' in putRequest.body)), putRequest && Object.keys(putRequest.body))

/* One-click model fetch: the button must ask the Host, and the returned list
   must land in the form so nobody has to type a model id from memory. */
const fetchModelsButton = buttons.find(node => node.props && node.props.children === '拉取模型')
check('settings exposes a fetch-models button', Boolean(fetchModelsButton && typeof fetchModelsButton.props.onClick === 'function'), buttons.map(node => node.props && node.props.children))
fetchLog.length = 0
let modelsFailure = null
try {
  await fetchModelsButton.props.onClick()
  await flush()
  await flush()
} catch (error) {
  modelsFailure = error
}
const modelsRequest = fetchLog.find(entry => entry.method === 'POST' && entry.url.includes('/settings/models'))
check('fetch models did not throw', modelsFailure === null, modelsFailure && modelsFailure.message)
check('fetch models calls the host route', Boolean(modelsRequest), fetchLog)
check('fetch models sends the channel, not a key', Boolean(modelsRequest
  && modelsRequest.body.kind === 'vision'
  && modelsRequest.body.channel
  && typeof modelsRequest.body.channel.base_url === 'string'
  && !('api_key' in modelsRequest.body)
  && !('vision_api_key' in modelsRequest.body)), modelsRequest && modelsRequest.body)
const afterModels = await render(internals.SettingsView, { onSettings: () => {}, notify }, 3)
check('fetched models appear as a picker', afterModels.text.includes('pick-a') || afterModels.text.includes('从列表中选择'), afterModels.text.slice(0, 300))

for (const state of ['analyzing', 'remote_outcome_unknown', 'failed', 'cancelled', 'mask_rejected']) {
  const fixture = state === 'mask_rejected'
    ? Object.assign({}, fixtures.reviewed, { task: Object.assign({}, fixtures.reviewed.task, { state }) })
    : Object.assign({}, fixtures.analyzed, { task: Object.assign({}, fixtures.analyzed.task, { state }) })
  const rendered = await dryRun(`task view (${state})`, internals.TaskView, {
    snapshot: fixture,
    settings: fixtures.settings,
    refresh: noop,
    onChanged: noop,
    notify,
  })
  check(`task view (${state}) shows a banner or stage`, rendered.text.length > 10, rendered.text.slice(0, 120))
}

const stepper = await dryRun('stepper', internals.Stepper, { state: 'editing' })
check('stepper renders every step', stepper.text.length > 0, stepper.text)

const sidebar = registered.find(item => item.target && item.target.name === 'sidebar.panellist')
const sidebarLabel = sidebar && typeof sidebar.target.label === 'function' ? sidebar.target.label() : ''
check('sidebar label is the plugin name', typeof sidebarLabel === 'string' && sidebarLabel.includes('复刻'), sidebarLabel)

const page = await dryRun('page shell', internals.Page, { ctx: fakeCtx })
check('page shell renders the app', page.text.length > 0, page.text.slice(0, 200))
check('page shell shows the navigation', page.text.includes('历史') || page.text.includes('设置'), page.text.slice(0, 200))

console.log(`PASS ${pass} / FAIL ${fail}`)
if (fail > 0) process.exit(1)
