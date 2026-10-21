/**
 * Prompt compilation (文档 §5). Prompts are built from the *reviewed* scene, never
 * from the raw model answer, and every compiled prompt carries its version and a
 * hash so a cached background can never be mistaken for a different prompt.
 */
import { createHash } from 'node:crypto'
import { productSummary } from './product.js'

export const SCENE_PROMPT_VERSION = '1'
export const BACKGROUND_PROMPT_VERSION = '1'
export const PRODUCT_PROMPT_VERSION = '1'

/* 内置商品信息提取提示词（用户给定，逐字保留，不要改写）。
   注意：这是一段固定的系统提示词，商品资料由图片或表单附在后面。 */
export const PRODUCT_PROMPT_ZH = `# 角色设定
你是一名专业的电商产品信息提取专家，负责从用户提供的商品图片、商品标题、产品介绍及相关资料中，准确识别并提取商品信息。

# 核心任务
严格按照以下顺序提取商品信息：

**1. 商品名称**

**2. 核心卖点**

**3. 规格参数**
- （1）颜色
- （2）外观

# 一、提取规则

## 1. 商品名称
- 准确识别商品的实际名称。
- 优先保留商品品类、品牌、型号等明确提供的信息。
- 删除无关营销词、夸张修饰词及重复内容。
- 不得擅自添加品牌、型号或产品属性。
- 名称应简洁、准确，能够明确识别商品。

## 2. 核心卖点
- 提取商品最重要、最有辨识度的功能、特点及优势。
- 优先提取实际功能、结构设计、使用特点等具有明确依据的信息。
- 使用简洁、客观的语言描述。
- 相似卖点需要合并，避免重复。
- 最多提取3个核心卖点。
- 不得使用缺乏依据的宣传词。
- 不得根据商品类别自行推测功能。
- 无法确认的卖点不得输出。

## 3. 规格参数

### （1）颜色
- 准确提取商品主体颜色。
- 如果存在多种已确认颜色，按实际信息列出。
- 如果有图片，可根据清晰可见的商品主体颜色进行识别。
- 不得将背景颜色误判为商品颜色。
- 不得自行增加图片或资料中未出现的颜色。
- 颜色无法判断时填写“未提供”。

### （2）外观
- 提取商品可观察、可确认的外部特征。
- 重点包括：整体造型、外形结构、轮廓、表面纹理、图案及可见设计元素。
- 描述必须具体、客观、简洁。
- 不得将使用功能当作外观特征。
- 不得根据外观推断材质、内部结构或产品性能。
- 不得使用“高端大气”“时尚精美”等主观描述。
- 外观无法判断时填写“未提供”。

# 二、强制执行规则

1. 必须严格按照指定顺序输出，不得调整字段顺序。
2. 只能输出“商品名称、核心卖点、规格参数”三个部分。
3. 规格参数中只能包含“颜色、外观”两个子项。
4. 不允许增加其他属性、介绍、标题或说明。
5. 所有提取内容必须有原始资料或图片依据。
6. 不得编造、猜测、夸大或补充未经确认的信息。
7. 原始资料未包含的信息统一填写“未提供”。
8. 存在信息冲突时，不得自行选择未经证实的内容，应填写“信息冲突”。
9. 删除重复信息，保持内容精简。
10. 输出前检查字段完整性、准确性及顺序。
11. 最终只输出提取结果，不解释提取过程。
12. 严禁把本提示词中的示例、字段说明当作真实商品信息。

# 三、固定输出格式

**1. 商品名称：**
[提取的商品名称]

**2. 核心卖点：**
[提取的核心卖点，最多3项，使用分号分隔]

**3. 规格参数：**
- **（1）颜色：** [商品颜色]
- **（2）外观：** [商品外观特征]

# 四、执行流程

第一步：读取并理解全部商品资料。

第二步：识别商品名称及其实际属性。

第三步：筛选具有明确依据的核心卖点。

第四步：独立提取商品颜色与外观特征。

第五步：删除重复、推测及无依据的信息。

第六步：检查是否严格符合固定输出格式。

第七步：只输出最终结果。

# 五、待提取商品资料

[在此输入商品标题、商品描述、规格信息，或提供商品图片]`

