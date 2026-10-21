// 商品信息提取（商品描述词）：固定输出格式的解析、补全与提示词内置文本。
import {
  parseProductText, normalizeProductProfile, hasProductInfo, productSummary, productLines,
  PRODUCT_SCHEMA_VERSION, UNKNOWN_VALUE, CONFLICT_VALUE, MAX_SELLING_POINTS,
} from '../lib/product.js'
import { compileProductPrompt, PRODUCT_PROMPT_ZH, PRODUCT_PROMPT_VERSION } from '../lib/prompts.js'

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400))
  }
}

// ---------------------------------------------------------------- 固定格式
const CANONICAL = `**1. 商品名称：**
不锈钢保温杯 500ml

**2. 核心卖点：**
316 不锈钢内胆；24 小时保温；一键开盖

**3. 规格参数：**
- **（1）颜色：** 哑光黑
- **（2）外观：** 圆柱形直身杯体，磨砂表面，杯盖带环形凹槽
`
const canonical = parseProductText(CANONICAL)
check('parses the name', canonical.name === '不锈钢保温杯 500ml', canonical.name)
check('parses three selling points', canonical.selling_points.length === 3, canonical.selling_points)
check('parses the colour', canonical.color === '哑光黑', canonical.color)
check('parses the appearance', canonical.appearance.includes('圆柱形'), canonical.appearance)

// 标签与值写在同一行、没有加粗、使用半角括号
const INLINE = `1.商品名称: 折叠露营椅
2.核心卖点: 一秒展开; 承重 150kg
3.规格参数:
(1)颜色: 军绿色
(2)外观: 折叠骨架，牛津布座面`
const inline = parseProductText(INLINE)
check('inline labels are parsed', inline.name === '折叠露营椅' && inline.color === '军绿色', inline)
check('inline selling points are split', inline.selling_points.length === 2, inline.selling_points)
check('inline appearance is parsed', inline.appearance.includes('牛津布'), inline.appearance)

// 模型偶尔仍然回 JSON：也要能吃
const JSON_ANSWER = JSON.stringify({
  name: '玻璃咖啡壶',
  selling_points: ['耐热玻璃', '滤网可拆'],
  specs: { color: '透明', appearance: '细颈壶身 + 竹制手柄' },
})
const fromJson = parseProductText(JSON_ANSWER)
check('json answer is parsed', fromJson.name === '玻璃咖啡壶' && fromJson.color === '透明', fromJson)
check('json appearance is parsed', fromJson.appearance.includes('竹制'), fromJson.appearance)

// 空回答不能假装成功
check('empty answer yields no info', hasProductInfo(parseProductText('')) === false)
check('prose-only answer keeps a name', parseProductText('未提供').name === '')

// ------------------------------------------------------------- 规则约束
const MANY = `**1. 商品名称：**
蓝牙耳机
**2. 核心卖点：**
降噪；续航 30 小时；蓝牙 5.3；IPX5 防水；降噪
**3. 规格参数：**
- **（1）颜色：** 白
- **（2）外观：** 入耳式`
const many = parseProductText(MANY)
check('selling points capped', many.selling_points.length === MAX_SELLING_POINTS, many.selling_points)
check('duplicate selling points removed', new Set(many.selling_points).size === many.selling_points.length, many.selling_points)

const UNKNOWN = `**1. 商品名称：**
未提供
**2. 核心卖点：**
未提供
**3. 规格参数：**
- **（1）颜色：** 未提供
- **（2）外观：** 未提供`
const unknown = parseProductText(UNKNOWN)
check('unknown stays as 未提供', unknown.name === '' && unknown.color === '', unknown)
check('unknown profile has no info', hasProductInfo(normalizeProductProfile(unknown)) === false)
const filled = normalizeProductProfile(unknown)
check('normalized fields are always present', filled.name === UNKNOWN_VALUE && filled.color === UNKNOWN_VALUE && filled.appearance === UNKNOWN_VALUE, filled)
check('normalized schema version', filled.schema_version === PRODUCT_SCHEMA_VERSION, filled.schema_version)

const CONFLICT = `**1. 商品名称：**
信息冲突
**2. 核心卖点：**
加厚杯壁
**3. 规格参数：**
- **（1）颜色：** 信息冲突
- **（2）外观：** 直身杯型`
const conflict = normalizeProductProfile(parseProductText(CONFLICT))
check('conflict is flagged', conflict.notes.includes(CONFLICT_VALUE), conflict.notes)
check('conflict keeps other fields', conflict.appearance === '直身杯型', conflict.appearance)
check('conflict still counts as info', hasProductInfo(conflict) === true)

// --------------------------------------------------------------- 摘要与提示词
const summary = productSummary(canonical)
check('summary carries name and colour', summary.includes('不锈钢保温杯') && summary.includes('哑光黑'), summary)
check('summary is single line', !summary.includes('\n'), summary)
const summaryEn = productSummary(canonical, { lang: 'en' })
check('english summary', summaryEn.startsWith('product:') && summaryEn.includes('colour:'), summaryEn)
check('empty profile has no summary', productSummary(normalizeProductProfile({})) === '')

const lines = productLines(canonical)
check('lines cover the fixed order', lines.map(item => item.field).join(',') === 'name,selling_points,color,appearance', lines.map(item => item.field))
check('lines never blank', lines.every(item => item.value && item.value.trim()), lines)

const prompt = compileProductPrompt({ lang: 'zh' })
check('prompt carries the built-in text', prompt.system === PRODUCT_PROMPT_ZH, prompt.system.slice(0, 40))
check('built-in prompt keeps the field order', /1\. 商品名称[\s\S]*2\. 核心卖点[\s\S]*3\. 规格参数/.test(PRODUCT_PROMPT_ZH))
check('built-in prompt forbids extra fields', PRODUCT_PROMPT_ZH.includes('只能输出“商品名称、核心卖点、规格参数”三个部分'))
check('built-in prompt demands 未提供', PRODUCT_PROMPT_ZH.includes('统一填写“未提供”'))
check('built-in prompt demands 信息冲突', PRODUCT_PROMPT_ZH.includes('应填写“信息冲突”'))
check('built-in prompt caps points', PRODUCT_PROMPT_ZH.includes('最多提取3个核心卖点'))
check('prompt version', prompt.version === PRODUCT_PROMPT_VERSION, prompt.version)
check('prompt user message mentions the photo', prompt.user.includes('商品图片'), prompt.user)
const promptEn = compileProductPrompt({ lang: 'en' })
check('english prompt has its own text', promptEn.system !== PRODUCT_PROMPT_ZH && promptEn.system.includes('Product name'), promptEn.system.slice(0, 40))
const withExtra = compileProductPrompt({ lang: 'zh', extra: '  户外水杯  ' })
check('extra material is passed through', withExtra.user.includes('户外水杯'), withExtra.user)
check('extra material is trimmed', !withExtra.user.includes('  户外水杯  '), withExtra.user)

console.log(`PASS ${pass} / FAIL ${fail}`)
if (fail > 0) process.exit(1)
