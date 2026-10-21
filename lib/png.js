/**
 * lib/png.js — pure PNG decode / encode for the AI 爆款图复刻 plugin.
 *
 * Contract: docs/contracts.md §3 "lib/png.js".
 *   export function decodePng(buffer)  -> { width, height, data: Uint8ClampedArray }   (RGBA)
 *   export function encodePng(image)   -> Buffer                                        (RGBA, 8 bit, non-interlaced)
 *
 * Scope and resolved ambiguities
 * ------------------------------
 * 1. Supported: bit depth 8 for every colour type (0 gray, 2 RGB, 3 palette, 4 gray+alpha,
 *    6 RGBA).  Sub-byte depths (1/2/4) are additionally accepted for gray (0) and palette (3)
 *    and expanded to 8 bit, because real uploads often carry them.  Anything else fails with
 *    the contract error text: `png-unsupported: bit depth 16` / `png-unsupported: interlaced`.
 * 2. Chunk CRCs are *not* verified on decode (interop with encoders that write a zeroed CRC).
 *    Structure is verified instead: signature, chunk framing, exact inflated scanline length,
 *    PLTE presence and palette index range, IHDR constraints, IEND presence.  Truncated or
 *    corrupt streams therefore always throw `Error('png-invalid: <reason>')`.
 * 3. Unknown *critical* chunks throw; ancillary chunks (bit 5 of the first type byte) are ignored.
 * 4. The encoder writes exactly one IDAT and uses filter type 0 (None) on every row, so the
 *    output is byte-for-byte deterministic for a given input (and zlib version).
 *
 * Pure module: no IO, no randomness, no console output, no timers.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 1_000_000;
const MAX_PIXELS = 400_000_000;

const CHANNELS_BY_COLOR_TYPE = Object.freeze({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 });
const DEPTHS_BY_COLOR_TYPE = Object.freeze({
  0: Object.freeze([1, 2, 4, 8]),
  2: Object.freeze([8]),
  3: Object.freeze([1, 2, 4, 8]),
  4: Object.freeze([8]),
  6: Object.freeze([8]),
});

/**
 * @param {string} reason
 * @returns {Error}
 */
function invalid(reason) {
  return new Error(`png-invalid: ${reason}`);
}

/**
 * @param {string} reason
 * @returns {Error}
 */
