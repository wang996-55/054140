/**
 * Prompt compilation (文档 §5). Prompts are built from the *reviewed* scene, never
 * from the raw model answer, and every compiled prompt carries its version and a
 * hash so a cached background can never be mistaken for a different prompt.
 */
import { createHash } from 'node:crypto'

export const SCENE_PROMPT_VERSION = '1'
export const BACKGROUND_PROMPT_VERSION = '1'

const SCENE_SYSTEM_ZH = `你是电商视觉分析助手。只输出 JSON，不要输出解释、Markdown 或代码块围栏。
JSON 必须符合以下结构，枚举值必须使用给定英文取值：
{
  "schema_version": "1.0",
  "reference_type": "ecommerce|apparel|marketing_poster|social_post|creative_poster|other|unknown",
  "camera": { "angle": "eye_level|top_down|three_quarter|low_angle|unknown",
               "expected_product_view": "front|side|back|top|angle_45|unknown",
               "confidence": 0-1 },
  "lighting": { "direction": "top_left|top_right|left|right|top|front|back|diffuse|mixed|unknown",
                 "softness": "hard|soft|diffuse|unknown",
                 "temperature": "warm|neutral|cool|unknown",
                 "confidence": 0-1 },
  "support_surface": { "type": "tabletop|floor|podium|shelf|wall|suspended|none|unknown",
                        "orientation": "horizontal|vertical|unknown",
                        "contact_point_hint": "bottom_center|bottom_left|bottom_right|center|unknown" },
  "placement": { "preferred_region": "center|left|right|top|bottom|full_bleed|unknown",
                  "clearance": "clear|partial|blocked|unknown",
                  "needs_user_confirmation": true },
  "scene_description": "不超过 200 字的中文描述",
  "color_palette": [ { "name": "主色", "hex": "#RRGGBB" } ],
  "style_tags": ["风格词"],
  "reference_texts": [ { "text": "参考图上的文字", "language": "zh", "role": "headline" } ],
  "risks": ["可能影响复刻的风险"]
}
无法确定时填 "unknown"，绝不猜测。confidence 表示你自己的把握，不作为准确率。`

const SCENE_SYSTEM_EN = `You are an e-commerce visual analyst. Reply with JSON only - no prose, no Markdown, no code fences.
The JSON must follow exactly this structure and only these enum values:
{
  "schema_version": "1.0",
  "reference_type": "ecommerce|apparel|marketing_poster|social_post|creative_poster|other|unknown",
  "camera": { "angle": "eye_level|top_down|three_quarter|low_angle|unknown",
               "expected_product_view": "front|side|back|top|angle_45|unknown",
               "confidence": 0-1 },
  "lighting": { "direction": "top_left|top_right|left|right|top|front|back|diffuse|mixed|unknown",
                 "softness": "hard|soft|diffuse|unknown",
                 "temperature": "warm|neutral|cool|unknown",
                 "confidence": 0-1 },
  "support_surface": { "type": "tabletop|floor|podium|shelf|wall|suspended|none|unknown",
                        "orientation": "horizontal|vertical|unknown",
                        "contact_point_hint": "bottom_center|bottom_left|bottom_right|center|unknown" },
  "placement": { "preferred_region": "center|left|right|top|bottom|full_bleed|unknown",
                  "clearance": "clear|partial|blocked|unknown",
                  "needs_user_confirmation": true },
  "scene_description": "at most 200 characters, English",
  "color_palette": [ { "name": "primary", "hex": "#RRGGBB" } ],
  "style_tags": ["style words"],
  "reference_texts": [ { "text": "text seen in the reference", "language": "en", "role": "headline" } ],
  "risks": ["risks that could hurt replication"]
}
Use "unknown" whenever you are not sure; never guess.`

