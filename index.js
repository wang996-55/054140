/**
 * Host half of the AI 爆款图复刻 bundle (v2.0.0).
 *
 * Everything the page cannot safely do in a browser happens here, on the same
 * origin as the Web UI — no extra port, no second process:
 *
 *   GET    /health                 liveness, storage root, key state
 *   GET    /settings               provider settings + enums/labels for the forms
 *   PUT    /settings               save settings (the key goes to secrets.json)
 *   POST   /settings/test          one explicit, paid relay test
 *   GET    /tasks                  history list
 *   POST   /tasks                  create a task (form + reference/product images)
 *   GET    /tasks/:id              full task snapshot (the page polls this)
 *   DELETE /tasks/:id?confirm=1    delete a task directory
 *   POST   /tasks/:id/analyze      vision call → scene_analysis.json
 *   PUT    /tasks/:id/scene-review save the reviewed scene (gate)
 *   POST   /tasks/:id/cutout       store the cutout result + mask
 *   PUT    /tasks/:id/mask         confirm the mask (gate)
 *   POST   /tasks/:id/compatibility  view check; needs confirm_continue on warn
 *   POST   /tasks/:id/background   generate / upload / select (gate on select)
 *   PUT    /tasks/:id/composition  save canvas parameters
 *   POST   /tasks/:id/export       authoritative composite → PNG
 *   POST   /tasks/:id/accept       rating + notes → done
 *   POST   /tasks/:id/cancel       stop the pipeline
 *   GET    /file?task=&file=       serve one asset or export
 *   POST   /reveal                 open the export folder
 */
import { createHandlers, PREFIX } from './lib/api.js'
import { toErrorPayload } from './lib/errors.js'

export const inject = ['webServer']

// --------------------------------------------------------------- request trust

const trustedOrigins = new Set()
const trustedLocalEndpoints = new Set()
const trustedRequestHostnames = new Set()

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

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(value)
}

function isTrustedHostname(hostname) {
  return isLoopbackHostname(hostname) || trustedRequestHostnames.has(String(hostname || '').toLowerCase())
}

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
  if (!value || !HOST_HEADER_PATTERN.test(value)) return ''
  try {
    return new URL(`http://${value}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function requestOriginAllowed(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase()
  if (site === 'cross-site') return false
  const hostName = hostnameFromHostHeader(req.headers.host)
  if (!hostName || !isTrustedHostname(hostName)) return false
  const origin = String(req.headers.origin || '')
  if (origin) return isTrustedOrigin(origin)
  const referer = String(req.headers.referer || '')
  if (referer) return isTrustedOrigin(referer)
  return true
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
  if (trustedOrigins.size === 0) {
    console.warn('[ai-replica] 未能获取 Web GUI 的 Origin，所有带 Origin 的请求都会被拒绝')
  }
}

const TASK_PREFIX = `${PREFIX}/tasks/`

function wrap(handler) {
  return (req, res) => {
    if (!requestOriginAllowed(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, code: 'cross-site-denied', error: '跨站请求已拒绝：请从复刻页面操作' }))
      return
    }
    return Promise.resolve()
      .then(() => handler(req, res))
      .catch(error => {
        if (res.headersSent) {
          try {
            res.end()
          } catch {
            // already closed
          }
          return
        }
        const { status, payload } = toErrorPayload(error)
        const body = JSON.stringify(payload)
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      })
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    configureRequestTrust(ctx)
    const handlers = createHandlers()

    const taskRoute = (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const rest = url.pathname.slice(TASK_PREFIX.length)
      const parts = rest.split('/').filter(Boolean)
      if (parts.length === 0) return handlers.tasks(req, res)
      const id = decodeURIComponent(parts[0])
      if (parts.length === 1) return handlers.taskById(req, res, id)
      return handlers.action(req, res, id, parts[1])
    }

    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/health`, handler: wrap(handlers.health) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/settings`, handler: wrap(handlers.settings) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/settings/test`, handler: wrap(handlers.test) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/file`, handler: wrap(handlers.file) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/reveal`, handler: wrap(handlers.reveal) }),
      ctx.webServer.register({ kind: 'exact', path: `${PREFIX}/tasks`, handler: wrap(handlers.tasks) }),
      ctx.webServer.register({ kind: 'prefix', path: TASK_PREFIX, handler: wrap(taskRoute) }),
    ]
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // already disposed
        }
      }
    }
  })
}
