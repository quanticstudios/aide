import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('the drill packages AppImage only while production Linux packaging remains complete', async () => {
  const [drill, production] = await Promise.all([
    readFile(resolve(root, 'scripts/linux-ota-upgrade-drill.mjs'), 'utf8'),
    readFile(resolve(root, 'scripts/package-linux.mjs'), 'utf8'),
  ])
  assert.match(drill, /'--linux',\s*'AppImage',\s*'--x64'/)
  assert.doesNotMatch(drill, /bun', \['run', 'package:linux'/)
  assert.match(
    production,
    /await run\(resolve\(root, 'node_modules\/\.bin\/electron-builder'\), \[/,
  )
  assert.match(production, /write-checksums\.mjs/)
  assert.match(production, /verify-linux-package\.mjs/)
})

test('the drill constructs the restricted signed feed object', async () => {
  const drill = await readFile(
    resolve(root, 'scripts/linux-ota-upgrade-drill.mjs'),
    'utf8',
  )
  assert.match(drill, /feed:\s*\{\s*sha256: metadata\.sha256,/)
  assert.doesNotMatch(drill, /feed:\s*\{\s*\.\.\.metadata/)
})

test('the bootstrap cannot inherit an install-exit shortcut', async () => {
  const drill = await readFile(
    resolve(root, 'scripts/linux-ota-upgrade-drill.mjs'),
    'utf8',
  )
  assert.doesNotMatch(drill, /APPIMAGE_EXIT_AFTER_INSTALL/)
  assert.match(drill, /terminateUpdaterChild\(appPath\)/)
  assert.match(drill, /processInfo\.arguments\.includes\(appPath\)/)
  assert.match(drill, /process\.getuid/)
  assert.match(drill, /server\.listen\(0, host, resolvePromise\)/)
  assert.doesNotMatch(drill, /0\.0\.0\.0/)
  assert.doesNotMatch(drill, /\/etc\/hosts/)
  assert.doesNotMatch(drill, /sudo/)
  assert.match(drill, /getByTestId\('update-indicator'\)/)
  assert.match(drill, /Software update settings/)
  assert.match(drill, /getByRole\('button', \{ name: 'Check for updates' \}\)/)
  assert.match(drill, /name: 'Download updates automatically'/)
  assert.match(drill, /keyboard\.press\('Space'\)/)
  assert.match(drill, /!preferences\.automaticDownloads/)
  assert.match(drill, /drillStage = 'check recovery update'/)
  assert.match(drill, /drillStage = 'download recovery update'/)
  assert.match(
    drill,
    /snapshot\.phase === 'available' &&\s*snapshot\.targetVersion === expectedVersion,\s*\),\s*versions\[2\],/,
  )
  assert.match(
    drill,
    /snapshot\.phase === 'downloaded' &&\s*snapshot\.targetVersion === expectedVersion,\s*\),\s*versions\[2\],/,
  )
  assert.match(drill, /drillStage = 'before revoked restart'/)
  assert.match(drill, /drillStage = 'after revoked restart'/)
  assert.match(drill, /assertPageOpen\(page, drillStage\)/)
  assert.match(drill, /page\.on\('crash'/)
  assert.match(drill, /browser\.on\('disconnected'/)
  assert.match(drill, /--enable-logging=stderr/)
  assert.match(drill, /detached: true/)
  assert.match(drill, /scopedAppProcesses/)
  assert.match(drill, /readFile\(`\/proc\/\$\{pid\}\/stat`/)
  assert.match(
    drill,
    /retained\.get\(processInfo\.pid\) === processInfo\.startTime/,
  )
  assert.match(drill, /signal\('SIGKILL'\)/)
  assert.match(drill, /closeAllConnections/)
  assert.match(drill, /await terminateAppProcesses\(appPath\)\n\s*} finally \{/)
  assert.match(
    drill,
    /await rm\(temporary, \{ force: true, recursive: true \}\)/,
  )
  assert.match(drill, /summarizeChild\(bootstrapLog\)/)
  assert.doesNotMatch(drill, /processes: \{ bootstrap: bootstrapLog/)
  assert.match(drill, /if \(!page\.isClosed\(\)\) throw error/)
  assert.match(drill, /waitForChildExit\(app, 'bootstrap AppImage'\)/)
  assert.match(drill, /captureFailureUi/)
})
