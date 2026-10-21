/**
 * lib/compositor.js — authoritative pixel composition for export (文档 §4 / §7).
 *
 * The page canvas is only a preview: the exported file is produced here from the same
 * numbers, so preview and export cannot drift.  Geometry is planned once in composition
 * canvas pixels (`planComposition`) and then scaled uniformly to the output resolution.
 *
 * UNITS (identical rule in the Client preview — see docs/contracts.md §1.3):
 *   S = min(canvas.width, canvas.height)            // short edge
 *   pw = product.width_ratio * canvas.width         // product width before rotation
 *   ph = pw * productPixelHeight / productPixelWidth
 *   cx = product.cx * canvas.width, cy = product.cy * canvas.height
 *   fontPx = text.font_size * S,  lineHeight = fontPx * text.line_height
 *   shadow.dx = shadow.offset_x * S / 100           // offset_* are PERCENT of S (-20..20)
 *   shadow.dy = shadow.offset_y * S / 100
 *   shadow.radius = shadow.blur * S / 100           // blur is PERCENT of S, radius in px
 *
 * Why `/100` and not the plain `offset_x * S` / `blur * S / 2` still printed in
 * docs/contracts.md §1.3: the document's own defaults (`offset_y 14`, `blur 24`) are integer
 * percentages, and the plain formulas would yield 14 336 px / 12 288 px at 1024² — absurd.
 * Adopted rule: all three shadow numbers are percentages of the short edge.  Keep this in
 * sync with the Client preview.
 *
 * Pure module: no IO, no randomness, no console output, no timers.
 */

const DEG = Math.PI / 180;
/** 2x2 supersampling of the affine product transform — fixed, so output stays deterministic. */
const SUPERSAMPLE = 2;

/** @param {number} value @param {number} lo @param {number} hi @returns {number} */
function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/** @param {unknown} value @returns {number} */
function clamp01(value) {
  return clamp(num(value, 0), 0, 1);
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * `#rgb` / `#rrggbb` / `[r,g,b]` -> `[r,g,b]`.
 * @param {unknown} value
 * @param {number[]} fallback
 * @returns {number[]}
 */
function parseColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return [0, 1, 2].map(index => clamp(Math.round(num(value[index], fallback[index])), 0, 255));
  }
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return [0, 1, 2].map(index => parseInt(hex[index] + hex[index], 16));
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return [0, 1, 2].map(index => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    }
  }
  return fallback.slice();
}

/**
 * `#rgb` / `#rrggbb` / `[r,g,b]` -> `'#rrggbb'`.
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeHex(value, fallback) {
  if (typeof value === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
    const hex = value.trim().replace(/^#/, '').toLowerCase();
    const expanded = hex.length === 3 ? hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] : hex;
    return `#${expanded}`;
  }
  if (Array.isArray(value) && value.length >= 3) {
    return `#${parseColor(value, [0, 0, 0])
      .map(channel => channel.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return fallback;
}

/**
 * Pixel plan for a composition (contracts §1.3).  All lengths are pixels on the composition's
 * own canvas; `scale` is 1 and is multiplied by the exporter for the output resolution.
 *
 * Accepted product pixel size keys, in order: `pixel_width`/`pixel_height`,
 * `pixelWidth`/`pixelHeight`, `source_width`/`source_height`, `natural_width`/`natural_height`.
 * When absent the product is assumed square (`ph = pw`); `composeExport` always injects the
 * real decoded size.
 *
 * @param {object} composition Composition JSON (§1.2), optionally carrying the product size.
 * @returns {{
 *   canvas: {width:number,height:number},
 *   shortEdge: number,
 *   product: {cx:number,cy:number,pw:number,ph:number,rotation_deg:number,visible:boolean,
 *             opacity:number,source_width:number,source_height:number},
 *   shadow: {enabled:boolean,dx:number,dy:number,radius:number,opacity:number,
 *            color:number[],contact:boolean},
 *   text: Array<{id:string,fontPx:number,x:number,y:number,box:number,lineHeight:number,
 *                align:string,color:string,placement:string,visible:boolean}>,
 *   scale: number}}
 */
