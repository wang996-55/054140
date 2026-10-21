/**
 * Data contracts (文档 §3 / §4) plus the coercion the UI needs.
 *
 *  1. The model answer is never trusted: `validateScene` is strict and a bad
 *     document blocks the pipeline.
 *  2. The UI must never be stuck on a value it cannot render, so `normalizeScene`
 *     maps aliases (English variants, Chinese labels, camelCase) onto the contract
 *     and degrades anything unknown to `unknown`, which the review gate then
 *     forces the user to confirm.
 */

const LIMITS = {
  scene_description: 600, analysis_notes: 1000, color_palette: 8, style_tags: 12,
  reference_texts: 20, risks: 20, text: 200, tag: 40,
}

const REFERENCE_TYPES = ['ecommerce', 'apparel', 'marketing_poster', 'social_post', 'creative_poster', 'other', 'unknown']
const CAMERA_ANGLES = ['eye_level', 'top_down', 'three_quarter', 'low_angle', 'unknown']
const PRODUCT_VIEWS = ['front', 'side', 'back', 'top', 'angle_45', 'unknown']
const LIGHT_DIRECTIONS = ['top_left', 'top_right', 'left', 'right', 'top', 'front', 'back', 'diffuse', 'mixed', 'unknown']
const LIGHT_SOFTNESS = ['hard', 'soft', 'diffuse', 'unknown']
const LIGHT_TEMPERATURE = ['warm', 'neutral', 'cool', 'unknown']
const SURFACE_TYPES = ['tabletop', 'floor', 'podium', 'shelf', 'wall', 'suspended', 'none', 'unknown']
const SURFACE_ORIENTATIONS = ['horizontal', 'vertical', 'unknown']
const CONTACT_HINTS = ['bottom_center', 'bottom_left', 'bottom_right', 'center', 'unknown']
const REGIONS = ['center', 'left', 'right', 'top', 'bottom', 'full_bleed', 'unknown']
const CLEARANCE = ['clear', 'partial', 'blocked', 'unknown']

export const SCENE_ENUMS = {
  reference_type: REFERENCE_TYPES,
  'camera.angle': CAMERA_ANGLES,
  'camera.expected_product_view': PRODUCT_VIEWS,
  'lighting.direction': LIGHT_DIRECTIONS,
  'lighting.softness': LIGHT_SOFTNESS,
  'lighting.temperature': LIGHT_TEMPERATURE,
  'support_surface.type': SURFACE_TYPES,
  'support_surface.orientation': SURFACE_ORIENTATIONS,
  'support_surface.contact_point_hint': CONTACT_HINTS,
  'placement.preferred_region': REGIONS,
  'placement.clearance': CLEARANCE,
}

export const COMPOSITION_ENUMS = {
  'text_layers.placement': ['front', 'behind'],
  'text_layers.align': ['left', 'center', 'right'],
  'text_layers.template_id': ['title_sub_left', 'center_hero', 'corner_tag'],
  'text_layers.font_family': ['system', 'serif'],
}

