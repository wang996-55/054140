/**
 * 视角兼容检查（文档 §2 步骤 4）。
 *
 * A mismatch never blocks silently: it returns a warning the page must show, and
 * the user can only continue after an explicit `confirm_continue`, which is
 * recorded on the task.
 */

const VIEW_LABEL = {
  front: '正面',
  side: '侧面',
  back: '背面',
  top: '俯视',
  angle_45: '45° 斜角',
  unknown: '未确认',
}

const ANGLE_LABEL = {
  eye_level: '平视',
  top_down: '俯拍',
  three_quarter: '三分之四侧',
  low_angle: '仰拍',
  unknown: '未确认',
}

/**
 * @param {object} options
 * @param {object} options.scene        reviewed scene
 * @param {string} options.productView  the view the product photo shows
 * @param {object} [options.form]       submitted form
 * @param {object} [options.cutout]     cutout record
 * @returns {{ level: 'ok'|'warn'|'block', issues: Array<{code:string,zh:string,severity:string}> }}
 */
export function checkCompatibility({ scene, productView, form, cutout } = {}) {
  const issues = []
  const camera = (scene && scene.camera) || {}
  const placement = (scene && scene.placement) || {}
  const surface = (scene && scene.support_surface) || {}
  const expected = camera.expected_product_view || 'unknown'
  const declared = productView || (form && form.product_view) || 'unknown'

  if (expected === 'unknown' || declared === 'unknown') {
    issues.push({
      code: 'view-unknown',
      severity: 'warn',
      zh: `视角信息不完整（参考图要求 ${VIEW_LABEL[expected]}，商品图标注 ${VIEW_LABEL[declared]}），需要人工确认后再继续。`,
    })
  } else if (expected !== declared) {
    issues.push({
      code: 'view-mismatch',
      severity: 'warn',
      zh: `视角不匹配：参考图主体是${VIEW_LABEL[expected]}，你的商品图是${VIEW_LABEL[declared]}。合成后可能出现商品角度与背景透视不一致，请确认是否继续。`,
    })
  }

  if (placement.clearance === 'blocked') {
    issues.push({
      code: 'placement-blocked',
      severity: 'warn',
      zh: '参考图中商品所在区域被其它元素遮挡，背景生成可能无法留出干净空间。',
    })
  }

  if (surface.type === 'suspended' && cutout && cutout.mode && cutout.mode !== 'none') {
    issues.push({
      code: 'surface-suspended',
      severity: 'info',
      zh: '参考图是悬空构图，本工具的接触阴影为近似效果，请在合成后人工检查落地感。',
    })
  }

  if (camera.angle === 'top_down' && declared === 'front') {
    issues.push({
      code: 'angle-topdown-front',
      severity: 'warn',
      zh: '参考图是俯拍，但商品图是正面视角：俯拍背景通常会露出商品顶部，正面图无法覆盖。',
    })
  }

  if (form && form.reference_type === 'apparel' && form.product_kind === 'non_apparel') {
    issues.push({
      code: 'type-mismatch',
      severity: 'warn',
      zh: '参考图是服饰穿搭场景，但商品不是服饰类，合成结果可能不自然。',
    })
  }

  const level = issues.some(issue => issue.severity === 'warn') ? 'warn' : 'ok'
  return { level, issues }
}