function unsupported(reason) {
  return new Error(`png-unsupported: ${reason}`);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * CRC32 as used by PNG (ISO 3309).
 * @param {Uint8Array} bytes
 * @param {number} [start]
 * @param {number} [end]
 * @returns {number} unsigned 32 bit
 */
function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {unknown} input
 * @returns {Uint8Array}
 */
function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw invalid('input is not a byte buffer');
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function readUint32(bytes, offset) {
  return (((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} length
 * @returns {string}
 */
function readAscii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/**
 * Ancillary chunk types have bit 5 of the first byte set.
 * @param {string} type
 * @returns {boolean}
 */
function isAncillary(type) {
  return type.length === 4 && (type.charCodeAt(0) & 0x20) !== 0;
}

/**
 * @param {Uint8Array} data 13 IHDR payload bytes
 * @returns {{width:number,height:number,bitDepth:number,colorType:number,channels:number}}
 */
function parseIhdr(data) {
  if (data.length !== 13) throw invalid('bad IHDR length');
  const width = readUint32(data, 0);
  const height = readUint32(data, 4);
  const bitDepth = data[8];
  const colorType = data[9];
  const compression = data[10];
  const filterMethod = data[11];
  const interlace = data[12];

  if (width === 0 || height === 0) throw invalid('zero image dimension');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw invalid('image dimension too large');
  if (width * height > MAX_PIXELS) throw invalid('image too large');
  if (compression !== 0) throw invalid(`bad compression method ${compression}`);
  if (filterMethod !== 0) throw invalid(`bad filter method ${filterMethod}`);
  if (bitDepth === 16) throw unsupported('bit depth 16');
  if (interlace === 1) throw unsupported('interlaced');
  if (interlace !== 0) throw invalid(`bad interlace method ${interlace}`);

  const depths = DEPTHS_BY_COLOR_TYPE[colorType];
  if (!depths) throw unsupported(`color type ${colorType}`);
  if (depths.indexOf(bitDepth) < 0) throw unsupported(`bit depth ${bitDepth}`);
  return { width, height, bitDepth, colorType, channels: CHANNELS_BY_COLOR_TYPE[colorType] };
}

/**
 * Reverse PNG scanline filtering (filter types 0..4).
 * @param {Uint8Array} data inflated scanline stream, length === height * (1 + rowBytes)
 * @param {number} rowBytes bytes per unfiltered row
 * @param {number} height
 * @param {number} bpp bytes per complete pixel, at least 1
 * @returns {Uint8Array} concatenated unfiltered rows
 */
function unfilter(data, rowBytes, height, bpp) {
  const out = new Uint8Array(rowBytes * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = data[pos];
    pos += 1;
    const rowStart = y * rowBytes;
    const prevStart = rowStart - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = data[pos + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let value;
      switch (filterType) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = raw + predictor;
          break;
        }
        default:
          throw invalid(`bad filter type ${filterType} on row ${y}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    pos += rowBytes;
  }
  return out;
}

/**
 * Expand packed sub-byte samples to one sample per pixel.
 * @param {Uint8Array} raw
 * @param {number} count number of pixels
 * @param {number} bitDepth 1, 2 or 4
 * @returns {Uint8Array}
 */
function unpackSubByte(raw, count, bitDepth) {
  const out = new Uint8Array(count);
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let i = 0; i < count; i += 1) {
    const byte = raw[Math.floor(i / perByte)];
    const slot = i % perByte;
    const shift = 8 - bitDepth * (slot + 1);
    out[i] = (byte >> shift) & mask;
  }
  return out;
}

/**
 * Convert unfiltered rows to 8-bit RGBA.
 * @param {Uint8Array} raw
 * @param {{width:number,height:number,bitDepth:number,colorType:number,channels:number}} info
 * @param {Uint8Array|null} palette PLTE payload
 * @param {null|{kind:string,value?:number,r?:number,g?:number,b?:number,bytes?:Uint8Array}} transparency
 * @returns {Uint8ClampedArray}
 */
function expandToRgba(raw, info, palette, transparency) {
  const { width, height, bitDepth, colorType, channels } = info;
  const count = width * height;
  const out = new Uint8ClampedArray(count * 4);

  if (colorType === 3) {
    if (!palette) throw invalid('missing PLTE for palette image');
    const entries = palette.length / 3;
    const alphaBytes = transparency && transparency.kind === 'palette' ? transparency.bytes : null;
    const samples = bitDepth === 8 ? raw : unpackSubByte(raw, count, bitDepth);
    for (let i = 0; i < count; i += 1) {
      const index = samples[i];
      if (index >= entries) throw invalid(`palette index ${index} out of range`);
      const p = i * 4;
      out[p] = palette[index * 3];
      out[p + 1] = palette[index * 3 + 1];
      out[p + 2] = palette[index * 3 + 2];
      out[p + 3] = alphaBytes && index < alphaBytes.length ? alphaBytes[index] : 255;
    }
    return out;
  }

  if (colorType === 0) {
    const samples = bitDepth === 8 ? raw : unpackSubByte(raw, count, bitDepth);
    const max = (1 << bitDepth) - 1;
    const scale = 255 / max;
    const trns = transparency && transparency.kind === 'gray' ? transparency.value & max : -1;
    for (let i = 0; i < count; i += 1) {
      const sample = samples[i];
      const gray = bitDepth === 8 ? sample : Math.round(sample * scale);
      const p = i * 4;
      out[p] = gray;
      out[p + 1] = gray;
      out[p + 2] = gray;
      out[p + 3] = sample === trns ? 0 : 255;
    }
    return out;
  }

  const rTrns = transparency && transparency.kind === 'rgb' ? transparency.r : -1;
  const gTrns = transparency && transparency.kind === 'rgb' ? transparency.g : -1;
  const bTrns = transparency && transparency.kind === 'rgb' ? transparency.b : -1;
  for (let i = 0; i < count; i += 1) {
    const s = i * channels;
    const p = i * 4;
    if (colorType === 2) {
      const r = raw[s];
      const g = raw[s + 1];
      const b = raw[s + 2];
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = r === rTrns && g === gTrns && b === bTrns ? 0 : 255;
    } else if (colorType === 4) {
      const gray = raw[s];
      out[p] = gray;
      out[p + 1] = gray;
      out[p + 2] = gray;
      out[p + 3] = raw[s + 1];
    } else {
      out[p] = raw[s];
      out[p + 1] = raw[s + 1];
      out[p + 2] = raw[s + 2];
      out[p + 3] = raw[s + 3];
    }
  }
  return out;
}

/**
 * Decode a PNG byte stream into 8-bit RGBA.
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 * @throws {Error} `png-invalid: <reason>` for malformed or truncated streams,
 *   `png-unsupported: bit depth 16` / `png-unsupported: interlaced` /
 *   `png-unsupported: color type N` for streams outside the supported subset.
 */
export function decodePng(buffer) {
  const bytes = asBytes(buffer);
  if (bytes.length < SIGNATURE.length) throw invalid('truncated signature');
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw invalid('bad signature');
  }

  /** @type {null | {width:number,height:number,bitDepth:number,colorType:number,channels:number}} */
  let header = null;
  /** @type {Uint8Array|null} */
  let palette = null;
  /** @type {null|{kind:string,value?:number,r?:number,g?:number,b?:number,bytes?:Uint8Array}} */
  let transparency = null;
  /** @type {Uint8Array[]} */
  const idat = [];
  let sawEnd = false;
  let offset = SIGNATURE.length;

  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = readAscii(bytes, offset + 4, 4);
    if (length > 0x7fffffff) throw invalid(`chunk length out of range in ${type}`);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw invalid(`truncated ${type} chunk`);
    const data = bytes.subarray(dataStart, dataEnd);

    if (!header && type !== 'IHDR') throw invalid('missing IHDR');

    if (type === 'IHDR') {
      if (header) throw invalid('duplicate IHDR');
      header = parseIhdr(data);
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw invalid('bad PLTE length');
      palette = data;
    } else if (type === 'tRNS') {
      if (length === 0) throw invalid('empty tRNS chunk');
      if (header.colorType === 3) {
        transparency = { kind: 'palette', bytes: data };
      } else if (header.colorType === 0) {
        if (length !== 2) throw invalid('bad tRNS length for grayscale');
        transparency = { kind: 'gray', value: (data[0] << 8) | data[1] };
      } else if (header.colorType === 2) {
        if (length !== 6) throw invalid('bad tRNS length for truecolor');
        transparency = {
          kind: 'rgb',
          r: ((data[0] << 8) | data[1]) & 0xff,
          g: ((data[2] << 8) | data[3]) & 0xff,
          b: ((data[4] << 8) | data[5]) & 0xff,
        };
      } else {
        throw invalid(`tRNS not allowed for color type ${header.colorType}`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawEnd = true;
      offset = dataEnd + 4;
      break;
    } else if (!isAncillary(type)) {
      throw invalid(`unknown critical chunk ${type}`);
    }

    offset = dataEnd + 4;
  }

  if (!header) throw invalid('missing IHDR');
  if (idat.length === 0) throw invalid('missing IDAT');
  if (!sawEnd) throw invalid('missing IEND');

  let inflated;
  try {
    inflated = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat));
  } catch (error) {
    throw invalid(`bad zlib stream (${error && error.message ? error.message : 'unknown'})`);
  }

  const rowBytes = Math.ceil((header.width * header.channels * header.bitDepth) / 8);
  const expected = header.height * (rowBytes + 1);
  if (inflated.length !== expected) {
    throw invalid(`scanline length mismatch (expected ${expected}, got ${inflated.length})`);
  }

  const bpp = Math.max(1, (header.channels * header.bitDepth) >> 3);
  const raw = unfilter(inflated, rowBytes, header.height, bpp);
  const data = expandToRgba(raw, header, palette, transparency);
  return { width: header.width, height: header.height, data };
}

/**
 * @param {string} type exactly 4 ASCII characters
 * @param {Buffer} data
 * @returns {Buffer}
 */
function buildChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

/**
 * Encode an RGBA image as an 8-bit, non-interlaced PNG (single IDAT, filter 0).
 * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} image
 * @returns {Buffer}
 * @throws {Error} `png-invalid: <reason>` when the image description is not encodable.
 */
export function encodePng(image) {
  if (!image || typeof image !== 'object') throw invalid('image is required');
  const { width, height, data } = image;
  if (!Number.isInteger(width) || width <= 0) throw invalid('width must be a positive integer');
  if (!Number.isInteger(height) || height <= 0) throw invalid('height must be a positive integer');
  if (!(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw invalid('data must be a Uint8Array or Uint8ClampedArray');
  }
  if (data.length !== width * height * 4) throw invalid('data length must equal width*height*4');

  const rowBytes = width * 4;
  const stride = rowBytes + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter type 0 (None) keeps the output deterministic
    raw.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * stride + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from(SIGNATURE),
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', deflateSync(raw, { level: 9 })),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);
}