export const SCENE_LABELS_ZH = {
  reference_type: {
    ecommerce: '电商主图', apparel: '服饰穿搭', marketing_poster: '营销海报', social_post: '社媒图文',
    creative_poster: '创意海报', other: '其它', unknown: '无法判断',
  },
  'camera.angle': { eye_level: '平视', top_down: '俯拍', three_quarter: '三分之四侧', low_angle: '仰拍', unknown: '无法判断' },
  'camera.expected_product_view': {
    front: '正面', side: '侧面', back: '背面', top: '俯视', angle_45: '45° 斜角', unknown: '无法判断',
  },
  'lighting.direction': {
    top_left: '左上方', top_right: '右上方', left: '左侧', right: '右侧', top: '正上方',
    front: '正面光', back: '逆光', diffuse: '漫射', mixed: '混合', unknown: '无法判断',
  },
  'lighting.softness': { hard: '硬光', soft: '柔光', diffuse: '漫射', unknown: '无法判断' },
  'lighting.temperature': { warm: '暖色', neutral: '中性', cool: '冷色', unknown: '无法判断' },
  'support_surface.type': {
    tabletop: '桌面', floor: '地面', podium: '展台', shelf: '层架', wall: '墙面',
    suspended: '悬空', none: '无承载面', unknown: '无法判断',
  },
  'support_surface.orientation': { horizontal: '水平', vertical: '垂直', unknown: '无法判断' },
  'support_surface.contact_point_hint': {
    bottom_center: '底部居中', bottom_left: '左下', bottom_right: '右下', center: '居中', unknown: '无法判断',
  },
  'placement.preferred_region': {
    center: '居中', left: '偏左', right: '偏右', top: '偏上', bottom: '偏下', full_bleed: '满版', unknown: '无法判断',
  },
  'placement.clearance': { clear: '完整留白', partial: '部分遮挡', blocked: '被遮挡', unknown: '无法判断' },
}

export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'reference_type', 'camera', 'lighting', 'support_surface', 'placement',
    'scene_description', 'color_palette', 'style_tags', 'reference_texts', 'risks'],
  properties: {
    schema_version: { type: 'string', minLength: 1, maxLength: 10 },
    reference_type: { type: 'string', enum: REFERENCE_TYPES },
    camera: {
      type: 'object',
      additionalProperties: false,
      required: ['angle', 'expected_product_view', 'confidence'],
      properties: {
        angle: { type: 'string', enum: CAMERA_ANGLES },
        expected_product_view: { type: 'string', enum: PRODUCT_VIEWS },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    lighting: {
      type: 'object',
      additionalProperties: false,
      required: ['direction', 'softness', 'temperature', 'confidence'],
      properties: {
        direction: { type: 'string', enum: LIGHT_DIRECTIONS },
        softness: { type: 'string', enum: LIGHT_SOFTNESS },
        temperature: { type: 'string', enum: LIGHT_TEMPERATURE },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    support_surface: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'orientation', 'contact_point_hint'],
      properties: {
        type: { type: 'string', enum: SURFACE_TYPES },
        orientation: { type: 'string', enum: SURFACE_ORIENTATIONS },
        contact_point_hint: { type: 'string', enum: CONTACT_HINTS },
      },
    },
    placement: {
      type: 'object',
      additionalProperties: false,
      required: ['preferred_region', 'clearance', 'needs_user_confirmation'],
      properties: {
        preferred_region: { type: 'string', enum: REGIONS },
        clearance: { type: 'string', enum: CLEARANCE },
        needs_user_confirmation: { type: 'boolean' },
      },
    },
    scene_description: { type: 'string', maxLength: LIMITS.scene_description },
    color_palette: {
      type: 'array',
      maxItems: LIMITS.color_palette,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['hex'],
        properties: {
          name: { type: 'string', maxLength: LIMITS.tag },
          hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
      },
    },
    style_tags: { type: 'array', maxItems: LIMITS.style_tags, items: { type: 'string', maxLength: LIMITS.tag } },
    reference_texts: {
      type: 'array',
      maxItems: LIMITS.reference_texts,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text: { type: 'string', maxLength: LIMITS.text },
          language: { type: 'string', maxLength: 20 },
          role: { type: 'string', maxLength: LIMITS.tag },
        },
      },
    },
    risks: { type: 'array', maxItems: LIMITS.risks, items: { type: 'string', maxLength: LIMITS.text } },
    analysis_notes: { type: 'string', maxLength: LIMITS.analysis_notes },
  },
}

