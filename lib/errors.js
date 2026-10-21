/**
 * Stable error codes shared by every Host module and the route layer.
 *
 * The Client never shows an English stack trace: every code carries the Chinese
 * sentence the page displays, and `toErrorPayload` keeps the wire shape
 * `{ ok:false, code, error }` the page already knows.
 */

export const CODES = {
  'bad-request': { status: 400, zh: '请求参数不完整或格式不正确' },
  'cross-site-denied': { status: 403, zh: '跨站请求已拒绝：请从复刻页面操作' },
  'method-not-allowed': { status: 405, zh: '请求方法不被允许' },
  'invalid-json': { status: 400, zh: '请求体不是合法 JSON' },
  'body-too-large': { status: 413, zh: '请求体过大' },
  'product-required': { status: 400, zh: '保真复刻必须有商品图；如需无商品图请先打开创意模式' },
  'asset-invalid': { status: 415, zh: '素材无法识别：请使用 PNG / JPEG / WebP 图片' },
  'asset-too-large': { status: 413, zh: '素材超过大小上限' },

  'task-not-found': { status: 404, zh: '任务不存在或已被删除' },
  'invalid-state': { status: 409, zh: '当前阶段不允许这个操作' },
  'task-locked': { status: 409, zh: '任务正被占用，请稍后再试' },

  'scene-schema-invalid': { status: 422, zh: '场景数据不符合契约，已阻止后续步骤' },
  'scene-unconfirmed': { status: 409, zh: '还有无法确认的场景项需要人工确认' },
  'scene-missing': { status: 409, zh: '还没有场景分析结果' },
  'mask-unconfirmed': { status: 409, zh: '蒙版尚未人工确认，不能进入下一步' },
  'mask-invalid': { status: 422, zh: '蒙版或抠图结果无效' },
  'view-mismatch': { status: 409, zh: '视角不匹配：请明确选择是否继续' },
  'background-missing': { status: 409, zh: '还没有可用的背景图' },
  'background-invalid': { status: 422, zh: '背景图不合格（可能含商品、人或文字）' },
  'composition-invalid': { status: 422, zh: '画布参数不符合契约' },
  'export-failed': { status: 500, zh: '导出失败' },

  'provider-missing': { status: 409, zh: '尚未配置中转站地址或 API Key' },
  'provider-auth': { status: 502, zh: 'API Key 无效或没有权限（401/403）' },
  'provider-not-found': { status: 502, zh: '接口路径或模型名不存在（404）' },
  'provider-rate-limit': { status: 429, zh: '中转站限流（429），请稍后再试' },
  'provider-error': { status: 502, zh: '中转站返回错误' },
  'provider-timeout-unknown': {
    status: 504,
    zh: '请求超时，远程结果未知：可能已经产生费用，系统不会自动重发，请人工确认后再决定',
  },
  'image-parse-failed': { status: 502, zh: '接口没有返回可识别的图片数据' },
  'image-too-large': { status: 413, zh: '返回的图片超过大小上限' },
  'url-unsafe': { status: 400, zh: '该图片地址不被允许（内网、非 HTTPS 或不是图片）' },
  'budget-exhausted': { status: 409, zh: '本任务的调用次数预算已用尽' },
  'relay-disabled': { status: 409, zh: '中转站未启用' },
  'internal-error': { status: 500, zh: '内部错误' },
}

export class AppError extends Error {
  constructor(code, message, opts = {}) {
    const known = CODES[code] || CODES['internal-error']
    super(String(message || known.zh))
    this.name = 'AppError'
    this.code = CODES[code] ? code : 'internal-error'
    this.status = Number(opts.status) || known.status
    this.detail = opts.detail === undefined ? null : opts.detail
  }
}

/** Any thrown value → the wire payload. Unknown codes degrade to internal-error
 *  while the original message is still shown, because a blank error helps nobody. */
export function toErrorPayload(error) {
  let code = 'internal-error'
  let status = 500
  let message = ''
  if (error && typeof error === 'object') {
    if (typeof error.code === 'string' && CODES[error.code]) code = error.code
    status = Number(error.status) || (CODES[code] ? CODES[code].status : 500)
    message = String(error.message || '')
  } else {
    message = String(error || '')
  }
  if (!message) message = CODES[code] ? CODES[code].zh : CODES['internal-error'].zh
  const payload = { ok: false, code, error: message }
  if (error && error.detail !== undefined && error.detail !== null) payload.detail = error.detail
  return { status, payload }
}

export function fail(code, message, opts) {
  return new AppError(code, message, opts)
}
