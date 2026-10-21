/**
 * 商品信息提取（商品描述词）。文档约定：模型按固定顺序输出
 *   1. 商品名称  2. 核心卖点  3. 规格参数（(1) 颜色 (2) 外观）
 * 这里只做「把模型文本解析成结构」与「补全缺失字段」，不做任何推测：
 * 解析不到的字段一律 `未提供`，检测到多个互相矛盾的值时标记 `信息冲突`。
 */

export const PRODUCT_SCHEMA_VERSION = '1.0'
export const UNKNOWN_VALUE = '未提供'
export const CONFLICT_VALUE = '信息冲突'
export const MAX_SELLING_POINTS = 3

const NAME_LABELS = ['商品名称', '产品名称', '名称', 'product name', 'product', 'name']
const POINT_LABELS = ['核心卖点', '卖点', 'selling points', 'selling point', 'highlights']
const COLOR_LABELS = ['颜色', 'colour', 'color']
const APPEARANCE_LABELS = ['外观', 'appearance', 'look']
const SPEC_HEADER = ['规格参数', '规格', 'specifications', 'specs']

const LABEL_CACHE = [...NAME_LABELS, ...POINT_LABELS, ...COLOR_LABELS, ...APPEARANCE_LABELS, ...SPEC_HEADER]
  .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

/** `**1. 商品名称：**` / `- （1）颜色：` / `Selling points:` 都算标签行。 */
const LABEL_LINE = new RegExp(`^[\\s>*\\-#•·]*(?:\\(?\\d{1,2}[).、]\\s*|[（(]\\d{1,2}[)）]\\s*)?(${LABEL_CACHE})\\s*[:：]?\\s*(.*)$`, 'i')

const clean = value => String(value == null ? '' : value)
  .replace(/\*\*/g, '')
  .replace(/^[\s>*\-•·]+/, '')
  .replace(/[\s*]+$/, '')
  .trim()

function matchLabel(line) {
  const found = LABEL_LINE.exec(clean(line))
  if (!found) return null
  const rawLabel = found[1].toLowerCase()
  const value = clean(found[2] || '')
  const pick = list => list.some(item => rawLabel === item.toLowerCase() || rawLabel === item.toLowerCase().replace(/\s+/g, ''))
  if (pick(NAME_LABELS)) return { field: 'name', value }
  if (pick(POINT_LABELS)) return { field: 'points', value }
  if (pick(COLOR_LABELS)) return { field: 'color', value }
  if (pick(APPEARANCE_LABELS)) return { field: 'appearance', value }
  if (pick(SPEC_HEADER)) return { field: 'specs', value }
  return null
}

function splitPoints(value) {
  return clean(value)
    .split(/[；;、]+|,(?!\d)|\n/)
    .map(item => clean(item).replace(/^[（(]?\d{1,2}[)）.、]\s*/, ''))
    .filter(Boolean)
}

/** 去掉「未提供 / 信息冲突」占位，让调用方知道其实没拿到值。 */
function usable(value) {
  const text = clean(value)
  if (!text) return ''
  if (text === UNKNOWN_VALUE || text === CONFLICT_VALUE) return ''
  return text
}
/**
 * 把模型输出解析成商品档案。支持固定文本格式，也容忍模型改回 JSON。
 */
export function parseProductText(raw) {
  const source = String(raw == null ? '' : raw).trim()
  const profile = {
    schema_version: PRODUCT_SCHEMA_VERSION,
    name: '',
    selling_points: [],
    color: '',
    appearance: '',
    notes: [],
  }
  if (!source) return profile

  if (source.startsWith('{') || source.startsWith('[')) {
    try {
      const parsed = JSON.parse(source)
      const body = Array.isArray(parsed) ? parsed[0] || {} : parsed
      profile.name = usable(body.name || body.product_name || '')
      const points = body.selling_points || body.points || body.sellingPoints || []
      profile.selling_points = (Array.isArray(points) ? points : splitPoints(points))
        .map(clean)
        .filter(item => item && item !== UNKNOWN_VALUE && item !== CONFLICT_VALUE)
        .slice(0, MAX_SELLING_POINTS)
      const specs = body.specs || body.specifications || {}
      profile.color = usable(body.color || specs.color || specs.colour || '')
      profile.appearance = usable(body.appearance || specs.appearance || specs.look || '')
      return profile
    } catch {
      // 不是 JSON 就按文本格式继续解析
    }
  }

  let current = null
  const conflicts = []
  // 「信息冲突」不是值，是信号：丢掉占位但要在 notes 里留下痕迹。
  const take = value => {
    const text = clean(value)
    if (text === CONFLICT_VALUE) {
      if (!conflicts.includes(CONFLICT_VALUE)) conflicts.push(CONFLICT_VALUE)
      return ''
    }
    return usable(text)
  }
  for (const line of source.split(/\r?\n/)) {
    const label = matchLabel(line)
    if (label) {
      current = label.field
      if (label.field === 'name' && label.value) profile.name = take(label.value)
      if (label.field === 'points' && label.value) profile.selling_points.push(...splitPoints(label.value))
      if (label.field === 'color' && label.value) profile.color = take(label.value)
      if (label.field === 'appearance' && label.value) profile.appearance = take(label.value)
      continue
    }
    const value = clean(line)
    if (!value) continue
    if (current === 'name' && !profile.name) profile.name = take(value)
    else if (current === 'points') profile.selling_points.push(...splitPoints(value))
    else if (current === 'color' && !profile.color) profile.color = take(value)
    else if (current === 'appearance' && !profile.appearance) profile.appearance = take(value)
  }
  profile.notes = conflicts

  profile.selling_points = profile.selling_points
    .map(item => clean(item).replace(/^[（(]?\d{1,2}[)）.、]\s*/, ''))
    .filter(Boolean)
    .slice(0, MAX_SELLING_POINTS)
  // 同一卖点出现两次只留一次
  profile.selling_points = profile.selling_points.filter((item, index) => profile.selling_points.indexOf(item) === index)
  return profile
}