export function compileScenePrompt({ lang = 'zh', form = {} } = {}) {
  const english = String(lang).toLowerCase().startsWith('en')
  const requirement = String(form.user_requirement || '').trim()
  const lines = []
  if (english) {
    lines.push('Analyse the attached reference image and describe the scene so it can be rebuilt WITHOUT the product.')
    lines.push(`Reference type hint from the user: ${form.reference_type || 'unknown'}.`)
    lines.push(`Replication mode: ${form.mode === 'high_fidelity' ? 'high fidelity' : 'style reference'}.`)
    if (requirement) lines.push(`User requirements (do not translate): ${requirement}`)
    lines.push('Focus on camera angle, expected product view, light direction, support surface and the free space reserved for the product.')
  } else {
    lines.push('请分析随附的参考图，用结构化 JSON 描述场景，目标是重建一张“不含商品”的背景。')
    lines.push(`用户给定的类型：${form.reference_type || 'unknown'}。`)
    lines.push(`复刻模式：${form.mode === 'high_fidelity' ? '高度复刻' : '参考风格'}。`)
    if (requirement) lines.push(`用户统一要求（原样保留，不要翻译）：${requirement}`)
    lines.push('重点判断：机位角度、商品应呈现的视角、光源方向、承载面类型、以及预留给商品的空白区域。')
  }
  return {
    system: english ? SCENE_SYSTEM_EN : SCENE_SYSTEM_ZH,
    user: lines.join('\n'),
    version: SCENE_PROMPT_VERSION,
  }
}

const ANGLE_ZH = {
  eye_level: '平视机位，镜头与商品中部同高',
  top_down: '俯拍机位，镜头垂直向下',
  three_quarter: '三分之四侧机位，略带透视',
  low_angle: '低角度仰拍机位',
  unknown: '常规平视机位',
}

const VIEW_ZH = {
  front: '正面视角',
  side: '侧面视角',
  back: '背面视角',
  top: '俯视视角',
  angle_45: '45° 斜角视角',
  unknown: '正面视角',
}

const LIGHT_ZH = {
  top_left: '左上方主光',
  top_right: '右上方主光',
  left: '左侧主光',
  right: '右侧主光',
  top: '正上方顶光',
  front: '正面顺光',
  back: '背后逆光',
  diffuse: '均匀漫射光',
  mixed: '柔和混合光',
  unknown: '柔和顶侧光',
}

const SOFT_ZH = { hard: '硬朗的明暗对比', soft: '柔和的过渡', diffuse: '几乎没有硬阴影', unknown: '柔和的过渡' }
const TEMP_ZH = { warm: '偏暖色温', neutral: '中性色温', cool: '偏冷色温', unknown: '中性色温' }

const SURFACE_ZH = {
  tabletop: '桌面/台面作为承载面',
  floor: '地面作为承载面',
  podium: '独立展台作为承载面',
  shelf: '层架作为承载面',
  wall: '垂直墙面作为背景',
  suspended: '商品悬空、无接触面',
  none: '无承载面',
  unknown: '简洁台面作为承载面',
}

const REGION_ZH = {
  center: '画面中央',
  left: '画面左侧',
  right: '画面右侧',
  top: '画面上方',
  bottom: '画面下方',
  full_bleed: '整版区域',
  unknown: '画面中央',
}

const ANGLE_EN = {
  eye_level: 'eye-level camera, at mid-product height',
  top_down: 'top-down camera, looking straight down',
  three_quarter: 'three-quarter camera with slight perspective',
  low_angle: 'low-angle camera looking slightly up',
  unknown: 'standard eye-level camera',
}
const VIEW_EN = {
  front: 'front view', side: 'side view', back: 'back view', top: 'top view',
  angle_45: '45-degree three-quarter view', unknown: 'front view',
}
const LIGHT_EN = {
  top_left: 'key light from the upper left', top_right: 'key light from the upper right',
  left: 'key light from the left', right: 'key light from the right', top: 'top light',
  front: 'frontal key light', back: 'back light with rim highlight', diffuse: 'even diffused light',
  mixed: 'soft mixed light', unknown: 'soft top-side light',
}
const SOFT_EN = { hard: 'crisp contrast', soft: 'soft falloff', diffuse: 'almost no hard shadow', unknown: 'soft falloff' }
const TEMP_EN = { warm: 'warm colour temperature', neutral: 'neutral colour temperature', cool: 'cool colour temperature', unknown: 'neutral colour temperature' }
const SURFACE_EN = {
  tabletop: 'a clean tabletop as the support surface', floor: 'the floor as the support surface',
  podium: 'a standalone podium as the support surface', shelf: 'a shelf as the support surface',
  wall: 'a vertical wall as the background', suspended: 'a floating product with no contact surface',
  none: 'no support surface', unknown: 'a clean tabletop as the support surface',
}
const REGION_EN = {
  center: 'the centre of the frame', left: 'the left side of the frame', right: 'the right side of the frame',
  top: 'the upper area of the frame', bottom: 'the lower area of the frame', full_bleed: 'the full frame',
  unknown: 'the centre of the frame',
}