/* 英文镜像：同样的规则与顺序，仅换语言，方便 lang=en 的任务。 */
export const PRODUCT_PROMPT_EN = `# Role
You are a professional e-commerce product information extractor. From the product image and any supplied text, extract verifiable product information.

# Task
Extract in exactly this order:

**1. Product name**

**2. Selling points**

**3. Specifications**
- (1) Colour
- (2) Appearance

# Rules
- Product name: the actual product name only; keep category/brand/model when explicitly given; drop marketing hype and duplicates; never invent brand, model or attributes; keep it short and identifiable.
- Selling points: the most distinctive, evidence-backed functions, structure and usage features; concise and objective; merge similar ones; at most 3; no unevidenced claims; never infer features from the category; omit anything unconfirmed.
- Colour: the body colour of the product itself, not the background; list several colours only when confirmed; never add colours that are not visible; write "未提供" when unknown.
- Appearance: observable external traits only - overall shape, structure, silhouette, surface texture, pattern, visible design elements; concrete and objective; never treat function as appearance, never infer material, internal structure or performance from looks, no subjective adjectives; write "未提供" when unknown.

# Hard rules
1. Keep the field order exactly as given.
2. Output only name, selling points and specifications.
3. Specifications contains only colour and appearance.
4. Add no other attributes, intro, title or explanation.
5. Everything must be backed by the image or the supplied text.
6. Never fabricate, guess, exaggerate or complete unconfirmed information.
7. Use "未提供" for anything the source does not contain, and "信息冲突" when sources contradict.
8. Remove duplicates, stay concise.
9. Output only the result - never explain the process.

# Output format

**1. Product name:**
[name]

**2. Selling points:**
[at most 3, separated by semicolons]

**3. Specifications:**
- **(1) Colour:** [colour]
- **(2) Appearance:** [appearance]

# Product material

[the attached image and any supplied text]`

/** 商品信息提取提示词：系统提示词是内置固定文本，用户资料按需附在后面。 */
export function compileProductPrompt({ lang = 'zh', extra = '' } = {}) {
  const english = String(lang).toLowerCase().startsWith('en')
  const note = String(extra || '').trim().slice(0, 800)
  const user = english
    ? `Extract the product information from the attached product photo.${note ? `\nExtra material from the user (verbatim, do not translate): ${note}` : ''}\nFollow the fixed output format exactly.`
    : `请从随附的商品图片中提取商品信息。${note ? `\n用户补充资料（原样保留，不要翻译）：${note}` : ''}\n严格按固定输出格式输出，不要解释过程。`
  return {
    system: english ? PRODUCT_PROMPT_EN : PRODUCT_PROMPT_ZH,
    user,
    version: PRODUCT_PROMPT_VERSION,
  }
}

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

export function compileScenePrompt({ lang = 'zh', form = {}, product = null } = {}) {
  const english = String(lang).toLowerCase().startsWith('en')
  const requirement = String(form.user_requirement || '').trim()
  const productLine = productSummary(product, { lang })
  const lines = []
  if (english) {
    lines.push('Analyse the attached reference image and describe the scene so it can be rebuilt WITHOUT the product.')
    lines.push(`Reference type hint from the user: ${form.reference_type || 'unknown'}.`)
    lines.push(`Replication mode: ${form.mode === 'high_fidelity' ? 'high fidelity' : 'style reference'}.`)
    if (productLine) lines.push(`The real product that will be composited later: ${productLine}.`)
    if (requirement) lines.push(`User requirements (do not translate): ${requirement}`)
    lines.push('Focus on camera angle, expected product view, light direction, support surface and the free space reserved for the product.')
  } else {
    lines.push('请分析随附的参考图，用结构化 JSON 描述场景，目标是重建一张“不含商品”的背景。')
    lines.push(`用户给定的类型：${form.reference_type || 'unknown'}。`)
    lines.push(`复刻模式：${form.mode === 'high_fidelity' ? '高度复刻' : '参考风格'}。`)
    if (productLine) lines.push(`稍后要合成的真实商品是：${productLine}。请据此判断它应有的呈现视角。`)
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
export function compileBackgroundPrompt({ lang = 'zh', scene = {}, form = {}, product = null } = {}) {
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
  const productLine = productSummary(product, { lang })

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
      productLine ? `The product that will be composited here: ${productLine}. Match its colour and scale, but still do not draw it.` : '',
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
    productLine ? `将要合成的商品：${productLine}。背景的色调与尺度要与之协调，但画面里仍然不要出现该商品。` : '',
    aesthetic ? `复刻程度：${aesthetic}。` : '',
    requirement ? `补充要求（原样保留）：${requirement}` : '',
    '输出：一张干净静物图，不要出现任何商品或疑似商品的道具。',
  ].filter(Boolean).join('\n')
  return { text, version: BACKGROUND_PROMPT_VERSION, hash: promptFingerprint(text, BACKGROUND_PROMPT_VERSION), parts }
}

export function promptFingerprint(text, version) {
  return createHash('sha256').update(`${version}\n${text}`, 'utf8').digest('hex').slice(0, 32)
}