const TEXT_LAYER_PROPS = {
  id: { type: 'string', pattern: '^[a-z0-9_-]{1,32}$' },
  template_id: { type: 'string', enum: COMPOSITION_ENUMS['text_layers.template_id'] },
  text: { type: 'string', maxLength: 200 },
  font_family: { type: 'string', enum: COMPOSITION_ENUMS['text_layers.font_family'] },
  font_size: { type: 'number', minimum: 0.01, maximum: 0.3 },
  font_weight: { type: 'integer', enum: [400, 500, 600, 700, 800] },
  color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  align: { type: 'string', enum: COMPOSITION_ENUMS['text_layers.align'] },
  x: { type: 'number', minimum: 0, maximum: 1 },
  y: { type: 'number', minimum: 0, maximum: 1 },
  width: { type: 'number', minimum: 0.05, maximum: 1 },
  line_height: { type: 'number', minimum: 0.8, maximum: 3 },
  letter_spacing: { type: 'number', minimum: -0.05, maximum: 0.2 },
  placement: { type: 'string', enum: COMPOSITION_ENUMS['text_layers.placement'] },
  visible: { type: 'boolean' },
}

export const COMPOSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'canvas', 'background', 'product', 'shadow', 'adjustments', 'text_layers', 'meta'],
  properties: {
    schema_version: { type: 'string', minLength: 1, maxLength: 10 },
    canvas: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height', 'preset'],
      properties: {
        width: { type: 'integer', minimum: 256, maximum: 4096 },
        height: { type: 'integer', minimum: 256, maximum: 4096 },
        preset: { type: 'string', maxLength: 16 },
      },
    },
    background: {
      type: 'object',
      additionalProperties: false,
      required: ['asset_id', 'sha256'],
      properties: {
        // Empty until a background is chosen; the export route enforces presence.
        asset_id: { type: 'string', maxLength: 80 },
        sha256: { type: 'string', maxLength: 64 },
        sha256_normalized: { type: 'string', maxLength: 64 },
      },
    },
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['asset_id', 'sha256', 'cx', 'cy', 'width_ratio', 'rotation_deg', 'opacity', 'visible'],
      properties: {
        asset_id: { type: 'string', maxLength: 80 },
        mask_id: { type: 'string', maxLength: 80 },
        sha256: { type: 'string', maxLength: 64 },
        cx: { type: 'number', minimum: 0, maximum: 1 },
        cy: { type: 'number', minimum: 0, maximum: 1 },
        width_ratio: { type: 'number', minimum: 0.01, maximum: 1 },
        rotation_deg: { type: 'number', minimum: -180, maximum: 180 },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        visible: { type: 'boolean' },
      },
    },
    shadow: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'offset_x', 'offset_y', 'blur', 'opacity', 'color', 'contact'],
      properties: {
        enabled: { type: 'boolean' },
        offset_x: { type: 'number', minimum: -20, maximum: 20 },
        offset_y: { type: 'number', minimum: -20, maximum: 20 },
        blur: { type: 'number', minimum: 0, maximum: 20 },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        contact: { type: 'boolean' },
      },
    },
    adjustments: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'brightness', 'warmth'],
      properties: {
        enabled: { type: 'boolean' },
        brightness: { type: 'number', minimum: -1, maximum: 1 },
        warmth: { type: 'number', minimum: -1, maximum: 1 },
      },
    },
    text_layers: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(TEXT_LAYER_PROPS),
        properties: TEXT_LAYER_PROPS,
      },
    },
    meta: {
      type: 'object',
      additionalProperties: false,
      required: ['created_at', 'updated_at', 'params_version'],
      properties: {
        created_at: { type: 'string', minLength: 1, maxLength: 40 },
        updated_at: { type: 'string', minLength: 1, maxLength: 40 },
        params_version: { type: 'string', minLength: 1, maxLength: 16 },
      },
    },
  },
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function validateNode(schema, value, at, errors) {
  if (!schema) return
  const actual = typeOf(value)
  if (schema.type) {
    const allowed = schema.type === 'number' ? ['number', 'integer'] : [schema.type]
    if (allowed.indexOf(actual) < 0) {
      errors.push({ path: at, keyword: 'type', message: `应为 ${schema.type}，实际是 ${actual}` })
      return
    }
  }
  if (schema.enum && schema.enum.indexOf(value) < 0) errors.push({ path: at, keyword: 'enum', message: '取值不在允许范围内' })
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: at, keyword: 'minimum', message: `不能小于 ${schema.minimum}` })
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: at, keyword: 'maximum', message: `不能大于 ${schema.maximum}` })
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: at, keyword: 'minLength', message: `长度不能小于 ${schema.minLength}` })
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path: at, keyword: 'maxLength', message: `长度不能超过 ${schema.maxLength}` })
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path: at, keyword: 'pattern', message: '格式不匹配' })
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: at, keyword: 'maxItems', message: `最多 ${schema.maxItems} 项` })
    if (schema.items) value.forEach((item, index) => validateNode(schema.items, item, `${at}[${index}]`, errors))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {}
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push({ path: at ? `${at}.${key}` : key, keyword: 'required', message: '缺少必填字段' })
    }
    for (const [key, child] of Object.entries(value)) {
      const childAt = at ? `${at}.${key}` : key
      if (!props[key]) {
        if (schema.additionalProperties === false) errors.push({ path: childAt, keyword: 'additionalProperties', message: '不允许的字段' })
        continue
      }
      validateNode(props[key], child, childAt, errors)
    }
  }
}

