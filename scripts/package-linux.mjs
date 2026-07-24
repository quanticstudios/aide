import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      ...options,
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
        ),
      )
    })
  })
}

export async function packageLinux() {
  if (process.platform !== 'linux') {
    throw new Error('Linux packages must be built on a native Linux host.')
  }
  if (process.arch !== 'x64') {
    throw new Error('Aide currently ships Linux packages for x64 only.')
  }

  await rm(resolve(root, 'dist'), { force: true, recursive: true })
  await run('bun', ['run', 'build'])
  await run('bun', ['run', 'rebuild:native'])
  await run('bun', ['run', 'test:native'])
  await run(resolve(root, 'node_modules/.bin/electron-builder'), [
    '--linux',
    '--x64',
    '--publish',
    'never',
  ])
  await run(process.execPath, [
    'scripts/write-updater-metadata.mjs',
    '--platform',
    'linux',
    '--arch',
    'x64',
    '--directory',
    'dist',
  ])
  await run(process.execPath, ['scripts/write-checksums.mjs', 'dist'])
  await run(process.execPath, ['scripts/verify-linux-package.mjs', 'dist'])
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await packageLinux()
}
