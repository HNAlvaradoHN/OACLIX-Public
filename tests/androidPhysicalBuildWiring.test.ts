import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../.github/workflows/verify.yml', import.meta.url)

test('el APK físico puede recibir backend privado sin publicarlo en el repositorio', async () => {
  const workflow = await readFile(workflowUrl, 'utf8')

  assert.match(workflow, /OACLIX_API_BASE_URL: \$\{\{ secrets\.OACLIX_API_BASE_URL \}\}/)
  assert.match(workflow, /if \[\[ -n "\$\{OACLIX_API_BASE_URL:-\}" \]\]/)
  assert.match(workflow, /gradle_args\+\=\("-POACLIX_API_BASE_URL=\$\{OACLIX_API_BASE_URL\}"\)/)
  assert.doesNotMatch(workflow, /oaclix\.geovaalvarado0\.workers\.dev/)
})