export function validateScene(value) {
  const errors = []
  validateNode(SCENE_SCHEMA, value, '', errors)
  return { ok: errors.length === 0, errors }
}

export function validateComposition(value) {
  const errors = []
  validateNode(COMPOSITION_SCHEMA, value, '', errors)
  return { ok: errors.length === 0, errors }
}

// ------------------------------------------------------------------ coercion

const trim = (value, max) => String(value == null ? '' : value).trim().slice(0, max)

const ALIASES = {
  reference_type: {
    '电商': 'ecommerce', '电商主图': 'ecommerce', 'product': 'ecommerce', 'e-commerce': 'ecommerce',
    '服饰': 'apparel', '服装': 'apparel', 'clothing': 'apparel', 'fashion': 'apparel',
    '海报': 'marketing_poster', '营销海报': 'marketing_poster', 'poster': 'marketing_poster',
    '社媒': 'social_post', 'social': 'social_post', '创意海报': 'creative_poster', '其它': 'other', '其他': 'other',
  },
  'camera.angle': {
    'eye-level': 'eye_level', 'eyelevel': 'eye_level', '平视': 'eye_level', '正面': 'eye_level',
    'top-down': 'top_down', 'topdown': 'top_down', '俯拍': 'top_down', '俯视': 'top_down',
    'three-quarter': 'three_quarter', '三分之四侧': 'three_quarter', '四分之三': 'three_quarter',
    'low-angle': 'low_angle', 'lowangle': 'low_angle', '仰拍': 'low_angle', '低角度': 'low_angle',
  },
  'camera.expected_product_view': {
    '正面': 'front', 'front-view': 'front', '侧面': 'side', 'side-view': 'side',
    '背面': 'back', 'back-view': 'back', '俯视': 'top', 'top-view': 'top', '顶视': 'top',
    '45度': 'angle_45', '斜角': 'angle_45', 'angle-45': 'angle_45',
  },
  'lighting.direction': {
    'upper-left': 'top_left', 'top-left': 'top_left', '左上': 'top_left',
    'upper-right': 'top_right', 'top-right': 'top_right', '右上': 'top_right',
    '左侧': 'left', '右侧': 'right', '顶部': 'top', '上方': 'top',
    '正面': 'front', '背面': 'back', '逆光': 'back', '漫射光': 'diffuse', 'diffused': 'diffuse', '混合光': 'mixed',
  },
  'lighting.softness': { '硬光': 'hard', '柔光': 'soft', '漫射光': 'diffuse', 'diffused': 'diffuse' },
  'lighting.temperature': { '暖': 'warm', '暖色': 'warm', '冷': 'cool', '冷色': 'cool', '中性': 'neutral' },
  'support_surface.type': {
    'table': 'tabletop', 'desk': 'tabletop', '桌面': 'tabletop', '台面': 'tabletop',
    '地面': 'floor', '地板': 'floor', '展台': 'podium', 'pedestal': 'podium',
    '层架': 'shelf', '架子': 'shelf', '墙': 'wall', '墙面': 'wall', '背景墙': 'wall', 'backdrop': 'wall',
    '悬空': 'suspended', 'floating': 'suspended', '无': 'none',
  },
  'support_surface.orientation': { '水平': 'horizontal', '垂直': 'vertical' },
  'support_surface.contact_point_hint': {
    '底部居中': 'bottom_center', '左下': 'bottom_left', '右下': 'bottom_right', '居中': 'center',
    'bottom-center': 'bottom_center', 'bottom-left': 'bottom_left', 'bottom-right': 'bottom_right',
  },
  'placement.preferred_region': {
    '居中': 'center', '中央': 'center', '偏左': 'left', '偏右': 'right', '偏上': 'top', '上方': 'top',
    '偏下': 'bottom', '下方': 'bottom', '满版': 'full_bleed', 'full-bleed': 'full_bleed',
  },
  'placement.clearance': { '无遮挡': 'clear', '完整': 'clear', '部分遮挡': 'partial', '被遮挡': 'blocked' },
}

