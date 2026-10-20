#!/usr/bin/env node
/**
 * 个人工作台发布脚本（零依赖 / Node ESM / Windows 友好）
 *
 * 用法（在仓库任意位置执行都可以）：
 *   node scripts/release.mjs
 *
 * 它做四件事：
 *   1. 以 package.json 的 version 作为唯一版本来源，校验必需文件齐全，
 *      并对 .js 文件跑 `node --check` 语法检查；
 *   2. 在 %TEMP%\pw-pkg-<版本>\personal-workbench\ 生成 staging 目录
 *      （按 package.json.files + package.json 本身）；
 *   3. 用 PowerShell 的 Compress-Archive 产出 E:\deepseek\personal-workbench-<版本>.zip，
 *      用 Harness 自带 node + pnpm 以离线模式执行 `pnpm pack` 产出同名 .tgz；
 *   4. 解压 zip 后与工作区同名文件逐一比对 SHA-256，打印 MATCH / DIFF，
 *      出现 DIFF 时以非 0 退出码结束。
 *
 * 可选环境变量（一般不用改）：
 *   PBW_RELEASE_OUT  产物输出目录，默认 E:\deepseek
 *   PBW_PNPM         pnpm 入口文件（pnpm.mjs 的绝对路径）
 *   PBW_PNPM_NODE    跑 pnpm 用的 node.exe（找不到时回退当前 node）
 *   PBW_KEEP_STAGING 设为 1 时保留 staging 与校验用的临时目录，便于排查
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')
const OUT_DIR = process.env.PBW_RELEASE_OUT || 'E:\\deepseek'
const PACKAGE_DIR_NAME = 'personal-workbench'
const DEFAULT_PNPM_ENTRY =
  'C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs'
const PNPM_ENTRY = process.env.PBW_PNPM || DEFAULT_PNPM_ENTRY
const DEFAULT_PNPM_NODE =
  'C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe'
const PNPM_NODE = process.env.PBW_PNPM_NODE || DEFAULT_PNPM_NODE
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const KEEP_STAGING = process.env.PBW_KEEP_STAGING === '1'

// ------------------------------------------------------------------ 日志

let stepNo = 0

function step(title) {
  stepNo += 1
  console.log(`\n[${String(stepNo).padStart(2, '0')}] ${title}`)
}

function info(message) {
  console.log(`     ${message}`)
}

function done(message) {
  console.log(`     ✔ ${message}`)
}

function warn(message) {
  console.log(`     ! ${message}`)
}

function fail(message, error) {
  console.error(`\n[失败] ${message}`)
  if (error) {
    const detail = error.stderr ? String(error.stderr) : error.stack || String(error)
    console.error(`       原因：${detail.trim().split('\n').slice(0, 40).join('\n       ')}`)
  }
  process.exit(1)
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} 字节`
}

// ------------------------------------------------------------------ 工具

/** 把 'E:\x\y' 塞进 PowerShell 单引号字符串时需要的转义。 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** 只支持 `*` 与 `?` 的单段 glob，够用于 package.json.files。 */
function segmentToRegExp(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^\\\\/]*').replace(/\?/g, '[^\\\\/]')
  return new RegExp(`^${escaped}$`)
}

/** 展开 package.json.files 里的一条模式为相对路径列表（正斜杠统一成 path.join）。 */
function expandPattern(pattern) {
  const segments = String(pattern).split('/').filter(Boolean)
  let current = ['']
  for (const segment of segments) {
    const next = []
    for (const base of current) {
      if (!segment.includes('*') && !segment.includes('?')) {
        next.push(base ? path.join(base, segment) : segment)
        continue
      }
      const dir = base ? path.join(PROJECT_ROOT, base) : PROJECT_ROOT
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue
      const matcher = segmentToRegExp(segment)
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!matcher.test(entry.name)) continue
        next.push(base ? path.join(base, entry.name) : entry.name)
      }
    }
    current = next
  }
  return current.filter(rel => rel && fs.existsSync(path.join(PROJECT_ROOT, rel)))
}

function sha256OfFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function walkFiles(root) {
  const out = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    const abs = rel ? path.join(root, rel) : root
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const nextRel = rel ? path.join(rel, entry.name) : entry.name
      if (entry.isDirectory()) stack.push(nextRel)
      else if (entry.isFile()) out.push(nextRel)
    }
  }
  return out.sort()
}

/**
 * 目标已存在时先备份成 `<名字>.reset`，保留现场再覆盖。
 * 已有 `.reset` 且内容不同时改用 `.reset-2`、`.reset-3`…，绝不覆盖旧的备份；
 * 已有备份与目标内容完全一致时直接跳过，避免重复堆文件。
 */
function backupExisting(target) {
  if (!fs.existsSync(target)) return false
  const targetHash = sha256OfFile(target)
  const base = `${target}.reset`
  const candidates = [base]
  for (let index = 2; index < 100; index += 1) candidates.push(`${base}-${index}`)
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (sha256OfFile(candidate) === targetHash) {
        info(`${path.basename(candidate)} 已是同样内容的备份，跳过备份`)
        return false
      }
      continue
    }
    fs.copyFileSync(target, candidate)
    info(`已存在同名产物，先备份：${path.basename(candidate)}`)
    return true
  }
  fail(`备份 ${path.basename(base)} 失败：可用备份名过多`)
}

