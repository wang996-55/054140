#!/usr/bin/env node
/**
 * Release helper: rebuild the client, run every test, then zip the plugin and
 * print the SHA-256 of the archive. No publishing step.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const distDir = path.join(root, 'dist')

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status || 1)
}

const node = process.execPath
run(node, [path.join('scripts', 'build-client.mjs')])
for (const test of ['schema.test.mjs', 'relay.test.mjs', 'image.test.mjs', 'host.test.mjs', 'host-apply.test.mjs', 'client.test.mjs', 'render.test.mjs']) {
  run(node, [path.join('tests', test)])
}

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const include = [
  'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md',
  'package.json', 'lib', 'locale', 'schemas', 'docs',
]
const skip = [/node_modules/, /^dist\//, /\.log$/]

async function collect(target, prefix) {
  const info = await stat(target)
  if (info.isFile()) return [prefix]
  const entries = await readdir(target)
  const files = []
  for (const entry of entries) {
    const child = path.join(target, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (skip.some(pattern => pattern.test(rel))) continue
    files.push(...await collect(child, rel))
  }
  return files
}

const files = []
for (const entry of include) {
  try {
    files.push(...await collect(path.join(root, entry), entry))
  } catch {
    // optional entry
  }
}

// Minimal stored (no compression) ZIP writer: deterministic, no dependencies.
const crcTable = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[index] = value
  }
  return table
})()

const crc32 = buffer => {
  let crc = -1
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

const zipName = `ai-replica-${manifest.version}.zip`
await mkdir(distDir, { recursive: true })
const zipPath = path.join(distDir, zipName)
const out = createWriteStream(zipPath)
const central = []
let offset = 0

for (const rel of files) {
  const data = await readFile(path.join(root, rel))
  const name = Buffer.from(rel.split(path.sep).join('/'), 'utf8')
  const compressed = zlib.deflateRawSync(data, { level: 9 })
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt16LE(0, 10)
  local.writeUInt16LE(0x21, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  await new Promise((resolve, reject) => {
    out.write(local, error => (error ? reject(error) : resolve()))
    out.write(name, error => (error ? reject(error) : resolve()))
    out.write(compressed, error => (error ? reject(error) : resolve()))
  })
  central.push({ name, crc, compressed: compressed.length, size: data.length, offset })
  offset += local.length + name.length + compressed.length
}

const centralStart = offset
for (const entry of central) {
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(8, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0x21, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.compressed, 20)
  header.writeUInt32LE(entry.size, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.offset, 42)
  await new Promise((resolve, reject) => {
    out.write(header, error => (error ? reject(error) : resolve()))
    out.write(entry.name, error => (error ? reject(error) : resolve()))
  })
  offset += header.length + entry.name.length
}

const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(central.length, 8)
end.writeUInt16LE(central.length, 10)
end.writeUInt32LE(offset - centralStart, 12)
end.writeUInt32LE(centralStart, 16)
end.writeUInt16LE(0, 20)
await new Promise(resolve => out.end(end, resolve))

const archive = await readFile(zipPath)
const sha = createHash('sha256').update(archive).digest('hex')
console.log(`\n${zipName}  ${(archive.length / 1024).toFixed(1)} KB  sha256=${sha}`)
console.log(`files: ${files.length}`)
await rm(path.join(distDir, '.keep'), { force: true })