const ENUM_BY_PATH = {
  reference_type: REFERENCE_TYPES,
  'camera.angle': CAMERA_ANGLES,
  'camera.expected_product_view': PRODUCT_VIEWS,
  'lighting.direction': LIGHT_DIRECTIONS,
  'lighting.softness': LIGHT_SOFTNESS,
  'lighting.temperature': LIGHT_TEMPERATURE,
  'support_surface.type': SURFACE_TYPES,
  'support_surface.orientation': SURFACE_ORIENTATIONS,
  'support_surface.contact_point_hint': CONTACT_HINTS,
  'placement.preferred_region': REGIONS,
  'placement.clearance': CLEARANCE,
}

function pick(raw, key) {
  if (!raw || typeof raw !== 'object') return undefined
  if (raw[key] !== undefined) return raw[key]
  return raw[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]
}

function coerceEnum(path, value) {
  if (value === undefined || value === null) return 'unknown'
  const text = String(value).trim()
  if (!text) return 'unknown'
  const lower = text.toLowerCase().replace(/[\s_]+/g, '-')
  const flat = lower.replace(/-/g, '_')
  if (ENUM_BY_PATH[path].indexOf(flat) >= 0) return flat
  const table = ALIASES[path] || {}
  return table[text] || table[lower] || table[flat] || 'unknown'
}

const coerceConfidence = value => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
}