/** 直接跑一个进程并把 stdout/stderr 收进异常里，失败时日志更可读。 */
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

// ------------------------------------------------------------------ 主流程

function readPackage() {
  step('读取 package.json')
  const file = path.join(PROJECT_ROOT, 'package.json')
  if (!fs.existsSync(file)) fail(`找不到 package.json：${file}`)
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail('package.json 不是合法 JSON', error)
  }
  const version = String(pkg.version || '').trim()
  if (!version) fail('package.json 缺少 version 字段，无法确定发布版本')
  if (!/^\d+\.\d+\.\d+/.test(version)) warn(`版本号 ${version} 不像是 semver，仍按原样使用`)
  done(`包名 ${pkg.name || '(未填写)'}，版本 ${version}（唯一版本来源）`)
  return { pkg, version }
}

function collectFiles(pkg) {
  step('校验必需文件')
  const patterns = Array.isArray(pkg.files) && pkg.files.length > 0 ? pkg.files : []
  if (patterns.length === 0) fail('package.json 的 files 列表为空，无法确定要打包哪些文件')
  info(`package.json.files：${patterns.join('、')}`)

  const seen = new Set()
  const files = []
  for (const pattern of [...patterns, 'package.json']) {
    const matches = expandPattern(pattern)
    if (matches.length === 0) fail(`files 里的 ${pattern} 没有匹配到任何文件`)
    for (const rel of matches) {
      const key = rel.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      files.push(rel)
    }
  }

  for (const rel of files) {
    const abs = path.join(PROJECT_ROOT, rel)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) fail(`${rel} 不是普通文件`)
    if (stat.size === 0) warn(`${rel} 是空文件（${formatBytes(0)}）`)
    info(`${rel.padEnd(26)} ${formatBytes(stat.size)}`)
  }
  done(`共 ${files.length} 个文件待打包`)
  return files
}

function checkSyntax(files) {
  step('语法检查（node --check）')
  const targets = files.filter(rel => /\.(js|mjs|cjs)$/i.test(rel))
  if (targets.length === 0) {
    warn('files 里没有 JS 文件，跳过语法检查')
    return
  }
  for (const rel of targets) {
    const abs = path.join(PROJECT_ROOT, rel)
    try {
      run(process.execPath, ['--check', abs])
      done(`${rel} 语法检查通过`)
    } catch (error) {
      fail(`${rel} 未通过 node --check`, error)
    }
  }
}

