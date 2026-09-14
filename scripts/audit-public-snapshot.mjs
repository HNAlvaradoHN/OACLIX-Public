import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const ignoredDirectories = new Set(['.git', '.gradle', 'build', 'dist', 'node_modules'])
const forbiddenNames = new Set([
  '.env', '.dev.vars', '.npmrc', '.netrc', '.pypirc',
  'local.properties', 'key.properties', 'keystore.properties',
  'google-services.json', 'credentials.json',
])
const forbiddenExtensions = new Set(['.jks', '.keystore', '.p12', '.pfx', '.pem', '.key'])
const textExtensions = new Set([
  '.bat', '.c', '.cc', '.cpp', '.css', '.gradle', '.html', '.java', '.js', '.json', '.jsonc',
  '.kt', '.kts', '.md', '.mjs', '.pro', '.properties', '.sh', '.sql', '.svg', '.toml', '.ts',
  '.tsx', '.txt', '.webmanifest', '.xml', '.yaml', '.yml',
])
const textNames = new Set(['.gitignore', 'gradlew'])
const allowedBinarySha256 = new Map([
  ['android/gradle/wrapper/gradle-wrapper.jar', 'b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13'],
])
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024

const hardPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['stripe-live-key', /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ['production-d1-id', /["']database_id["']\s*:\s*["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}["']/i],
  ['credential-assignment', /\b(?:api[_-]?(?:key|token)|secret|password)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i],
  ['authorization-header', /\bauthorization\b\s*[:=]\s*["'][^"'\n]{8,}["']/i],
  ['cloud-account-id', /\baccount_id\b\s*[:=]\s*["'][^"'\n]{8,}["']/i],
]
const workerEndpointPattern = /https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev\b/gi
const personalDataPatterns = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
]

const failures = []

function hasNonExampleWorkerEndpoint(content) {
  for (const match of content.matchAll(workerEndpointPattern)) {
    const endpoint = match[0].toLowerCase()
    if (endpoint.includes('.example.workers.dev')) continue
    return true
  }
  return false
}

async function auditBinary(full, rel) {
  const expected = allowedBinarySha256.get(rel)
  if (!expected) {
    failures.push(`${rel}: unexpected binary file`)
    return
  }
  const digest = createHash('sha256').update(await readFile(full)).digest('hex')
  if (digest !== expected) failures.push(`${rel}: binary SHA-256 mismatch`)
}

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const full = join(dir, entry.name)
    const rel = relative(root, full).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      await walk(full)
      continue
    }
    if (!entry.isFile()) continue

    const name = basename(entry.name)
    const extension = extname(entry.name).toLowerCase()
    if (forbiddenNames.has(name) || forbiddenExtensions.has(extension)) {
      failures.push(`${rel}: forbidden file`)
      continue
    }

    const isText = textExtensions.has(extension) || textNames.has(name)
    if (!isText) {
      await auditBinary(full, rel)
      continue
    }

    const info = await stat(full)
    if (info.size > MAX_TEXT_FILE_BYTES) {
      failures.push(`${rel}: text file exceeds audit size limit`)
      continue
    }

    const content = await readFile(full, 'utf8')
    for (const [label, pattern] of hardPatterns) {
      if (pattern.test(content)) failures.push(`${rel}: ${label}`)
    }
    if (hasNonExampleWorkerEndpoint(content)) failures.push(`${rel}: workers-dev-endpoint`)
    for (const [label, pattern] of personalDataPatterns) {
      if (!pattern.test(content)) continue
      if (label === 'email' && /@(?:users\.noreply\.github\.com|example\.com)\b/i.test(content)) continue
      failures.push(`${rel}: personal ${label}`)
    }
  }
}

async function auditLockfile() {
  const path = join(root, 'package-lock.json')
  let lock
  try {
    lock = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    failures.push('package-lock.json: missing or invalid lockfile')
    return
  }

  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    failures.push('package-lock.json: unsupported lockfile structure')
    return
  }

  for (const [packagePath, descriptor] of Object.entries(lock.packages)) {
    if (!packagePath || !descriptor || typeof descriptor !== 'object' || descriptor.link === true) continue
    if (typeof descriptor.version !== 'string') continue

    if (typeof descriptor.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/.test(descriptor.integrity)) {
      failures.push(`${packagePath}: dependency missing sha512 integrity`)
    }
    if (typeof descriptor.resolved !== 'string' || !descriptor.resolved.startsWith('https://registry.npmjs.org/')) {
      failures.push(`${packagePath}: dependency is not pinned to the npm registry tarball`)
    }
  }
}

async function auditGradleVerification() {
  const path = join(root, 'android', 'gradle', 'verification-metadata.xml')
  let metadata
  try {
    metadata = await readFile(path, 'utf8')
  } catch {
    failures.push('android/gradle/verification-metadata.xml: missing dependency verification metadata')
    return
  }

  if (!/<verify-metadata>\s*true\s*<\/verify-metadata>/.test(metadata)) {
    failures.push('android/gradle/verification-metadata.xml: metadata verification is not enabled')
  }
  if (!/<sha256\s+value="[0-9a-f]{64}"/i.test(metadata)) {
    failures.push('android/gradle/verification-metadata.xml: no SHA-256 dependency checksums found')
  }
}

await walk(root)
await auditLockfile()
await auditGradleVerification()

if (failures.length) {
  console.error('PUBLIC SNAPSHOT AUDIT FAILED')
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('PUBLIC SNAPSHOT AUDIT PASSED')
}