const asArray = value => {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

export function coerceHex(value) {
  const text = String(value == null ? '' : value).trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase()
  const short = /^#([0-9a-fA-F]{3})$/.exec(text)
  if (short) return `#${short[1].split('').map(c => c + c).join('')}`.toLowerCase()
  const bare = /^([0-9a-fA-F]{6})$/.exec(text)
  return bare ? `#${bare[1]}`.toLowerCase() : ''
}

export function defaultScene() {
  return {
    schema_version: '1.0',
    reference_type: 'unknown',
    camera: { angle: 'unknown', expected_product_view: 'unknown', confidence: 0 },
    lighting: { direction: 'unknown', softness: 'unknown', temperature: 'unknown', confidence: 0 },
    support_surface: { type: 'unknown', orientation: 'unknown', contact_point_hint: 'unknown' },
    placement: { preferred_region: 'unknown', clearance: 'unknown', needs_user_confirmation: true },
    scene_description: '',
    color_palette: [],
    style_tags: [],
    reference_texts: [],
    risks: [],
    analysis_notes: '',
  }
}

export function normalizeScene(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const camera = pick(source, 'camera') || {}
  const lighting = pick(source, 'lighting') || {}
  const surface = pick(source, 'support_surface') || {}
  const placement = pick(source, 'placement') || {}
  const palette = asArray(pick(source, 'color_palette') || pick(source, 'colors'))
  const tags = asArray(pick(source, 'style_tags') || pick(source, 'styles'))
  const texts = asArray(pick(source, 'reference_texts') || pick(source, 'texts'))
  const risks = asArray(pick(source, 'risks'))
  const confirmFlag = pick(placement, 'needs_user_confirmation')

  return {
    schema_version: trim(pick(source, 'schema_version') || '1.0', 10) || '1.0',
    reference_type: coerceEnum('reference_type', pick(source, 'reference_type') || pick(source, 'type')),
    camera: {
      angle: coerceEnum('camera.angle', pick(camera, 'angle') || pick(camera, 'camera_angle')),
      expected_product_view: coerceEnum(
        'camera.expected_product_view',
        pick(camera, 'expected_product_view') || pick(camera, 'product_view') || pick(camera, 'view'),
      ),
      confidence: coerceConfidence(pick(camera, 'confidence')),
    },
    lighting: {
      direction: coerceEnum('lighting.direction', pick(lighting, 'direction') || pick(lighting, 'light_direction')),
      softness: coerceEnum('lighting.softness', pick(lighting, 'softness')),
      temperature: coerceEnum('lighting.temperature', pick(lighting, 'temperature')),
      confidence: coerceConfidence(pick(lighting, 'confidence')),
    },
    support_surface: {
      type: coerceEnum('support_surface.type', pick(surface, 'type') || pick(surface, 'surface_type')),
      orientation: coerceEnum('support_surface.orientation', pick(surface, 'orientation')),
      contact_point_hint: coerceEnum(
        'support_surface.contact_point_hint',
        pick(surface, 'contact_point_hint') || pick(surface, 'contact_point'),
      ),
    },
    placement: {
      preferred_region: coerceEnum('placement.preferred_region', pick(placement, 'preferred_region') || pick(placement, 'region')),
      clearance: coerceEnum('placement.clearance', pick(placement, 'clearance')),
      needs_user_confirmation: typeof confirmFlag === 'boolean' ? confirmFlag : true,
    },
    scene_description: trim(pick(source, 'scene_description') || pick(source, 'description'), LIMITS.scene_description),
    color_palette: palette
      .map(item => {
        const hex = coerceHex(typeof item === 'string' ? item : pick(item, 'hex') || pick(item, 'color'))
        if (!hex) return null
        const name = trim(typeof item === 'string' ? '' : pick(item, 'name'), LIMITS.tag)
        return name ? { name, hex } : { hex }
      })
      .filter(Boolean)
      .slice(0, LIMITS.color_palette),
    style_tags: tags
      .map(item => trim(typeof item === 'string' ? item : pick(item, 'tag') || pick(item, 'name'), LIMITS.tag))
      .filter(Boolean)
      .slice(0, LIMITS.style_tags),
    reference_texts: texts
      .map(item => {
        const text = trim(typeof item === 'string' ? item : pick(item, 'text'), LIMITS.text)
        if (!text) return null
        const entry = { text }
        const language = trim(pick(item, 'language'), 20)
        const role = trim(pick(item, 'role'), LIMITS.tag)
        if (language) entry.language = language
        if (role) entry.role = role
        return entry
      })
      .filter(Boolean)
      .slice(0, LIMITS.reference_texts),
    risks: risks
      .map(item => trim(typeof item === 'string' ? item : pick(item, 'risk') || pick(item, 'text'), LIMITS.text))
      .filter(Boolean)
      .slice(0, LIMITS.risks),
    analysis_notes: trim(pick(source, 'analysis_notes') || pick(source, 'notes'), LIMITS.analysis_notes),
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)))
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

