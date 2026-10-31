import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findPitwall,
  getPitwallInstallPaths,
  isPitwallTooOld,
} from './pitwall-daemon'

const TOKEN = 'ab'.repeat(32)

let root = ''

afterEach(() => {
  // The fake daemon writes its pid to daemon.pid and sleeps; stop it here, never a real one.
  const pidFile = path.join(root, 'daemon.pid')
  if (root && existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8')))
    } catch {}
  }
  if (root) rmSync(root, { force: true, recursive: true })
  root = ''
})

/** A temp HOME, state folder and PATH holding a fake pitwall that prints version and, as `daemon`, writes web.json and stays up. */
function setup(version: string | null) {
  root = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-'))
  const bin = path.join(root, 'bin')
  const state = path.join(root, 'state')
  mkdirSync(bin)
  mkdirSync(path.join(state, 'pitwall'), { recursive: true })
  if (version !== null) {
    const script = path.join(bin, 'pitwall')
    writeFileSync(
      script,
      `#!/bin/sh
echo "$@" >> "${root}/calls"
case "$1" in
  --version) echo "pitwall ${version}" ;;
  daemon)
    echo $$ > "${root}/daemon.pid"
    printf '{"url":"ws://127.0.0.1:41234/ws","token":"${TOKEN}","pid":%s}' $$ > "${state}/pitwall/web.json"
    exec sleep 30 ;;
esac
`,
    )
    chmodSync(script, 0o755)
  }
  const calls = () =>
    existsSync(path.join(root, 'calls'))
      ? readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n')
      : []
  return {
    calls,
    options: {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        XDG_RUNTIME_DIR: path.join(root, 'run'),
        XDG_STATE_HOME: state,
      },
      home: root,
      installPaths: [],
      platform: 'linux' as const,
      timeoutMs: 3000,
    },
    webJson: path.join(state, 'pitwall', 'web.json'),
  }
}

describe.skipIf(process.platform === 'win32')('findPitwall', () => {
  it('starts the daemon on a cold start and returns its endpoint', async () => {
    const { calls, options } = setup('v0.1.7')
    expect(await findPitwall(options)).toEqual({
      status: 'ready',
      endpoint: { token: TOKEN, url: 'ws://127.0.0.1:41234/ws' },
    })
    expect(calls()).toEqual(['--version', 'daemon'])
  })

  it('connects to a running daemon without running pitwall at all', async () => {
    const { calls, options, webJson } = setup('v0.1.7')
    writeFileSync(
      webJson,
      JSON.stringify({
        url: 'ws://127.0.0.1:5000/ws',
        token: TOKEN,
        pid: process.pid,
      }),
    )
    expect(await findPitwall(options)).toEqual({
      status: 'ready',
      endpoint: { token: TOKEN, url: 'ws://127.0.0.1:5000/ws' },
    })
    expect(calls()).toEqual([])
  })

  it('starts a new daemon when web.json names one that exited', async () => {
    const { calls, options, webJson } = setup('v0.1.7')
    writeFileSync(
      webJson,
      JSON.stringify({
        url: 'ws://127.0.0.1:5000/ws',
        token: TOKEN,
        pid: 2 ** 31 - 2,
      }),
    )
    expect(await findPitwall(options)).toMatchObject({ status: 'ready' })
    expect(calls()).toEqual(['--version', 'daemon'])
  })

  it('reports a missing pitwall with the platform', async () => {
    const { options } = setup(null)
    expect(await findPitwall(options)).toEqual({
      status: 'missing',
      platform: 'linux',
    })
  })

  it('finds pitwall in an install folder that is not on PATH', async () => {
    const { calls, options } = setup('v0.1.7')
    const status = await findPitwall({
      ...options,
      env: { ...options.env, PATH: '/usr/bin:/bin' },
      installPaths: [path.join(root, 'bin', 'pitwall')],
    })
    expect(status).toMatchObject({ status: 'ready' })
    expect(calls()).toEqual(['--version', 'daemon'])
  })

  it('reports a pitwall too old for the web protocol and starts nothing', async () => {
    const { calls, options } = setup('v0.1.6')
    expect(await findPitwall(options)).toEqual({
      status: 'outdated',
      required: '0.1.7',
      version: 'v0.1.6',
    })
    expect(calls()).toEqual(['--version'])
  })

  it('leaves a running daemon with no web listener alone', async () => {
    const { calls, options } = setup('v0.1.7')
    mkdirSync(path.join(root, 'run', 'pitwall'), { recursive: true })
    writeFileSync(
      path.join(root, 'run', 'pitwall', 'pitwall.sock.lock'),
      `${process.pid}\n`,
    )
    expect(await findPitwall(options)).toEqual({ status: 'noEndpoint' })
    expect(calls()).toEqual(['--version'])
  })

  it('reports no endpoint when the daemon it starts publishes none', async () => {
    const { options } = setup('v0.1.7')
    const script = path.join(root, 'bin', 'pitwall')
    // A daemon with [web] off: it never writes web.json.
    writeFileSync(script, '#!/bin/sh\necho "pitwall v0.1.7"\n')
    expect(await findPitwall({ ...options, timeoutMs: 300 })).toEqual({
      status: 'noEndpoint',
    })
  })
})

describe('isPitwallTooOld', () => {
  it.each([
    ['pitwall v0.1.6', true],
    ['pitwall v0.1.0-beta.18', true],
    ['pitwall v0.1.5-4-g1a2b3c4', true],
    ['pitwall v0.1.6-4-g1a2b3c4-dirty', false],
    ['pitwall v0.1.7', false],
    ['pitwall v0.2.0', false],
    ['pitwall v1.0.0', false],
    ['pitwall dev', false],
    ['pitwall 1a2b3c4-dirty', false],
  ])('%s: %s', (output, tooOld) => {
    expect(isPitwallTooOld(output)).toBe(tooOld)
  })
})

describe('getPitwallInstallPaths', () => {
  it("lists the install script's, Homebrew's and Scoop's folders", () => {
    expect(getPitwallInstallPaths({}, 'linux', '/h')).toContain(
      path.join('/h', '.local', 'bin', 'pitwall'),
    )
    expect(getPitwallInstallPaths({}, 'darwin', '/h')).toContain(
      '/opt/homebrew/bin/pitwall',
    )
    expect(
      getPitwallInstallPaths({ LOCALAPPDATA: '/l' }, 'win32', '/h'),
    ).toEqual([
      path.join('/l', 'pitwall', 'bin', 'pitwall.exe'),
      path.join('/h', 'scoop', 'shims', 'pitwall.exe'),
    ])
  })
})