export function planComposition(composition) {
  const source = composition && typeof composition === 'object' ? composition : {};
  const canvas = source.canvas && typeof source.canvas === 'object' ? source.canvas : {};
  const width = Math.max(1, Math.round(num(canvas.width, 1024)));
  const height = Math.max(1, Math.round(num(canvas.height, 1024)));
  const S = Math.min(width, height);

  const product = source.product && typeof source.product === 'object' ? source.product : {};
  const widthRatio = clamp01(num(product.width_ratio, 0.42));
  const pw = widthRatio * width;
  const sourceWidth = Math.max(
    1,
    num(product.pixel_width ?? product.pixelWidth ?? product.source_width ?? product.natural_width, 1),
  );
  const sourceHeight = Math.max(
    1,
    num(product.pixel_height ?? product.pixelHeight ?? product.source_height ?? product.natural_height, 1),
  );
  const ph = (pw * sourceHeight) / sourceWidth;

  // A composition without a shadow block draws no shadow; when the block exists it is enabled
  // unless `enabled` is explicitly false (contracts §1.2 keeps the block in every composition).
  const hasShadowBlock = Boolean(source.shadow) && typeof source.shadow === 'object';
  const shadow = hasShadowBlock ? source.shadow : {};
  const textLayers = Array.isArray(source.text_layers) ? source.text_layers : [];

  return {
    canvas: { width, height },
    shortEdge: S,
    product: {
      cx: num(product.cx, 0.5) * width,
      cy: num(product.cy, 0.6) * height,
      pw,
      ph,
      rotation_deg: num(product.rotation_deg, 0),
      visible: product.visible !== false,
      opacity: clamp01(num(product.opacity, 1)),
      source_width: sourceWidth,
      source_height: sourceHeight,
    },
    shadow: {
      enabled: hasShadowBlock && shadow.enabled !== false,
      // offsets and blur are percentages of the short edge (see file header)
      dx: (num(shadow.offset_x, 0) * S) / 100,
      dy: (num(shadow.offset_y, 1.5) * S) / 100,
      radius: Math.max(0, (num(shadow.blur, 4) * S) / 100),
      opacity: clamp01(num(shadow.opacity, 0.35)),
      color: parseColor(shadow.color, [0, 0, 0]),
      contact: shadow.contact !== false,
    },
    text: textLayers.map(layer => {
      const entry = layer && typeof layer === 'object' ? layer : {};
      const fontPx = num(entry.font_size, 0.062) * S;
      return {
        id: String(entry.id ?? ''),
        fontPx,
        x: num(entry.x, 0.08) * width,
        y: num(entry.y, 0.08) * height,
        box: num(entry.width, 0.6) * width,
        lineHeight: fontPx * num(entry.line_height, 1.25),
        align: entry.align === 'center' || entry.align === 'right' ? entry.align : 'left',
        color: normalizeHex(entry.color, '#111111'),
        placement: entry.placement === 'behind' ? 'behind' : 'front',
        visible: entry.visible !== false,
      };
    }),
    scale: 1,
  };
}

// --------------------------------------------------------------------------- validation

/**
 * @param {unknown} image
 * @param {string} name
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
function assertImage(image, name) {
  if (!image || typeof image !== 'object') throw new Error(`compose-invalid: ${name} image is required`);
  const { width, height, data } = /** @type {any} */ (image);
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`compose-invalid: ${name} width must be a positive integer`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`compose-invalid: ${name} height must be a positive integer`);
  }
  if (!data || typeof data.length !== 'number') {
    throw new Error(`compose-invalid: ${name} data must be a Uint8ClampedArray of RGBA pixels`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(
      `compose-invalid: ${name} data length ${data.length} does not match ${width}x${height} RGBA`,
    );
  }
  return /** @type {any} */ (image);
}

