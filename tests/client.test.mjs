// Loads client.js inside Node with a stub module loader and a stub React, then
// asserts the plugin registers its page and sidebar entry. No rendering.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const registrations = []
let factory = null

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory: loaded }) {
      registrations.push({ id })
      factory = loaded
    },
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
  },
}
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, textContent: '', appendChild: () => {} }),
  head: { appendChild: () => {} },
}
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Component: class { constructor(props) { this.props = props; this.state = {} } },
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: factoryFn => factoryFn(),
  useCallback: fn => fn,
  useRef: () => ({ current: null }),
}

const source = await readFile(path.join(root, 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
const run = new Function('window', 'document', 'React', 'require', source)
run(globalThis.window, globalThis.document, React, spec => {
  if (spec === 'react') return React
  throw new Error(`unexpected require: ${spec}`)
})

check('module id', registrations.length === 1 && registrations[0].id === '@local/ai-replica', registrations)
check('factory exported', typeof factory === 'function')

const plugin = factory(spec => {
  if (spec === 'react') return React
  throw new Error(`unexpected require: ${spec}`)
})
check('inject list', Array.isArray(plugin.inject) && plugin.inject.includes('slots'), plugin.inject)
check('apply exported', typeof plugin.apply === 'function')

const slots = []
const ctx = {
  slots: {
    inject(name, callback) {
      callback()
    },
    register(spec, render) {
      slots.push({ spec, render })
      return () => {}
    },
  },
  locale: {
    getLocale: () => ({ id: 'zh-CN' }),
    subscribe: () => () => {},
  },
  theme: {},
  layout: {},
  uiWorkspace: {},
}

plugin.apply(ctx)

const mainSlot = slots.find(entry => entry.spec.name === 'main')
const sidebarSlot = slots.find(entry => entry.spec.name === 'sidebar.panellist')
check('main slot registered', Boolean(mainSlot), slots.map(entry => entry.spec.name))
check('main slot key', mainSlot && mainSlot.spec.key === 'ai-replica', mainSlot && mainSlot.spec)
check('sidebar registered', Boolean(sidebarSlot), slots.map(entry => entry.spec.name))
check('sidebar label zh', sidebarSlot && sidebarSlot.spec.label() === '爆款图复刻', sidebarSlot && sidebarSlot.spec.label())
check('render factories', typeof mainSlot.render === 'function' && typeof sidebarSlot.render === 'function')

const element = mainSlot.render()
check('page element', Boolean(element) && typeof element.type === 'function', typeof element && element.type)

const source_checks = [
  ['no api key in client', !/api_key\s*:\s*[a-z]/i.test(source) || !/secrets\.json/.test(source)],
  ['host routes only', source.includes("const API = '/api/ai-replica'")],
  // The settings page is a scrolling, paged form: without these the layout is
  // back to one tall column whose save button can fall out of the panel.
  ['settings slide keyframes shipped', source.includes('@keyframes rep-slide-right') && source.includes('@keyframes rep-slide-left')],
  ['settings save bar is sticky', /position:\s*'sticky'/.test(source)],
  ['settings panels are tabbed', source.includes('SETTINGS_TABS')],
  ['app root scrolls', /overflowY:\s*'auto'/.test(source)],
  // 商品信息（描述词）：上传后立刻提取，卡片三个固定分节必须在客户端里。
  ['product profile card exists', source.includes('function ProductCard')],
  ['product profile uses the describe route', source.includes("'describe'") && source.includes('product-profile')],
  ['product profile keeps the fixed order', source.includes("profileName: '1. 商品名称'")
    && source.includes("profilePoints: '2. 核心卖点")
    && source.includes("profileColor: '3. 规格参数 · 颜色'")
    && source.includes("profileAppearance: '3. 规格参数 · 外观'")],
  ['home extracts product info after upload', /api\(`\/describe\?id=/.test(source)],
]
for (const [name, condition] of source_checks) check(name, condition)

console.log(`PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
