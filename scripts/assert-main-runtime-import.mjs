import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mainEntry = readFileSync(resolve(root, 'out/main/index.js'), 'utf8')

assert.match(
  mainEntry,
  /import\s+\w+\s+from\s+['"]electron-updater['"]/,
  'the packaged main entry must default-import CommonJS electron-updater',
)
assert.doesNotMatch(
  mainEntry,
  /import\s*{\s*autoUpdater\s*}\s*from\s+['"]electron-updater['"]/,
  'the packaged main entry must not named-import CommonJS electron-updater',
)