// --------------------------------------------------------------------------- sampling

/**
 * Bilinear sample in premultiplied space (texture coordinates: texel centres at i + 0.5,
 * edges clamped).  Returns premultiplied RGB (0..255 scale, already multiplied by coverage)
 * plus alpha (0..255).
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {number} fx
 * @param {number} fy
 * @param {Float32Array} out length >= 4
 * @returns {void}
 */
function samplePremul(image, fx, fy, out) {
  const { width, height, data } = image;
  const baseX = Math.floor(fx - 0.5);
  const baseY = Math.floor(fy - 0.5);
  const tx = fx - 0.5 - baseX;
  const ty = fy - 0.5 - baseY;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 2; j += 1) {
    const yy = clamp(baseY + j, 0, height - 1);
    const wy = j === 0 ? 1 - ty : ty;
    if (wy === 0) continue;
    for (let i = 0; i < 2; i += 1) {
      const xx = clamp(baseX + i, 0, width - 1);
      const wx = i === 0 ? 1 - tx : tx;
      const weight = wx * wy;
      if (weight === 0) continue;
      const p = (yy * width + xx) * 4;
      const alpha = data[p + 3];
      if (alpha === 0) continue;
      const factor = (alpha / 255) * weight;
      r += data[p] * factor;
      g += data[p + 1] * factor;
      b += data[p + 2] * factor;
      a += alpha * weight;
    }
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
}

/** @type {Float32Array} sRGB -> linear lookup, filled once at module load. */
const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

/**
 * @param {number} value linear 0..1
 * @returns {number} sRGB 0..1
 */
function linearToSrgb(value) {
  const c = clamp(value, 0, 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Brightness (additive in linear light, -1..1) and warmth (R up / B down, -1..1) on product RGB only.
 * @param {number} r 0..255
 * @param {number} g
 * @param {number} b
 * @param {object} adjustments
 * @returns {number[]}
 */
function adjustColor(r, g, b, adjustments) {
  const brightness = clamp(num(adjustments.brightness, 0), -1, 1);
  const warmth = clamp(num(adjustments.warmth, 0), -1, 1);
  const lr = SRGB_TO_LINEAR[clamp(Math.round(r), 0, 255)] + brightness + warmth * 0.08;
  const lg = SRGB_TO_LINEAR[clamp(Math.round(g), 0, 255)] + brightness + warmth * 0.02;
  const lb = SRGB_TO_LINEAR[clamp(Math.round(b), 0, 255)] + brightness - warmth * 0.08;
  return [linearToSrgb(lr) * 255, linearToSrgb(lg) * 255, linearToSrgb(lb) * 255];
}

/**
 * Source-over with straight alpha.
 * @param {Uint8ClampedArray} dst
 * @param {number} index
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} alpha 0..1
 * @returns {void}
 */
function blendOver(dst, index, r, g, b, alpha) {
  if (alpha <= 0) return;
  const dstAlpha = dst[index + 3] / 255;
  const outAlpha = alpha + dstAlpha * (1 - alpha);
  if (outAlpha <= 0) {
    dst[index] = 0;
    dst[index + 1] = 0;
    dst[index + 2] = 0;
    dst[index + 3] = 0;
    return;
  }
  const inv = dstAlpha * (1 - alpha);
  dst[index] = (r * alpha + dst[index] * inv) / outAlpha;
  dst[index + 1] = (g * alpha + dst[index + 1] * inv) / outAlpha;
  dst[index + 2] = (b * alpha + dst[index + 2] * inv) / outAlpha;
  dst[index + 3] = outAlpha * 255;
}

// --------------------------------------------------------------------------- shadows

/**
 * One separable box-blur pass (edges clamped) — two of these approximate a Gaussian.
 * @param {Float32Array} src
 * @param {number} width
 * @param {number} height
 * @param {number} radius integer >= 1
 * @returns {Float32Array}
 */
function boxBlur(src, width, height, radius) {
  const r = Math.max(1, Math.round(radius));
  const window = 2 * r + 1;
  const horizontal = new Float32Array(src.length);
  const output = new Float32Array(src.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[row + clamp(x, 0, width - 1)];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = sum / window;
      sum += src[row + clamp(x + r + 1, 0, width - 1)] - src[row + clamp(x - r, 0, width - 1)];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x];
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = sum / window;
      sum +=
        horizontal[clamp(y + r + 1, 0, height - 1) * width + x] -
        horizontal[clamp(y - r, 0, height - 1) * width + x];
    }
  }
  return output;
}

