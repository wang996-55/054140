import { normalizeScene, validateScene, defaultScene, normalizeComposition, validateComposition, mergeSceneReview, unconfirmedPaths } from '../lib/schema.js'

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) {
    pass += 1
  } else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const s = normalizeScene({
  reference_type: '电商',
  camera: { angle: 'top-down', view: '正面', confidence: 1.4 },
  lighting: { direction: '左上', softness: '柔光', temperature: 'warm' },
  support_surface: { type: '桌面' },
  placement: { region: '居中' },
  scene_description: 'desc',
})
check('normalized scene validates', validateScene(s).ok, validateScene(s).errors)
check('alias reference_type', s.reference_type === 'ecommerce', s.reference_type)
check('alias angle', s.camera.angle === 'top_down', s.camera.angle)
check('alias product view', s.camera.expected_product_view === 'front', s.camera.expected_product_view)
check('confidence clamped', s.camera.confidence === 1, s.camera.confidence)
check('alias lighting', s.lighting.direction === 'top_left' && s.lighting.softness === 'soft', s.lighting)
check('alias surface', s.support_surface.type === 'tabletop', s.support_surface)
check('alias region', s.placement.preferred_region === 'center', s.placement)
check('default scene valid', validateScene(defaultScene()).ok, validateScene(defaultScene()).errors)
check('unknowns listed', unconfirmedPaths(s).includes('camera.angle') === false && unconfirmedPaths(s).includes('placement.needs_user_confirmation') === true, unconfirmedPaths(s))

const bad = { ...defaultScene(), camera: { angle: 'eye_level', expected_product_view: 'front', confidence: 2 } }
check('confidence 2 rejected', validateScene(bad).ok === false, validateScene(bad).errors)

const missing = { ...defaultScene() }
delete missing.camera
check('missing camera rejected', validateScene(missing).ok === false)

const extra = { ...defaultScene(), bogus: 1 }
check('extra key rejected', validateScene(extra).ok === false)

const long = normalizeScene({ scene_description: 'x'.repeat(5000) })
check('description truncated', long.scene_description.length === 600, long.scene_description.length)

const c = normalizeComposition({
  canvas: { width: 900, height: 1200 },
  text_layers: [{ text: 'hi', id: 'T1', template_id: 'bogus', font_size: 5, color: 'red' }, { text: 'again', id: 't1' }],
})
const cv = validateComposition(c)
check('composition valid', cv.ok, cv.errors)
check('layer id sanitized', c.text_layers[0].id === 't1', c.text_layers[0].id)
check('duplicate id fixed', c.text_layers[1].id !== 't1', c.text_layers[1].id)
check('font size clamped', c.text_layers[0].font_size === 0.3, c.text_layers[0].font_size)
check('bad template replaced', c.text_layers[0].template_id === 'title_sub_left', c.text_layers[0].template_id)
check('bad color replaced', c.text_layers[0].color === '#111111', c.text_layers[0].color)
check('preset derived', c.canvas.preset === '3:4', c.canvas.preset)
check('shadow default blur', c.shadow.blur === 4, c.shadow.blur)

const merged = mergeSceneReview(s, {
  scene: { camera: { angle: 'eye_level' } },
  confirmed: { 'placement.needs_user_confirmation': true },
})
check('review merged', merged.scene.camera.angle === 'eye_level', merged.scene.camera.angle)
check('review keeps other fields', merged.scene.lighting.direction === 'top_left')
check('review missing empty', merged.missing.length === 0, merged.missing)

const unconfirmed = mergeSceneReview(s, { scene: {}, confirmed: {} })
check('unconfirmed without flags', unconfirmed.missing.length === 1, unconfirmed.missing)

const defaults = normalizeComposition(null)
check('null composition normalized', validateComposition(defaults).ok, validateComposition(defaults).errors)

console.log(`PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