function pickLabel(table, value, fallback) {
  return table[value] || table[fallback] || ''
}

/** 文档 §2 原则：背景提示词必须包含 {角度, 光源, 承载面, 预留区域, 禁止项}. */
export function compileBackgroundPrompt({ lang = 'zh', scene = {}, form = {} } = {}) {
  const english = String(lang).toLowerCase().startsWith('en')
  const camera = scene.camera || {}
  const lighting = scene.lighting || {}
  const surface = scene.support_surface || {}
  const placement = scene.placement || {}
  const palette = Array.isArray(scene.color_palette)
    ? scene.color_palette.map(item => item && item.hex).filter(Boolean).slice(0, 4)
    : []
  const tags = Array.isArray(scene.style_tags) ? scene.style_tags.filter(Boolean).slice(0, 6) : []
  const requirement = String(form.user_requirement || '').trim()
  const aesthetic = String(form.fidelity || '') === '' ? '' : form.fidelity

  if (english) {
    const parts = {
      angle: `Camera: ${pickLabel(ANGLE_EN, camera.angle, 'unknown')}, composed for a ${pickLabel(VIEW_EN, camera.expected_product_view, 'front')} product.`,
      light: `Lighting: ${pickLabel(LIGHT_EN, lighting.direction, 'unknown')}, ${pickLabel(SOFT_EN, lighting.softness, 'unknown')}, ${pickLabel(TEMP_EN, lighting.temperature, 'unknown')}.`,
      surface: `Support surface: ${pickLabel(SURFACE_EN, surface.type, 'unknown')}.`,
      reserve: `Reserved space: keep ${pickLabel(REGION_EN, placement.preferred_region, 'unknown')} empty and unobstructed, with clean empty space where the product will be placed.`,
      ban: 'Do not include any product, any person, any logo, any text, any watermark, any price tag or any packaging in the image.',
    }
    const text = [
      'Create a photographic e-commerce background plate. It must be usable as the backdrop of a product photo.',
      parts.angle,
      parts.light,
      parts.surface,
      parts.reserve,
      parts.ban,
      tags.length ? `Style: ${tags.join(', ')}.` : '',
      palette.length ? `Colour palette: ${palette.join(', ')}.` : '',
      aesthetic ? `Fidelity level: ${aesthetic}.` : '',
      requirement ? `Additional requirement (verbatim): ${requirement}` : '',
      'Output: one clean still image, no people, no props that look like merchandise.',
    ].filter(Boolean).join('\n')
    return { text, version: BACKGROUND_PROMPT_VERSION, hash: promptFingerprint(text, BACKGROUND_PROMPT_VERSION), parts }
  }

  const parts = {
    angle: `机位：${pickLabel(ANGLE_ZH, camera.angle, 'unknown')}，按${pickLabel(VIEW_ZH, camera.expected_product_view, 'front')}构图。`,
    light: `光线：${pickLabel(LIGHT_ZH, lighting.direction, 'unknown')}，${pickLabel(SOFT_ZH, lighting.softness, 'unknown')}，${pickLabel(TEMP_ZH, lighting.temperature, 'unknown')}。`,
    surface: `承载面：${pickLabel(SURFACE_ZH, surface.type, 'unknown')}。`,
    reserve: `预留区域：${pickLabel(REGION_ZH, placement.preferred_region, 'unknown')}留出干净、无遮挡的空白，用于后续放置真实商品。`,
    ban: '画面禁止出现：任何商品、人物、Logo、文字、水印、价格牌、包装。',
  }
  const text = [
    '生成一张电商实拍风格的“无商品背景板”，用于后期合成真实商品。',
    parts.angle,
    parts.light,
    parts.surface,
    parts.reserve,
    parts.ban,
    tags.length ? `风格：${tags.join('、')}。` : '',
    palette.length ? `配色倾向：${palette.join('、')}。` : '',
    aesthetic ? `复刻程度：${aesthetic}。` : '',
    requirement ? `补充要求（原样保留）：${requirement}` : '',
    '输出：一张干净静物图，不要出现任何商品或疑似商品的道具。',
  ].filter(Boolean).join('\n')
  return { text, version: BACKGROUND_PROMPT_VERSION, hash: promptFingerprint(text, BACKGROUND_PROMPT_VERSION), parts }
}

export function promptFingerprint(text, version) {
  return createHash('sha256').update(`${version}\n${text}`, 'utf8').digest('hex').slice(0, 32)
}