/**
 * Two box-blur passes of `radius` (Gaussian approximation).  `radius < 0.5` returns a copy.
 * @param {Float32Array} src
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 * @returns {Float32Array}
 */
function blurTwice(src, width, height, radius) {
  if (!(radius >= 0.5)) return src.slice();
  return boxBlur(boxBlur(src, width, height, radius), width, height, radius);
}

/**
 * Bilinear sample of a coverage buffer; outside the canvas is fully transparent.
 * @param {Float32Array} buffer
 * @param {number} width
 * @param {number} height
 * @param {number} fx
 * @param {number} fy
 * @returns {number}
 */
function sampleCoverage(buffer, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < -1 || y0 < -1 || x0 > width - 1 || y0 > height - 1) return 0;
  const tx = fx - x0;
  const ty = fy - y0;
  let total = 0;
  for (let j = 0; j < 2; j += 1) {
    const yy = y0 + j;
    if (yy < 0 || yy >= height) continue;
    const wy = j === 0 ? 1 - ty : ty;
    if (wy === 0) continue;
    for (let i = 0; i < 2; i += 1) {
      const xx = x0 + i;
      if (xx < 0 || xx >= width) continue;
      const wx = i === 0 ? 1 - tx : tx;
      if (wx === 0) continue;
      total += buffer[yy * width + xx] * wx * wy;
    }
  }
  return total;
}

/**
 * Draw one blurred, tinted, offset copy of the product coverage onto `dst`.
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {Float32Array} blurred coverage buffer (0..1)
 * @param {{dx:number,dy:number,color:number[],opacity:number}} options
 * @returns {void}
 */
function drawShadowPass(dst, width, height, blurred, options) {
  const { dx, dy, color, opacity } = options;
  if (!(opacity > 0)) return;
  const [r, g, b] = color;
  for (let y = 0; y < height; y += 1) {
    const sy = y + 0.5 - dy;
    if (sy < -1 || sy > height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = x + 0.5 - dx;
      if (sx < -1 || sx > width) continue;
      const alpha = sampleCoverage(blurred, width, height, sx, sy) * opacity;
      if (alpha <= 0.002) continue;
      blendOver(dst, (y * width + x) * 4, r, g, b, Math.min(1, alpha));
    }
  }
}

/**
 * Draw the product shadow (contracts §3: "接触阴影 + 投影").
 *
 * `coverage` is a per-pixel product coverage buffer (mask alpha × source alpha, 0..1) already
 * transformed into output space.  Two layers are drawn, both *under* the product:
 *   - main shadow: blur radius `radius`, offset (dx, dy), opacity `opacity`;
 *   - contact shadow (when `contact`): radius `radius * 0.25`, offset `(dx * 0.35, dy * 0.35)`,
 *     opacity `min(1, opacity * 1.6)`.
 *
 * @param {Uint8ClampedArray} dst RGBA canvas, mutated in place
 * @param {Float32Array|Uint8ClampedArray} coverage per-pixel coverage 0..1
 * @param {{width:number,height:number,shadow:object,opacity?:number,scale?:number}} options
 *   `shadow` is `planComposition().shadow`; `scale` converts its pixel units to the output
 *   resolution; `opacity` is the product opacity multiplier.
 * @returns {Uint8ClampedArray} dst
 */
