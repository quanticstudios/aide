import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  enablePitwallWeb,
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
  config) echo "${root}/config/pitwall/config.toml" ;;
  daemon)
    echo $$ > "${root}/daemon.pid"
    ls -l /proc/$$/fd > "${root}/daemon-fds" 2>/dev/null
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

  it.skipIf(process.platform !== 'linux')(
    'puts /dev/null over every descriptor aide has open, so the daemon keeps none of them',
    async () => {
      const { options } = setup('v0.1.7')
      // why: Electron leaves some descriptors, DevTools' port among them, without close-on-exec; an open file stands in for one.
      const open = openSync(path.join(root, 'devtools-port'), 'w')
      try {
        expect(await findPitwall(options)).toMatchObject({ status: 'ready' })
      } finally {
        closeSync(open)
      }
      const fds = readFileSync(path.join(root, 'daemon-fds'), 'utf8')
      expect(fds).toMatch(new RegExp(` ${open} -> /dev/null$`, 'm'))
      expect(fds).not.toContain('devtools-port')
    },
  )

  it('reports why the daemon it starts exits, and where pitwall logged it', async () => {
    const { options } = setup('v0.1.7')
    writeFileSync(
      path.join(root, 'bin', 'pitwall'),
      `#!/bin/sh
case "$1" in
  --version) echo "pitwall v0.1.7" ;;
  daemon) echo "pitwall: listen unix /run/x/pitwall.sock: bind: invalid argument" >&2; exit 1 ;;
esac
`,
    )
    const crashLog = path.join(root, 'state', 'pitwall', 'crash.log')
    writeFileSync(crashLog, 'pitwall: an older failure\n')
    expect(await findPitwall(options)).toEqual({
      status: 'failed',
      log: crashLog,
      reason: 'listen unix /run/x/pitwall.sock: bind: invalid argument',
    })
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

describe.skipIf(process.platform === 'win32')('enablePitwallWeb', () => {
  /** A fake pitwall whose daemon, like pitwall's, writes web.json only with [web] enabled = true in its config. */
  function setupWeb() {
    const fake = setup('v0.1.7')
    const config = path.join(root, 'config', 'pitwall', 'config.toml')
    const script = path.join(root, 'bin', 'pitwall')
    writeFileSync(
      script,
      readFileSync(script, 'utf8').replace(
        '  daemon)\n',
        `  daemon)\n    grep -q '^enabled = true' "${config}" 2>/dev/null || exit 0\n`,
      ),
    )
    return { ...fake, config, options: { ...fake.options, timeoutMs: 500 } }
  }

  it('writes [web] enabled = true into a missing config.toml and connects', async () => {
    const { config, options } = setupWeb()
    expect(await findPitwall(options)).toEqual({ status: 'noEndpoint' })
    expect(await enablePitwallWeb(options)).toMatchObject({ status: 'ready' })
    expect(readFileSync(config, 'utf8')).toBe('[web]\nenabled = true\n')
  })

  it("appends the table to a config.toml that has none and keeps the user's lines", async () => {
    const { config, options } = setupWeb()
    mkdirSync(path.dirname(config), { recursive: true })
    writeFileSync(config, '# mine\ntheme = "aide-dark"')
    expect(await enablePitwallWeb(options)).toMatchObject({ status: 'ready' })
    expect(readFileSync(config, 'utf8')).toBe(
      '# mine\ntheme = "aide-dark"\n\n[web]\nenabled = true\n',
    )
  })

  it.each([
    '[web]\nport = 4000\n',
    '["web"]\nport = 4000\n',
    "[ 'web' ]\nport = 4000\n",
    '"web" = { enabled = false }\n',
    'web.port = 4000\n',
    '[web.extra]\nkey = 1\n',
  ])('leaves the [web] the user wrote in %j alone and says what to set', async (mine) => {
    const { config, options } = setupWeb()
    mkdirSync(path.dirname(config), { recursive: true })
    writeFileSync(config, mine)
    await expect(enablePitwallWeb(options)).rejects.toThrow(
      `${config} already has a [web] table. Set enabled = true in it.`,
    )
    expect(readFileSync(config, 'utf8')).toBe(mine)
  })

  it('writes nothing into a config.toml it cannot read as TOML', async () => {
    const { config, options } = setupWeb()
    mkdirSync(path.dirname(config), { recursive: true })
    writeFileSync(config, 'theme = \n')
    await expect(enablePitwallWeb(options)).rejects.toThrow(
      `${config} is not valid TOML`,
    )
    expect(readFileSync(config, 'utf8')).toBe('theme = \n')
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