export function ratioPreset(width, height) {
  const ratio = Number(width) / Number(height)
  if (Math.abs(ratio - 1) < 0.01) return '1:1'
  if (Math.abs(ratio - 0.8) < 0.02) return '4:5'
  if (Math.abs(ratio - 0.75) < 0.02) return '3:4'
  if (Math.abs(ratio - 16 / 9) < 0.03) return '16:9'
  return `${width}:${height}`
}

export function defaultComposition(seed = {}) {
  const created = seed.created_at || new Date().toISOString()
  return {
    schema_version: '1.0',
    canvas: { width: 1024, height: 1024, preset: '1:1' },
    background: { asset_id: seed.background_asset_id || '', sha256: seed.background_sha256 || '' },
    product: {
      asset_id: seed.product_asset_id || '',
      mask_id: seed.mask_id || '',
      sha256: seed.product_sha256 || '',
      cx: 0.5,
      cy: 0.6,
      width_ratio: 0.42,
      rotation_deg: 0,
      opacity: 1,
      visible: true,
    },
    shadow: { enabled: true, offset_x: 0, offset_y: 1.5, blur: 4, opacity: 0.35, color: '#000000', contact: true },
    adjustments: { enabled: false, brightness: 0, warmth: 0 },
    text_layers: [],
    meta: { created_at: created, updated_at: created, params_version: '1.0' },
  }
}