export function applyShadow(dst, coverage, options) {
  const width = Math.max(1, Math.round(num(options && options.width, 1)));
  const height = Math.max(1, Math.round(num(options && options.height, 1)));
  const shadow = (options && options.shadow) || {};
  if (shadow.enabled === false) return dst;
  const opacity = clamp01(num(options && options.opacity, 1));
  if (opacity <= 0) return dst;
  const scale = num(options && options.scale, 1);
  if (!coverage || coverage.length < width * height) {
    throw new Error('compose-invalid: shadow coverage buffer does not match the canvas');
  }
  const color = parseColor(shadow.color, [0, 0, 0]);
  const dx = num(shadow.dx, 0) * scale;
  const dy = num(shadow.dy, 0) * scale;
  const radius = Math.max(0, num(shadow.radius, 0) * scale);
  const baseOpacity = clamp01(num(shadow.opacity, 0.35)) * opacity;

  const source = Float32Array.from(coverage);
  drawShadowPass(dst, width, height, blurTwice(source, width, height, radius), {
    dx,
    dy,
    color,
    opacity: baseOpacity,
  });

  if (shadow.contact !== false) {
    drawShadowPass(dst, width, height, blurTwice(source, width, height, radius * 0.25), {
      dx: dx * 0.35,
      dy: dy * 0.35,
      color,
      opacity: Math.min(1, baseOpacity * 1.6),
    });
  }
  return dst;
}

// --------------------------------------------------------------------------- composition

/**
 * Cover-fit (`object-fit: cover`): scale until both axes are covered, then centre-crop.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @param {number} width output width
 * @param {number} height output height
 * @returns {{width:number,height:number,data:Uint8ClampedArray}} new image exactly width×height
 */
