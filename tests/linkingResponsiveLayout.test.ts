import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('las filas de dispositivos del panel reservan una línea propia para controles en tablet', async () => {
  const source = await readFile(new URL('../src/styles/linking.css', import.meta.url), 'utf8')

  assert.match(
    source,
    /\.device-row \{\s*grid-template-columns: auto minmax\(0, 1fr\);\s*align-items: start;/,
  )
  assert.match(
    source,
    /\.device-row__tools \{[\s\S]*?grid-column: 2;[\s\S]*?justify-content: flex-start;[\s\S]*?flex-wrap: wrap;/,
  )
  assert.match(
    source,
    /\.device-row\.is-editing \{ grid-template-columns: auto minmax\(0, 1fr\); \}/,
  )
  assert.doesNotMatch(source, /\.device-row:has\(\.route-diagnostic\)/)
})