export function normalizeComposition(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const canvas = pick(source, 'canvas') || {}
  const background = pick(source, 'background') || {}
  const product = pick(source, 'product') || {}
  const shadow = pick(source, 'shadow') || {}
  const adjustments = pick(source, 'adjustments') || {}
  const meta = pick(source, 'meta') || {}
  const base = defaultComposition()
  const width = Math.round(clamp(num(pick(canvas, 'width'), 1024), 256, 4096))
  const height = Math.round(clamp(num(pick(canvas, 'height'), 1024), 256, 4096))
  const seen = new Set()
  const layers = asArray(pick(source, 'text_layers')).slice(0, 12).map((layer, index) => {
    const item = layer && typeof layer === 'object' ? layer : {}
    let id = trim(pick(item, 'id'), 32).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `t${index + 1}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    const oneOf = (path, fallback) => {
      const value = String(pick(item, path.split('.').pop()))
      return COMPOSITION_ENUMS[path].indexOf(value) >= 0 ? value : fallback
    }
    const weight = Number(pick(item, 'font_weight'))
    return {
      id,
      template_id: oneOf('text_layers.template_id', 'title_sub_left'),
      text: trim(pick(item, 'text'), 200),
      font_family: oneOf('text_layers.font_family', 'system'),
      font_size: clamp(num(pick(item, 'font_size'), 0.062), 0.01, 0.3),
      font_weight: [400, 500, 600, 700, 800].indexOf(weight) >= 0 ? weight : 700,
      color: coerceHex(pick(item, 'color')) || '#111111',
      align: oneOf('text_layers.align', 'left'),
      x: clamp(num(pick(item, 'x'), 0.08), 0, 1),
      y: clamp(num(pick(item, 'y'), 0.08), 0, 1),
      width: clamp(num(pick(item, 'width'), 0.6), 0.05, 1),
      line_height: clamp(num(pick(item, 'line_height'), 1.25), 0.8, 3),
      letter_spacing: clamp(num(pick(item, 'letter_spacing'), 0), -0.05, 0.2),
      placement: oneOf('text_layers.placement', 'front'),
      visible: pick(item, 'visible') !== false,
    }
  })

  return {
    schema_version: '1.0',
    canvas: { width, height, preset: trim(pick(canvas, 'preset') || ratioPreset(width, height), 16) || '1:1' },
    background: {
      asset_id: trim(pick(background, 'asset_id'), 80),
      sha256: trim(pick(background, 'sha256'), 64),
      sha256_normalized: trim(pick(background, 'sha256_normalized'), 64),
    },
    product: {
      asset_id: trim(pick(product, 'asset_id'), 80),
      mask_id: trim(pick(product, 'mask_id'), 80),
      sha256: trim(pick(product, 'sha256'), 64),
      cx: clamp(num(pick(product, 'cx'), 0.5), 0, 1),
      cy: clamp(num(pick(product, 'cy'), 0.6), 0, 1),
      width_ratio: clamp(num(pick(product, 'width_ratio'), 0.42), 0.01, 1),
      rotation_deg: clamp(num(pick(product, 'rotation_deg'), 0), -180, 180),
      opacity: clamp(num(pick(product, 'opacity'), 1), 0, 1),
      visible: pick(product, 'visible') !== false,
    },
    shadow: {
      enabled: pick(shadow, 'enabled') !== false,
      offset_x: clamp(num(pick(shadow, 'offset_x'), base.shadow.offset_x), -20, 20),
      offset_y: clamp(num(pick(shadow, 'offset_y'), base.shadow.offset_y), -20, 20),
      blur: clamp(num(pick(shadow, 'blur'), base.shadow.blur), 0, 20),
      opacity: clamp(num(pick(shadow, 'opacity'), base.shadow.opacity), 0, 1),
      color: coerceHex(pick(shadow, 'color')) || '#000000',
      contact: pick(shadow, 'contact') !== false,
    },
    adjustments: {
      enabled: pick(adjustments, 'enabled') === true,
      brightness: clamp(num(pick(adjustments, 'brightness'), 0), -1, 1),
      warmth: clamp(num(pick(adjustments, 'warmth'), 0), -1, 1),
    },
    text_layers: layers,
    meta: {
      created_at: trim(pick(meta, 'created_at') || base.meta.created_at, 40),
      updated_at: trim(pick(meta, 'updated_at') || new Date().toISOString(), 40),
      params_version: trim(pick(meta, 'params_version') || '1.0', 16) || '1.0',
    },
  }
}

/** Paths the user must look at before the pipeline continues (文档 §3 ④). */
export function unconfirmedPaths(scene) {
  const value = scene || {}
  const paths = []
  const unknown = (at, v) => {
    if (v === undefined || v === 'unknown') paths.push(at)
  }
  unknown('camera.angle', value.camera && value.camera.angle)
  unknown('camera.expected_product_view', value.camera && value.camera.expected_product_view)
  unknown('lighting.direction', value.lighting && value.lighting.direction)
  unknown('support_surface.type', value.support_surface && value.support_surface.type)
  unknown('placement.preferred_region', value.placement && value.placement.preferred_region)
  if (value.placement && value.placement.needs_user_confirmation === true) paths.push('placement.needs_user_confirmation')
  return paths
}

function getPath(source, dotted) {
  return String(dotted).split('.').filter(Boolean)
    .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), source)
}

/** Applies the user's review on top of the model answer. The analysis file itself
 *  is never mutated, so the original answer stays auditable. */
export function mergeSceneReview(analysis, review) {
  const merged = normalizeScene(analysis)
  const patch = review && review.scene && typeof review.scene === 'object' ? review.scene : {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'color_palette' || key === 'style_tags' || key === 'reference_texts' || key === 'risks') {
      merged[key] = normalizeScene({ ...merged, [key]: value })[key]
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...(merged[key] || {}), ...value }
    } else {
      merged[key] = value
    }
  }
  const cleaned = normalizeScene(merged)
  const confirmed = review && review.confirmed && typeof review.confirmed === 'object' ? review.confirmed : {}
  return { scene: cleaned, missing: unconfirmedAfterReview(cleaned, confirmed) }
}

/** The review gate: every `unknown` must be replaced or explicitly confirmed. */
export function unconfirmedAfterReview(scene, confirmed) {
  const flags = confirmed && typeof confirmed === 'object' ? confirmed : {}
  return unconfirmedPaths(scene).filter(path => {
    if (path === 'placement.needs_user_confirmation') return flags[path] !== true
    const value = getPath(scene, path)
    if (value !== 'unknown' && value !== undefined) return false
    return flags[path] !== true
  })
}