export function fitCover(image, width, height) {
  const src = assertImage(image, 'background');
  const outWidth = Math.max(1, Math.round(num(width, 0)));
  const outHeight = Math.max(1, Math.round(num(height, 0)));
  if (!Number.isInteger(outWidth) || !Number.isInteger(outHeight)) {
    throw new Error('compose-invalid: fitCover output size must be positive integers');
  }
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const scale = Math.max(outWidth / src.width, outHeight / src.height);
  const offsetX = (outWidth - src.width * scale) / 2;
  const offsetY = (outHeight - src.height * scale) / 2;
  const pixel = new Float32Array(4);
  for (let y = 0; y < outHeight; y += 1) {
    const fy = (y + 0.5 - offsetY) / scale;
    for (let x = 0; x < outWidth; x += 1) {
      const fx = (x + 0.5 - offsetX) / scale;
      samplePremul(src, fx, fy, pixel);
      const alpha = pixel[3];
      if (alpha <= 0) continue;
      const p = (y * outWidth + x) * 4;
      const straight = 255 / alpha;
      out[p] = pixel[0] * straight;
      out[p + 1] = pixel[1] * straight;
      out[p + 2] = pixel[2] * straight;
      out[p + 3] = alpha;
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

/**
 * Scale an overlay to the full output size and source-over it.
 * @param {Uint8ClampedArray} dst
 * @param {number} width
 * @param {number} height
 * @param {{width:number,height:number,data:Uint8ClampedArray}} image
 * @returns {void}
 */
function drawOverlay(dst, width, height, image) {
  const pixel = new Float32Array(4);
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const fy = (y + 0.5) * scaleY;
    for (let x = 0; x < width; x += 1) {
      samplePremul(image, (x + 0.5) * scaleX, fy, pixel);
      const alpha = pixel[3];
      if (alpha <= 0) continue;
      const straight = 255 / alpha;
      blendOver(dst, (y * width + x) * 4, pixel[0] * straight, pixel[1] * straight, pixel[2] * straight, alpha / 255);
    }
  }
}

/**
 * Rasterise the product with its mask through the inverse affine transform.
 *
 * Rotation happens about (cx, cy); sampling is bilinear in premultiplied space (so rotated
 * edges never pick up dark fringes) with 2x2 supersampling for anti-aliasing.
 *
 * @param {{width:number,height:number,data:Uint8ClampedArray}} product
 * @param {{width:number,height:number,data:Uint8ClampedArray}|null} mask
 * @param {ReturnType<typeof planComposition>} plan
 * @param {number} width output width
 * @param {number} height output height
 * @param {number} kx output x scale
 * @param {number} ky output y scale
 * @param {object|null} adjustments
 * @param {number} opacity
 * @returns {{layer:Uint8ClampedArray,coverage:Float32Array}}
 */
function rasterizeProduct(product, mask, plan, width, height, kx, ky, adjustments, opacity) {
  const layer = new Uint8ClampedArray(width * height * 4);
  const coverage = new Float32Array(width * height);
  const pw = plan.product.pw * kx;
  const ph = plan.product.ph * ky;
  if (!(pw > 0) || !(ph > 0) || !(opacity > 0)) return { layer, coverage };

  const cx = plan.product.cx * kx;
  const cy = plan.product.cy * ky;
  const radians = plan.product.rotation_deg * DEG;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const halfW = pw / 2;
  const halfH = ph / 2;

  // Bounding box of the rotated quad, padded by one pixel for antialiased edges.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lx, ly] of [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]]) {
    const x = cx + lx * cos - ly * sin;
    const y = cy + lx * sin + ly * cos;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const x1 = Math.min(width - 1, Math.ceil(maxX) + 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const y1 = Math.min(height - 1, Math.ceil(maxY) + 1);

  const sample = new Float32Array(4);
  const maskSample = new Float32Array(4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const useAdjustments = Boolean(adjustments && adjustments.enabled === true);

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      let sumAlpha = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;

      for (let subY = 0; subY < SUPERSAMPLE; subY += 1) {
        const py = y + (subY + 0.5) / SUPERSAMPLE;
        const dy = py - cy;
        for (let subX = 0; subX < SUPERSAMPLE; subX += 1) {
          const px = x + (subX + 0.5) / SUPERSAMPLE;
          const dx = px - cx;
          const localX = dx * cos + dy * sin;
          const localY = -dx * sin + dy * cos;
          const u = (localX + halfW) / pw;
          const v = (localY + halfH) / ph;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;

          samplePremul(product, u * product.width, v * product.height, sample);
          if (sample[3] <= 0) continue;
          let alpha = sample[3];
          let r = sample[0];
          let g = sample[1];
          let b = sample[2];
          if (mask) {
            samplePremul(mask, u * mask.width, v * mask.height, maskSample);
            const maskAlpha = maskSample[3] / 255;
            if (maskAlpha <= 0) continue;
            alpha *= maskAlpha;
            r *= maskAlpha;
            g *= maskAlpha;
            b *= maskAlpha;
          }
          sumAlpha += alpha;
          sumR += r;
          sumG += g;
          sumB += b;
        }
      }

      if (sumAlpha <= 0) continue;
      const index = y * width + x;
      const cover = sumAlpha / (255 * samples);
      coverage[index] = cover;
      const straight = 255 / sumAlpha;
      let r = sumR * straight;
      let g = sumG * straight;
      let b = sumB * straight;
      if (useAdjustments) [r, g, b] = adjustColor(r, g, b, adjustments);
      const p = index * 4;
      layer[p] = r;
      layer[p + 1] = g;
      layer[p + 2] = b;
      layer[p + 3] = cover * opacity * 255;
    }
  }

  return { layer, coverage };
}

/**
 * Compose an export (contracts §3).
 *
 * Order: background (cover-fit to `output`) → `overlayBehind` (scaled bilinearly from its own
 * size) → product shadow → product (bilinear affine, rotation about `(cx, cy)`, mask alpha as
 * product alpha, RGB from the product image, `adjustments` applied only when enabled) →
 * `overlayFront`.  Invisible layers are skipped; `product.visible === false` removes both the
 * product and its shadow.
 *
 * @param {object} options
 * @param {object} options.composition Compose JSON (§1.2)
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [options.background] RGBA;
 *   omitted → opaque white canvas
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [options.product] RGBA product
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [options.mask] RGBA (or A-only)
 *   mask, white = product; may differ in size from the product (sampled by normalized UV)
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [options.overlayBehind]
 * @param {{width:number,height:number,data:Uint8ClampedArray}} [options.overlayFront]
 * @param {{width:number,height:number}|number} [options.output] defaults to the canvas size
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 * @throws {Error} `compose-invalid: <reason>`
 */
export function composeExport(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const composition = opts.composition;
  if (!composition || typeof composition !== 'object') {
    throw new Error('compose-invalid: composition is required');
  }

  const product = opts.product ? assertImage(opts.product, 'product') : null;
  const mask = opts.mask ? assertImage(opts.mask, 'mask') : null;
  const background = opts.background ? assertImage(opts.background, 'background') : null;
  const overlayBehind = opts.overlayBehind ? assertImage(opts.overlayBehind, 'overlayBehind') : null;
  const overlayFront = opts.overlayFront ? assertImage(opts.overlayFront, 'overlayFront') : null;

  // The decoded product size is authoritative for the aspect ratio (§1.3: ph from pixels).
  const plan = planComposition({
    ...composition,
    product: {
      ...(composition.product && typeof composition.product === 'object' ? composition.product : {}),
      ...(product ? { source_width: product.width, source_height: product.height } : {}),
    },
  });

  const outWidth = Math.max(1, Math.round(num(opts.output && typeof opts.output === 'object' ? opts.output.width : opts.output, plan.canvas.width)));
  const outHeight = Math.max(
    1,
    Math.round(
      num(opts.output && typeof opts.output === 'object' ? opts.output.height : opts.output, plan.canvas.height),
    ),
  );
  const kx = outWidth / plan.canvas.width;
  const ky = outHeight / plan.canvas.height;

  const dst = new Uint8ClampedArray(outWidth * outHeight * 4);
  if (background) {
    dst.set(fitCover(background, outWidth, outHeight).data);
  } else {
    for (let p = 0; p < dst.length; p += 4) {
      dst[p] = 255;
      dst[p + 1] = 255;
      dst[p + 2] = 255;
      dst[p + 3] = 255;
    }
  }

  if (overlayBehind) drawOverlay(dst, outWidth, outHeight, overlayBehind);

  const drawProduct = Boolean(product) && plan.product.visible && plan.product.opacity > 0 && plan.product.pw > 0;
  if (drawProduct) {
    const adjustments = composition.adjustments && typeof composition.adjustments === 'object'
      ? composition.adjustments
      : null;
    const { layer, coverage } = rasterizeProduct(
      product,
      mask,
      plan,
      outWidth,
      outHeight,
      kx,
      ky,
      adjustments,
      plan.product.opacity,
    );
    if (plan.shadow.enabled && plan.shadow.opacity > 0) {
      applyShadow(dst, coverage, {
        width: outWidth,
        height: outHeight,
        shadow: plan.shadow,
        opacity: plan.product.opacity,
        scale: kx,
      });
    }
    for (let p = 0; p < dst.length; p += 4) {
      const alpha = layer[p + 3] / 255;
      if (alpha <= 0) continue;
      blendOver(dst, p, layer[p], layer[p + 1], layer[p + 2], alpha);
    }
  }

  if (overlayFront) drawOverlay(dst, outWidth, outHeight, overlayFront);

  return { width: outWidth, height: outHeight, data: dst };
}
