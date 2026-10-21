import { decodePng, encodePng } from '../lib/png.js'
import { composeExport, fitCover, planComposition } from '../lib/compositor.js'

let pass = 0
let fail = 0
const check = (name, condition, extra) => {
  if (condition) pass += 1
  else {
    fail += 1
    console.log(`FAIL ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
}

const solid = (width, height, rgba) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = rgba[0]
    data[index + 1] = rgba[1]
    data[index + 2] = rgba[2]
    data[index + 3] = rgba[3]
  }
  return { width, height, data }
}

// ---- PNG round trip
const patch = {
  width: 3,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128,
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255,
  ]),
}
const encoded = encodePng(patch)
const decoded = decodePng(encoded)
check('png size', decoded.width === 3 && decoded.height === 2, { w: decoded.width, h: decoded.height })
check('png pixels', patch.data.every((value, index) => Math.abs(decoded.data[index] - value) <= 0), Array.from(decoded.data))
check('png magic', encoded.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
let threw = false
try {
  decodePng(Buffer.from('not a png'))
} catch {
  threw = true
}
check('garbage rejected', threw)

// ---- plan geometry
const composition = {
  canvas: { width: 1024, height: 1024, preset: '1:1' },
  background: { asset_id: 'bg', sha256: '' },
  product: {
    asset_id: 'p', sha256: '', cx: 0.5, cy: 0.5, width_ratio: 0.5, rotation_deg: 0, opacity: 1, visible: true,
    source_width: 400, source_height: 800,
  },
  shadow: { enabled: false, offset_x: 0, offset_y: 1.5, blur: 4, opacity: 0.35, color: '#000000', contact: true },
  adjustments: { enabled: false, brightness: 0, warmth: 0 },
  text_layers: [],
  meta: { created_at: 'x', updated_at: 'x', params_version: '1.0' },
}
const plan = planComposition(composition)
check('plan pw', plan.product.pw === 512, plan.product.pw)
check('plan ph', plan.product.ph === 1024, plan.product.ph)
check('plan center', plan.product.cx === 512 && plan.product.cy === 512, { cx: plan.product.cx, cy: plan.product.cy })
check('plan shadow radius', Math.abs(plan.shadow.radius - 40.96) < 1e-6, plan.shadow.radius)
check('plan shadow dy', Math.abs(plan.shadow.dy - 15.36) < 1e-6, plan.shadow.dy)

// ---- compose at 200x200
const background = solid(200, 200, [255, 255, 255, 255])
const product = solid(40, 40, [255, 0, 0, 255])
const mask = solid(40, 40, [255, 255, 255, 255])
const small = {
  ...composition,
  canvas: { width: 200, height: 200, preset: '1:1' },
  product: { ...composition.product, width_ratio: 0.2, source_width: 40, source_height: 40 },
}
const result = composeExport({
  composition: small,
  background,
  product,
  mask,
  output: { width: 200, height: 200 },
})
const at = (image, x, y) => {
  const index = (y * image.width + x) * 4
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]]
}
check('center is red', at(result, 100, 100)[0] === 255 && at(result, 100, 100)[1] === 0, at(result, 100, 100))
check('corner stays white', at(result, 5, 5)[0] === 255 && at(result, 5, 5)[1] === 255, at(result, 5, 5))
check('product edge white', at(result, 75, 100)[1] === 255, at(result, 75, 100))

// ---- 1024 output geometry (bounding box within 2 px of the analytic affine transform)
const output1024 = composeExport({
  composition: small,
  background: solid(200, 200, [255, 255, 255, 255]),
  product,
  mask,
  output: { width: 1024, height: 1024 },
})
let minX = 1024
let maxX = -1
let minY = 1024
let maxY = -1
for (let y = 0; y < 1024; y += 1) {
  for (let x = 0; x < 1024; x += 1) {
    const pixel = at(output1024, x, y)
    if (pixel[0] > 200 && pixel[1] < 60) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}
// width_ratio 0.2 of 1024 = 204.8 px wide, square source => 204.8 tall, centred.
const expectedMin = Math.round(512 - 102.4)
const expectedMax = Math.round(512 + 102.4)
check('bbox x min within 2px', Math.abs(minX - expectedMin) <= 2, { minX, expectedMin })
check('bbox x max within 2px', Math.abs(maxX - expectedMax) <= 2, { maxX, expectedMax })
check('bbox y min within 2px', Math.abs(minY - expectedMin) <= 2, { minY, expectedMin })
check('bbox y max within 2px', Math.abs(maxY - expectedMax) <= 2, { maxY, expectedMax })

// ---- shadow darkens just below the product, not far away
const shadowed = composeExport({
  composition: { ...small, shadow: { ...small.shadow, enabled: true, offset_y: 6, blur: 3, opacity: 0.6 } },
  background,
  product,
  mask,
  output: { width: 200, height: 200 },
})
const below = at(shadowed, 100, 132)
const far = at(shadowed, 100, 20)
check('shadow darkens below', below[0] < 250 && below[1] < 250, below)
check('shadow does not reach far', far[0] > 250, far)

// ---- adjustments
const brighter = composeExport({
  composition: { ...small, adjustments: { enabled: true, brightness: 0.2, warmth: 0 } },
  background,
  product: solid(40, 40, [100, 100, 100, 255]),
  mask,
  output: { width: 200, height: 200 },
})
check('brightness applied', at(brighter, 100, 100)[0] > 140, at(brighter, 100, 100))
const neutral = composeExport({
  composition: { ...small, adjustments: { enabled: false, brightness: 0.2, warmth: 0 } },
  background,
  product: solid(40, 40, [100, 100, 100, 255]),
  mask,
  output: { width: 200, height: 200 },
})
check('brightness off ignored', Math.abs(at(neutral, 100, 100)[0] - 100) <= 1, at(neutral, 100, 100))

// ---- cover fit
const wide = fitCover(solid(400, 100, [0, 0, 255, 255]), 200, 200)
check('cover fills canvas', wide.width === 200 && wide.height === 200)
check('cover crops centre', at(wide, 100, 5)[2] === 255, at(wide, 100, 5))

console.log(`PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
