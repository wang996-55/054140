// Boots the Host half the way the Loader does: import index.js, give it a fake
// context, and drive the registered routes over fake request objects.
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(os.tmpdir(), 'replica-apply-'))
process.env.DSH_PROFILE_DIR = root

const plugin = await import('../index.js')

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

check('inject webServer', Array.isArray(plugin.inject) && plugin.inject[0] === 'webServer', plugin.inject)
check('apply exported', typeof plugin.apply === 'function')

const routes = []
const state = { disposed: 0 }
const ctx = {
  effect(callback) {
    const disposeRoutes = callback()
    ctx.__dispose = () => {
      if (typeof disposeRoutes === 'function') disposeRoutes()
      state.disposed += 1
    }
  },
  webServer: {
    getOrigin: () => 'http://127.0.0.1:52434',
    register(route) {
      if (routes.some(item => item.kind === route.kind && item.path === route.path)) throw new Error(`duplicate ${route.kind} ${route.path}`)
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  },
  get: () => undefined,
}

plugin.apply(ctx)
check('routes registered', routes.length === 7, routes.map(route => `${route.kind}:${route.path}`))
check('prefix route', routes.some(route => route.kind === 'prefix' && route.path === '/api/ai-replica/tasks/'))

class Req extends EventEmitter {
  constructor(method, url, headers) {
    super()
    this.method = method
    this.url = url
    this.headers = headers || { host: '127.0.0.1:52434' }
    this.pumped = false
  }
  on(event, listener) {
    super.on(event, listener)
    if (!this.pumped && (event === 'end' || event === 'data')) {
      this.pumped = true
      setImmediate(() => super.emit('end'))
    }
    return this
  }
}

class Res {
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
  }
  json() {
    try {
      return JSON.parse(Buffer.concat(this.chunks).toString('utf8'))
    } catch {
      return null
    }
  }
}

async function hit(method, url, headers) {
  const route = routes.find(item => (item.kind === 'exact' ? item.path === url.split('?')[0] : url.startsWith(item.path)))
  if (!route) return { status: 0, body: null }
  const res = new Res()
  await route.handler(new Req(method, url, headers), res)
  return { status: res.status, body: res.json() }
}

const health = await hit('GET', '/api/ai-replica/health')
check('health ok', health.status === 200 && health.body.ok === true, health.body)
check('health reports compositor', health.body && health.body.compositor === 'host-node', health.body)

const settings = await hit('GET', '/api/ai-replica/settings')
check('settings ok', settings.status === 200 && typeof settings.body.settings.base_url === 'string', settings.status)

const tasks = await hit('GET', '/api/ai-replica/tasks')
check('task list ok', tasks.status === 200 && Array.isArray(tasks.body.items), tasks.status)

const missing = await hit('GET', '/api/ai-replica/tasks/does-not-exist')
check('missing task 404', missing.status === 404, missing.status)

const crossSite = await hit('GET', '/api/ai-replica/health', { host: '127.0.0.1:52434', origin: 'https://evil.example' })
check('cross-site denied', crossSite.status === 403 && crossSite.body.code === 'cross-site-denied', crossSite.body)

const badHost = await hit('GET', '/api/ai-replica/health', { host: 'evil.example' })
check('unknown host denied', badHost.status === 403, badHost.status)

const sameOrigin = await hit('GET', '/api/ai-replica/health', { host: '127.0.0.1:52434', origin: 'http://127.0.0.1:52434' })
check('same origin allowed', sameOrigin.status === 200, sameOrigin.status)

const localhostAlias = await hit('GET', '/api/ai-replica/health', { host: 'localhost:52434', origin: 'http://localhost:52434' })
check('localhost alias allowed', localhostAlias.status === 200, localhostAlias.status)

ctx.__dispose()
check('routes disposed', routes.length === 0, routes.length)
check('effect disposed', state.disposed === 1, state.disposed)

await rm(root, { recursive: true, force: true })
console.log(`PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