/** 人工编辑/旧档案补全：字段永远齐全，占位符统一成「未提供」。 */
export function normalizeProductProfile(input) {
  const source = input && typeof input === 'object' ? input : {}
  const points = Array.isArray(source.selling_points)
    ? source.selling_points
    : splitPoints(source.selling_points || '')
  const unique = []
  for (const item of points) {
    const text = usable(item)
    if (text && !unique.includes(text)) unique.push(text)
  }
  const conflict = value => clean(value) === CONFLICT_VALUE
  const name = clean(source.name)
  const color = clean(source.color)
  const appearance = clean(source.appearance)
  const notes = (Array.isArray(source.notes) ? source.notes : [])
    .map(clean)
    .filter(item => item === CONFLICT_VALUE)
  if ((conflict(name) || conflict(color) || conflict(appearance)) && !notes.includes(CONFLICT_VALUE)) {
    notes.push(CONFLICT_VALUE)
  }
  return {
    schema_version: PRODUCT_SCHEMA_VERSION,
    name: name || UNKNOWN_VALUE,
    selling_points: unique.slice(0, MAX_SELLING_POINTS),
    color: color || UNKNOWN_VALUE,
    appearance: appearance || UNKNOWN_VALUE,
    notes,
  }
}

/** 是否拿到了可用信息（全是「未提供」时前端不该假装成功）。 */
export function hasProductInfo(profile) {
  if (!profile) return false
  const real = value => clean(value) && clean(value) !== UNKNOWN_VALUE && clean(value) !== CONFLICT_VALUE
  return real(profile.name) || real(profile.color) || real(profile.appearance) || (profile.selling_points || []).length > 0
}

/** 给提示词/界面用的一句话摘要。 */
export function productSummary(profile, { lang = 'zh' } = {}) {
  if (!profile || !hasProductInfo(profile)) return ''
  const english = String(lang).toLowerCase().startsWith('en')
  const real = value => {
    const text = clean(value)
    return text && text !== UNKNOWN_VALUE && text !== CONFLICT_VALUE ? text : ''
  }
  const name = real(profile.name)
  const color = real(profile.color)
  const appearance = real(profile.appearance)
  const points = (profile.selling_points || []).map(clean).filter(Boolean).slice(0, MAX_SELLING_POINTS)
  if (english) {
    return [
      name ? `product: ${name}` : '',
      points.length ? `selling points: ${points.join('; ')}` : '',
      color ? `colour: ${color}` : '',
      appearance ? `appearance: ${appearance}` : '',
    ].filter(Boolean).join(' | ')
  }
  return [
    name ? `商品：${name}` : '',
    points.length ? `卖点：${points.join('；')}` : '',
    color ? `颜色：${color}` : '',
    appearance ? `外观：${appearance}` : '',
  ].filter(Boolean).join('｜')
}

/** 界面用：三段固定字段的展示文本。 */
export function productLines(profile) {
  const normalized = normalizeProductProfile(profile)
  return [
    { field: 'name', label: '商品名称', value: normalized.name },
    { field: 'selling_points', label: '核心卖点', value: normalized.selling_points.join('；') || UNKNOWN_VALUE },
    { field: 'color', label: '规格参数 · 颜色', value: normalized.color },
    { field: 'appearance', label: '规格参数 · 外观', value: normalized.appearance },
  ]
}