function prepareStaging(version, files) {
  step('生成 staging 目录')
  const stagingRoot = path.join(os.tmpdir(), `pw-pkg-${version}`)
  const stagingDir = path.join(stagingRoot, PACKAGE_DIR_NAME)
  fs.rmSync(stagingRoot, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  for (const rel of files) {
    const dest = path.join(stagingDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(PROJECT_ROOT, rel), dest)
  }
  done(`${stagingDir}（${files.length} 个文件）`)
  return { stagingRoot, stagingDir }
}

function buildZip(version, stagingDir) {
  step('打包 zip（Compress-Archive）')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const zipPath = path.join(OUT_DIR, `personal-workbench-${version}.zip`)
  backupExisting(zipPath)
  const command = `Compress-Archive -LiteralPath ${psQuote(stagingDir)} -DestinationPath ${psQuote(zipPath)} -Force`
  try {
    run(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', command])
  } catch (error) {
    fail('Compress-Archive 执行失败', error)
  }
  const size = fs.statSync(zipPath).size
  done(`${zipPath}（${formatBytes(size)}）`)
  return { zipPath, size }
}

function buildTgz(version, stagingDir) {
  step('打包 tgz（pnpm pack，离线）')
  if (!fs.existsSync(PNPM_ENTRY)) fail(`找不到 pnpm 入口：${PNPM_ENTRY}（可用环境变量 PBW_PNPM 指定）`)
  // pnpm 11 的 `pack` 子命令不接受 --offline，改用环境变量把它切到离线模式，
  // 效果相同且不会访问 registry。
  const nodeBin = fs.existsSync(PNPM_NODE) ? PNPM_NODE : process.execPath
  info(`pnpm 入口：${PNPM_ENTRY}`)
  info(`node 入口：${nodeBin}`)
  try {
    const output = run(nodeBin, [PNPM_ENTRY, 'pack', '--pack-destination', '.'], {
      cwd: stagingDir,
      env: { ...process.env, npm_config_offline: 'true', npm_config_prefer_offline: 'true' },
    })
    for (const line of String(output || '').split('\n')) {
      if (line.trim()) info(`pnpm> ${line.trim()}`)
    }
  } catch (error) {
    fail('pnpm pack 执行失败（已切到离线模式，不会联网）', error)
  }

  const produced = fs
    .readdirSync(stagingDir)
    .filter(name => name.toLowerCase().endsWith('.tgz'))
    .map(name => path.join(stagingDir, name))
  if (produced.length === 0) fail(`${stagingDir} 里没有生成 .tgz，pnpm pack 可能未生效`)

  const expected = `local-${PACKAGE_DIR_NAME}-${version}.tgz`
  const source = produced.find(file => path.basename(file) === expected) || produced[0]
  if (path.basename(source) !== expected) warn(`pnpm 产物名是 ${path.basename(source)}，预期 ${expected}，仍按版本号重命名`)

  const tgzPath = path.join(OUT_DIR, `personal-workbench-${version}.tgz`)
  backupExisting(tgzPath)
  fs.rmSync(tgzPath, { force: true })
  try {
    fs.renameSync(source, tgzPath)
  } catch {
    fs.copyFileSync(source, tgzPath)
    fs.rmSync(source, { force: true })
  }
  const size = fs.statSync(tgzPath).size
  done(`${path.basename(source)} → ${tgzPath}（${formatBytes(size)}）`)
  return { tgzPath, size }
}

function verifyZip(version, zipPath, files) {
  step('SHA-256 一致性校验（zip 内容 vs 工作区文件）')
  const verifyRoot = path.join(os.tmpdir(), `pw-verify-${version}`)
  fs.rmSync(verifyRoot, { recursive: true, force: true })
  fs.mkdirSync(verifyRoot, { recursive: true })
  try {
    run(POWERSHELL_EXE, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(verifyRoot)} -Force`,
    ])
  } catch (error) {
    fail('解压 zip 失败', error)
  }

  // Compress-Archive 把 staging 目录本身打进去，解压后会多一层 personal-workbench。
  let base = verifyRoot
  const topEntries = fs.readdirSync(verifyRoot, { withFileTypes: true })
  if (topEntries.length === 1 && topEntries[0].isDirectory() && topEntries[0].name === PACKAGE_DIR_NAME) {
    base = path.join(verifyRoot, topEntries[0].name)
  }

  const packed = walkFiles(base)
  const expected = new Set(files.map(rel => path.posix.normalize(rel.split(path.sep).join('/'))))
  let matchCount = 0
  let diffCount = 0

  for (const rel of packed) {
    const relPosix = rel.split(path.sep).join('/')
    const workspaceFile = path.join(PROJECT_ROOT, rel)
    if (!expected.has(relPosix)) {
      diffCount += 1
      console.log(`     DIFF  ${relPosix}  包内有、工作区没有`)
      continue
    }
    expected.delete(relPosix)
    if (!fs.existsSync(workspaceFile)) {
      diffCount += 1
      console.log(`     DIFF  ${relPosix}  工作区文件不存在`)
      continue
    }
    const packedHash = sha256OfFile(path.join(base, rel))
    const sourceHash = sha256OfFile(workspaceFile)
    if (packedHash === sourceHash) {
      matchCount += 1
      console.log(`     MATCH ${relPosix}  ${packedHash.slice(0, 16)}…  ${formatBytes(fs.statSync(workspaceFile).size)}`)
    } else {
      diffCount += 1
      console.log(`     DIFF  ${relPosix}  包内 ${packedHash.slice(0, 16)}… ≠ 工作区 ${sourceHash.slice(0, 16)}…`)
    }
  }

  for (const missing of expected) {
    diffCount += 1
    console.log(`     DIFF  ${missing}  工作区有、包内缺失`)
  }

  if (!KEEP_STAGING) fs.rmSync(verifyRoot, { recursive: true, force: true })
  done(`MATCH ${matchCount} 个 / DIFF ${diffCount} 个`)
  return { matchCount, diffCount }
}

function main() {
  console.log('个人工作台发布脚本')
  console.log(`工作区：${PROJECT_ROOT}`)
  console.log(`输出目录：${OUT_DIR}`)

  const { pkg, version } = readPackage()
  if (pkg.dsh?.bundle?.patch) info(`bundle patch：${pkg.dsh.bundle.patch}`)

  const files = collectFiles(pkg)
  checkSyntax(files)
  const { stagingRoot, stagingDir } = prepareStaging(version, files)
  const { zipPath, size: zipSize } = buildZip(version, stagingDir)
  const { tgzPath, size: tgzSize } = buildTgz(version, stagingDir)
  const { matchCount, diffCount } = verifyZip(version, zipPath, files)

  if (!KEEP_STAGING) fs.rmSync(stagingRoot, { recursive: true, force: true })

  step('发布结果')
  info(`zip：${zipPath}（${formatBytes(zipSize)}）`)
  info(`tgz：${tgzPath}（${formatBytes(tgzSize)}）`)
  info(`校验：MATCH ${matchCount} 个，DIFF ${diffCount} 个`)

  if (diffCount > 0) {
    console.error('\n[失败] 包内文件与工作区不一致，请检查上面的 DIFF 行。')
    process.exit(1)
  }
  done(`发布完成：personal-workbench-${version} 的 zip 与 tgz 都在 ${OUT_DIR}`)
}

try {
  main()
} catch (error) {
  fail('脚本执行过程中出现未预期的异常', error)
}
