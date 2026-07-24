/*
 * Expensive, hermetic acceptance drill for the actual packaged Linux updater.
 * It is intentionally a manual CI workflow: three AppImage builds plus two
 * replacement launches are unsuitable for the ordinary PR test budget.
 *
 * The signing private key exists only in this Node process and is piped to the
 * existing signer; it is never written, logged, or supplied to electron-vite.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:https'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const host = '127.0.0.1'
const attackerHost = '127.0.0.2'
const versions = ['0.1.0', '0.1.1', '0.1.2']
const maxLogBytes = 64 * 1024

async function connectCdp(chromium, endpoint) {
  let lastError
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await chromium.connectOverCDP(endpoint)
    } catch (error) {
      lastError = error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
    }
  }
  throw lastError
}

async function proveNativePty(page, workspaceId, cwd) {
  const sessionId = `ota-drill-${Date.now()}`
  await page.evaluate(
    async ({ cwd, sessionId, workspaceId }) => {
      const completion = new Promise((resolvePromise, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error('Timed out waiting for node-pty output.')),
          10_000,
        )
        const unsubscribe = window.aide.onTerminalEvent((event) => {
          if (event.sessionId !== sessionId) return
          if (event.type === 'data' && event.data.includes('native-pty')) {
            window.clearTimeout(timeout)
            unsubscribe()
            resolvePromise(undefined)
          }
        })
      })
      await window.aide.createTerminalSession({
        cols: 80,
        cwd,
        mode: 'shell',
        paneId: 'ota-drill-pane',
        rows: 24,
        sessionId,
        workspaceId,
      })
      await window.aide.writeTerminalInput(sessionId, 'printf native-pty\\n')
      await completion
      await window.aide.killTerminalSession(sessionId)
    },
    { cwd, sessionId, workspaceId },
  )
}

async function openUpdateModal(page) {
  const indicator = page.getByTestId('update-indicator')
  try {
    await indicator.waitFor({ state: 'visible', timeout: 10_000 })
    await indicator.click()
  } catch {
    // The privacy indicator is intentionally absent after acknowledgement. Keep
    // the fallback within the visible UI and first focus a top-bar control, so
    // a terminal pane cannot intercept the command-palette shortcut.
    await page.getByRole('button', { name: 'Open diagnostics' }).focus()
    await page.keyboard.press('Control+K')
    await page
      .getByText('Software update settings', { exact: true })
      .last()
      .click()
  }
  await page.getByTestId('update-modal').waitFor()
}

async function captureFailureUi(page, evidence) {
  if (!page || !evidence) return []
  try {
    await page.screenshot({ path: join(evidence, 'failure.png') })
    return (await page.locator('button,[role="heading"]').allTextContents())
      .map((text) => text.replaceAll(/\s+/g, ' ').trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 100)
  } catch {
    return []
  }
}

async function waitForChildExit(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out waiting for ${label} to exit.`)),
        30_000,
      ),
    ),
  ])
}

function assertPageOpen(page, stage) {
  if (page.isClosed()) {
    throw new Error(`Packaged renderer closed unexpectedly during ${stage}.`)
  }
}

function captureChild(child) {
  const record = { exitCode: null, signal: null, stderr: '', stdout: '' }
  const append = (field, chunk) => {
    record[field] = `${record[field]}${chunk}`.slice(-maxLogBytes)
  }
  child.stdout?.on('data', (chunk) => append('stdout', chunk.toString()))
  child.stderr?.on('data', (chunk) => append('stderr', chunk.toString()))
  child.once('exit', (code, signal) => {
    record.exitCode = code
    record.signal = signal
  })
  return record
}

function summarizeChild(record) {
  if (!record) return null
  return {
    exitCode: record.exitCode,
    signal: record.signal,
    stderrBytes: Buffer.byteLength(record.stderr),
    stdoutBytes: Buffer.byteLength(record.stdout),
  }
}

async function processSnapshot() {
  const uid = process.getuid?.()
  const entries = await readdir('/proc', { withFileTypes: true })
  const processes = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const pid = Number(entry.name)
        if (pid === process.pid) return null
        try {
          if (uid !== undefined && (await stat(`/proc/${pid}`)).uid !== uid)
            return null
          const [commandLine, status, processState] = await Promise.all([
            readFile(`/proc/${pid}/cmdline`),
            readFile(`/proc/${pid}/status`, 'utf8'),
            readFile(`/proc/${pid}/stat`, 'utf8'),
          ])
          const parent = /^PPid:\s*(\d+)$/m.exec(status)?.[1]
          const closingParenthesis = processState.lastIndexOf(')')
          const startTime = processState
            .slice(closingParenthesis + 2)
            .trim()
            .split(/\s+/)[19]
          if (!startTime) return null
          return {
            arguments: commandLine.toString().split('\0').filter(Boolean),
            pid,
            ppid: parent ? Number(parent) : 0,
            startTime,
          }
        } catch {
          return null
        }
      }),
  )
  return processes.filter(Boolean)
}

async function scopedAppProcesses(appPath) {
  const processes = await processSnapshot()
  const scoped = new Set(
    processes
      .filter((processInfo) => processInfo.arguments.includes(appPath))
      .map((processInfo) => processInfo.pid),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const processInfo of processes) {
      if (!scoped.has(processInfo.pid) && scoped.has(processInfo.ppid)) {
        scoped.add(processInfo.pid)
        changed = true
      }
    }
  }
  return processes.filter((processInfo) => scoped.has(processInfo.pid))
}

async function terminateAppProcesses(appPath) {
  const retained = new Map()
  const remember = (processes) => {
    for (const processInfo of processes) {
      retained.set(processInfo.pid, processInfo.startTime)
    }
  }
  const liveRetained = async () => {
    const snapshot = await processSnapshot()
    return snapshot.filter(
      (processInfo) => retained.get(processInfo.pid) === processInfo.startTime,
    )
  }
  const signal = async (signalName) => {
    remember(await scopedAppProcesses(appPath))
    for (const processInfo of await liveRetained()) {
      try {
        process.kill(processInfo.pid, signalName)
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }
  }

  await signal('SIGTERM')
  for (let attempt = 0; attempt < 50; attempt += 1) {
    remember(await scopedAppProcesses(appPath))
    if ((await liveRetained()).length === 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  await signal('SIGKILL')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    remember(await scopedAppProcesses(appPath))
    if ((await liveRetained()).length === 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Exact temporary AppImage processes did not exit.')
}

async function terminateUpdaterChild(appPath) {
  await terminateAppProcesses(appPath)
}

function trackServerSockets(server) {
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  return sockets
}

async function closeServerBounded(server, sockets) {
  if (!server) return
  for (const socket of sockets) socket.destroy()
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  await Promise.race([
    new Promise((resolvePromise) => server.close(() => resolvePromise())),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ])
}

function requireLinux() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The OTA upgrade drill requires a native Linux x64 host.')
  }
  for (const command of ['git', 'openssl', 'xvfb-run']) {
    if (spawnSync(command, ['--version'], { stdio: 'ignore' }).error) {
      throw new Error(`The OTA upgrade drill requires ${command}.`)
    }
  }
}

function run(command, args, { cwd = root, env, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output = []
    const error = []
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => error.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) return resolvePromise(Buffer.concat(output).toString())
      reject(
        new Error(
          `${command} failed (${code}): ${Buffer.concat(error).toString().slice(0, maxLogBytes)}`,
        ),
      )
    })
    child.stdin.end(input)
  })
}

async function digest(file) {
  const bytes = await readFile(file)
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sha512: createHash('sha512').update(bytes).digest('hex'),
    size: bytes.length,
  }
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
    }),
  )
  return files.flat()
}

async function assertNoSigningPrivateKey(
  privateKeyPem,
  publicKeyPem,
  artifact,
  version,
  temporary,
) {
  const privateRepresentations = [
    Buffer.from(privateKeyPem),
    Buffer.from(JSON.stringify(privateKeyPem)),
  ]
  const publicRepresentations = [
    Buffer.from(publicKeyPem),
    Buffer.from(JSON.stringify(publicKeyPem)),
  ]
  const mainFiles = await filesUnder(join(root, 'out', 'main'))
  const mainContents = await Promise.all(
    mainFiles.map((file) => readFile(file)),
  )
  if (
    mainContents.some((contents) =>
      privateRepresentations.some((value) => contents.includes(value)),
    )
  ) {
    throw new Error(
      'The exact ephemeral signing private key entered the main bundle.',
    )
  }
  if (
    !mainContents.some((contents) =>
      publicRepresentations.some((value) => contents.includes(value)),
    )
  ) {
    throw new Error(
      'The expected public key was not compiled into the main bundle.',
    )
  }
  const extraction = join(temporary, `extract-${version}`)
  await mkdir(extraction, { recursive: true })
  await run(artifact, ['--appimage-extract'], { cwd: extraction })
  const asar = join(extraction, 'squashfs-root', 'resources', 'app.asar')
  const asarContents = await readFile(asar)
  if (privateRepresentations.some((value) => asarContents.includes(value))) {
    throw new Error('The exact ephemeral signing private key entered app.asar.')
  }
}

async function makeCertificate(directory) {
  const caKey = join(directory, 'local-ca.key')
  const caCert = join(directory, 'local-ca.crt')
  const serverKey = join(directory, 'feed.key')
  const csr = join(directory, 'feed.csr')
  const cert = join(directory, 'feed.crt')
  const ext = join(directory, 'feed.ext')
  await writeFile(ext, `subjectAltName=IP:${host},IP:${attackerHost}\n`)
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    caKey,
    '-out',
    caCert,
    '-subj',
    '/CN=Aide OTA drill CA',
    '-days',
    '1',
  ])
  await run('openssl', [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    serverKey,
    '-out',
    csr,
    '-subj',
    `/CN=${host}`,
  ])
  await run('openssl', [
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    caCert,
    '-CAkey',
    caKey,
    '-CAcreateserial',
    '-out',
    cert,
    '-days',
    '1',
    '-extfile',
    ext,
  ])
  return { cert, key: serverKey, caCert }
}

async function signEnvelope(directory, input, privateKeyPem) {
  const source = join(directory, 'unsigned.json')
  const envelope = join(directory, 'release-envelope.json')
  const signature = join(directory, 'release-envelope.sig')
  await writeFile(source, JSON.stringify(input))
  await run('bun', [
    'scripts/create-release-envelope.ts',
    '--input',
    source,
    '--output',
    envelope,
  ])
  await run(
    'bun',
    [
      'scripts/sign-release-envelope.ts',
      '--envelope',
      envelope,
      '--private-key-stdin',
      '--signature',
      signature,
    ],
    { input: privateKeyPem },
  )
  return { envelope, signature }
}

async function main() {
  requireLinux()
  const temporary = await mkdtemp(join(tmpdir(), 'aide-ota-drill-'))
  const feed = join(temporary, 'feed')
  const logs = join(temporary, 'logs')
  const evidence = process.env.AIDE_OTA_DRILL_EVIDENCE_DIR
  const userData = join(temporary, 'user-data')
  const appPath = join(temporary, 'Aide.AppImage')
  const requests = []
  const repository = join(temporary, 'repository')
  let server
  let attackerServer
  let trustedSockets = new Set()
  let attackerSockets = new Set()
  let app
  let bootstrapLog = null
  let relaunchLog = null
  let page
  let initialUpdateSnapshot = null
  let drillStage = 'setup'
  let bootstrapExit = null
  const lifecycle = {
    browserDisconnectedStage: null,
    contextClosedStage: null,
    pageClosedStage: null,
    pageCrashedStage: null,
  }
  let failureExitWaitError = null

  try {
    await Promise.all([
      mkdir(feed, { recursive: true }),
      mkdir(logs, { recursive: true }),
    ])
    const tls = await makeCertificate(temporary)
    const signing = generateKeyPairSync('ed25519')
    const publicKeyPem = signing.publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString()
    const privateKeyPem = signing.privateKey
      .export({ format: 'pem', type: 'pkcs8' })
      .toString()
    server = createServer(
      { cert: await readFile(tls.cert), key: await readFile(tls.key) },
      async (request, response) => {
        const pathname = new URL(request.url, `https://${host}`).pathname
        requests.push({ host: request.headers.host ?? '', path: pathname })
        const file = join(feed, pathname)
        try {
          const contents = await readFile(file)
          response.writeHead(200, {
            'content-length': contents.length,
            'cache-control': 'no-store',
          })
          response.end(contents)
        } catch {
          response.writeHead(404).end()
        }
      },
    )
    trustedSockets = trackServerSockets(server)
    await new Promise((resolvePromise) =>
      server.listen(0, host, resolvePromise),
    )
    const port = server.address().port
    const origin = `https://${host}:${port}`
    attackerServer = createServer(
      { cert: await readFile(tls.cert), key: await readFile(tls.key) },
      (request, response) => {
        requests.push({
          host: request.headers.host ?? '',
          path: request.url ?? '',
        })
        response.writeHead(410).end()
      },
    )
    attackerSockets = trackServerSockets(attackerServer)
    await new Promise((resolvePromise) =>
      attackerServer.listen(0, attackerHost, resolvePromise),
    )
    const attackerOrigin = `https://${attackerHost}:${attackerServer.address().port}`
    const drillEnvironment = {
      AIDE_OTA_DRILL_BUILD: '1',
      AIDE_RELEASE_KEY_ID: 'aide-release-ota-drill-2026',
      AIDE_RELEASE_PUBLIC_KEY_PEM: publicKeyPem,
      AIDE_UPDATE_HEALTH_ENDPOINT: `${origin}/v1/ota-health/events`,
      AIDE_UPDATE_ORIGIN: origin,
    }
    // Compile once, then package three metadata versions. Unlike the normal
    // release command this intentionally produces only the exercised AppImage.
    await run('bun', ['run', 'build'], { env: drillEnvironment })
    await run('bun', ['run', 'rebuild:native'])
    await run('bun', ['run', 'test:native'])

    async function build(version) {
      await rm(join(root, 'dist'), { force: true, recursive: true })
      await run(
        join(root, 'node_modules/.bin/electron-builder'),
        [
          '--linux',
          'AppImage',
          '--x64',
          '--publish',
          'never',
          `--config.extraMetadata.version=${version}`,
        ],
        { env: drillEnvironment },
      )
      await run(
        'node',
        [
          'scripts/write-updater-metadata.mjs',
          '--platform',
          'linux',
          '--arch',
          'x64',
          '--directory',
          'dist',
        ],
        {
          env: { ...drillEnvironment, AIDE_PACKAGE_VERSION: version },
        },
      )
      const source = join(root, 'dist', `Aide-${version}-linux-x86_64.AppImage`)
      const release = join(feed, 'releases', `v${version}`, 'linux', 'x64')
      await mkdir(release, { recursive: true })
      await copyFile(source, join(release, basename(source)))
      await assertNoSigningPrivateKey(
        privateKeyPem,
        publicKeyPem,
        source,
        version,
        temporary,
      )
      await copyFile(
        join(root, 'dist', 'latest-linux.yml'),
        join(release, 'latest-linux.yml'),
      )
      return {
        artifact: join(release, basename(source)),
        feed: join(release, 'latest-linux.yml'),
      }
    }

    const bootstrap = await build(versions[0])
    const target = await build(versions[1])
    const recovery = await build(versions[2])
    await copyFile(bootstrap.artifact, appPath)
    await run('chmod', ['755', appPath])

    async function publish(version, release, revokedVersions = []) {
      const channel = join(feed, 'channels', 'stable', 'linux', 'x64')
      await rm(channel, { force: true, recursive: true })
      await mkdir(channel, { recursive: true })
      const [artifact, metadata] = await Promise.all([
        digest(release.artifact),
        digest(release.feed),
      ])
      const signed = await signEnvelope(
        channel,
        {
          arch: 'x64',
          artifact: {
            ...artifact,
            url: `${origin}/releases/v${version}/linux/x64/${basename(release.artifact)}`,
          },
          channel: 'stable',
          feed: {
            sha256: metadata.sha256,
            url: `${origin}/releases/v${version}/linux/x64/latest-linux.yml`,
          },
          keyId: 'aide-release-ota-drill-2026',
          platform: 'linux',
          productId: 'studio.quantic.aide',
          publishedAt: new Date().toISOString(),
          revokedVersions,
          rolloutPercentage: 100,
          schemaVersion: 1,
          urgency: 'normal',
          version,
        },
        privateKeyPem,
      )
      await copyFile(signed.envelope, join(channel, 'release-envelope.json'))
      await copyFile(signed.signature, join(channel, 'release-envelope.sig'))
    }

    await publish(versions[1], target)
    await mkdir(userData, { recursive: true })
    await mkdir(repository, { recursive: true })
    await run('git', ['init', '-b', 'main', repository])
    await writeFile(join(repository, 'README.md'), '# OTA drill\n')
    await run('git', ['-C', repository, 'add', 'README.md'])
    await run('git', [
      '-C',
      repository,
      '-c',
      'user.email=drill@example.invalid',
      '-c',
      'user.name=OTA Drill',
      'commit',
      '-m',
      'bootstrap',
    ])
    const before = await stat(appPath)
    // The hostile values are deliberately different. A packaged app can use
    // only its compiled config; request evidence below proves that boundary.
    app = spawn(
      'xvfb-run',
      [
        '-a',
        'env',
        `APPIMAGE=${appPath}`,
        `NODE_EXTRA_CA_CERTS=${tls.caCert}`,
        `XDG_CONFIG_HOME=${userData}`,
        `AIDE_UPDATE_ORIGIN=${attackerOrigin}`,
        'AIDE_RELEASE_KEY_ID=attacker',
        'AIDE_RELEASE_PUBLIC_KEY_PEM=attacker',
        `AIDE_UPDATE_HEALTH_ENDPOINT=${attackerOrigin}/v1/ota-health/events`,
        appPath,
        '--no-sandbox',
        '--enable-logging=stderr',
        '--remote-debugging-port=9229',
      ],
      { cwd: temporary, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    bootstrapLog = captureChild(app)
    app.once('exit', (code, signal) => {
      bootstrapExit = { code, signal, stage: drillStage }
    })
    // Drive the real preload bridge. The packaged page exposes no Node APIs.
    const { chromium } = await import('playwright')
    const browser = await connectCdp(chromium, 'http://127.0.0.1:9229')
    const context = browser.contexts()[0]
    page = context.pages()[0]
    browser.on('disconnected', () => {
      lifecycle.browserDisconnectedStage = drillStage
    })
    context.on('close', () => {
      lifecycle.contextClosedStage = drillStage
    })
    page.on('close', () => {
      lifecycle.pageClosedStage = drillStage
    })
    page.on('crash', () => {
      lifecycle.pageCrashedStage = drillStage
    })
    initialUpdateSnapshot = await page.evaluate(() =>
      window.aide.getUpdateSnapshot(),
    )
    if (
      initialUpdateSnapshot.capability !== 'supported' ||
      initialUpdateSnapshot.phase !== 'idle'
    ) {
      throw new Error(
        `Expected packaged updater capability supported/idle, got ${initialUpdateSnapshot.capability}/${initialUpdateSnapshot.phase}.`,
      )
    }
    drillStage = 'disable automatic downloads'
    await openUpdateModal(page)
    const automaticDownloads = page.getByRole('switch', {
      name: 'Download updates automatically',
    })
    await automaticDownloads.focus()
    await page.keyboard.press('Space')
    await page.waitForFunction(() =>
      window.aide
        .getUpdatePreferences()
        .then((preferences) => !preferences.automaticDownloads),
    )
    drillStage = 'acknowledge health disclosure'
    await page
      .getByRole('button', {
        name: 'Acknowledge and enable health reporting',
      })
      .click()
    await page.waitForFunction(() =>
      window.aide
        .getUpdatePreferences()
        .then(
          (preferences) =>
            preferences.healthDisclosureAcknowledged &&
            preferences.healthReportingEnabled,
        ),
    )
    drillStage = 'disable health reporting'
    const healthReports = page.getByRole('switch', {
      name: 'Share privacy-bounded update health reports',
    })
    await healthReports.focus()
    await page.keyboard.press('Space')
    await page.waitForFunction(() =>
      window.aide
        .getUpdatePreferences()
        .then(
          (preferences) =>
            preferences.healthDisclosureAcknowledged &&
            !preferences.healthReportingEnabled,
        ),
    )
    drillStage = 'create workspace and prove native pty'
    await page.evaluate((repo) => window.aide.importProject(repo), repository)
    const storage = await page.evaluate(() => window.aide.getStorageSnapshot())
    const workspace = storage.workspaces[0]
    if (!workspace)
      throw new Error('The packaged app did not persist the drill workspace.')
    await proveNativePty(page, workspace.id, repository)
    drillStage = 'manual update check'
    await page.getByRole('button', { name: 'Check for updates' }).click()
    await page.waitForFunction(() =>
      window.aide
        .getUpdateSnapshot()
        .then((snapshot) => snapshot.phase === 'available'),
    )
    drillStage = 'manual update download'
    await page.getByRole('button', { name: 'Download update' }).click()
    await page.waitForFunction(() =>
      window.aide
        .getUpdateSnapshot()
        .then((snapshot) => snapshot.phase === 'downloaded'),
    )
    drillStage = 'downloaded target update'
    assertPageOpen(page, drillStage)
    // Refresh the signed channel after download: restart must refuse it before
    // touching the versionless AppImage.
    await publish(versions[1], target, [versions[1]])
    drillStage = 'published revoked target channel'
    assertPageOpen(page, drillStage)
    drillStage = 'before revoked restart'
    await page.getByRole('button', { name: 'Restart to update' }).click()
    drillStage = 'after revoked restart'
    await page
      .getByText('Update can no longer be installed safely.', { exact: false })
      .waitFor()
    if ((await stat(appPath)).ino !== before.ino)
      throw new Error('Revocation replaced AppImage.')
    await publish(versions[2], recovery)
    drillStage = 'check recovery update'
    await page.getByRole('button', { name: 'Retry update' }).click()
    await page.waitForFunction(
      (expectedVersion) =>
        window.aide
          .getUpdateSnapshot()
          .then(
            (snapshot) =>
              snapshot.phase === 'available' &&
              snapshot.targetVersion === expectedVersion,
          ),
      versions[2],
    )
    drillStage = 'download recovery update'
    await page.getByRole('button', { name: 'Download update' }).click()
    await page.waitForFunction(
      (expectedVersion) =>
        window.aide
          .getUpdateSnapshot()
          .then(
            (snapshot) =>
              snapshot.phase === 'downloaded' &&
              snapshot.targetVersion === expectedVersion,
          ),
      versions[2],
    )
    drillStage = 'before recovery restart'
    let recoveryRestartClosedRenderer = false
    try {
      await page.getByRole('button', { name: 'Restart to update' }).click()
    } catch (error) {
      // Electron closes the renderer as a direct consequence of the only
      // successful install request. It is accepted only after the replacement
      // and 0.1.2 relaunch assertions below prove the outcome.
      if (!page.isClosed()) throw error
      recoveryRestartClosedRenderer = true
    }
    drillStage = 'after recovery restart request'
    await browser.close().catch(() => undefined)
    await waitForChildExit(app, 'bootstrap AppImage')
    const after = await stat(appPath)
    if (after.ino === before.ino)
      throw new Error('AppImage was not replaced at its stable path.')
    // electron-updater performed the replacement above. Start the exact
    // versionless replacement on an independent CDP port, avoiding any race
    // with an updater-managed child and proving an actual usable relaunch.
    await terminateUpdaterChild(appPath)
    const relaunchedProcess = spawn(
      'xvfb-run',
      [
        '-a',
        'env',
        `APPIMAGE=${appPath}`,
        `NODE_EXTRA_CA_CERTS=${tls.caCert}`,
        `XDG_CONFIG_HOME=${userData}`,
        appPath,
        '--no-sandbox',
        '--remote-debugging-port=9230',
      ],
      { cwd: temporary, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    relaunchLog = captureChild(relaunchedProcess)
    const relaunched = await connectCdp(chromium, 'http://127.0.0.1:9230')
    const relaunchedPage = relaunched.contexts()[0].pages()[0]
    const restored = await relaunchedPage.evaluate(() =>
      window.aide.getStorageSnapshot(),
    )
    const restoredWorkspace = restored.workspaces[0]
    if (!restoredWorkspace || restoredWorkspace.id !== workspace.id)
      throw new Error(
        'The upgraded app did not retain its SQLite workspace sentinel.',
      )
    const preferences = await relaunchedPage.evaluate(() =>
      window.aide.getUpdatePreferences(),
    )
    if (
      preferences.automaticDownloads ||
      !preferences.healthDisclosureAcknowledged ||
      preferences.healthReportingEnabled
    ) {
      throw new Error(
        'The upgraded app did not retain its persisted update state.',
      )
    }
    const snapshot = await relaunchedPage.evaluate(() =>
      window.aide.getUpdateSnapshot(),
    )
    if (snapshot.currentVersion !== versions[2]) {
      throw new Error(
        `Expected relaunch at ${versions[2]}, got ${snapshot.currentVersion}.`,
      )
    }
    if (recoveryRestartClosedRenderer && after.ino === before.ino) {
      throw new Error(
        'Renderer closed during recovery restart without replacement.',
      )
    }
    await proveNativePty(relaunchedPage, restoredWorkspace.id, repository)
    await relaunched.close()
    await terminateAppProcesses(appPath)
    if (
      !requests.some((request) =>
        request.path.includes(
          '/channels/stable/linux/x64/release-envelope.json',
        ),
      ) ||
      requests.some((request) => request.host.startsWith(attackerHost))
    )
      throw new Error(
        'Compiled update origin was not the only requested origin.',
      )
    await writeFile(
      join(logs, 'requests.json'),
      JSON.stringify(requests, null, 2),
    )
    if (evidence) {
      await mkdir(evidence, { recursive: true })
      await copyFile(
        join(logs, 'requests.json'),
        join(evidence, 'requests.json'),
      )
      await writeFile(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            bootstrapVersion: versions[0],
            recoveredVersion: versions[2],
            replaced: before.ino !== after.ino,
            requestCount: requests.length,
            processes: {
              bootstrap: summarizeChild(bootstrapLog),
              relaunch: summarizeChild(relaunchLog),
            },
            stage: drillStage,
          },
          null,
          2,
        ),
      )
    }
    console.log(`Linux OTA upgrade drill passed; bounded evidence: ${logs}`)
  } catch (error) {
    if (
      app &&
      (lifecycle.pageClosedStage || lifecycle.contextClosedStage) &&
      !bootstrapExit
    ) {
      try {
        await waitForChildExit(app, 'unexpectedly closed bootstrap AppImage')
      } catch (waitError) {
        failureExitWaitError = String(waitError).slice(0, maxLogBytes)
      }
    }
    if (evidence) {
      await mkdir(evidence, { recursive: true })
      const visibleUi = await captureFailureUi(page, evidence)
      await writeFile(
        join(evidence, 'failure.json'),
        JSON.stringify(
          {
            error: String(error)
              .replaceAll(
                /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
                '[redacted key]',
              )
              .slice(0, maxLogBytes),
            initialUpdateSnapshot: initialUpdateSnapshot
              ? {
                  capability: initialUpdateSnapshot.capability,
                  phase: initialUpdateSnapshot.phase,
                  revision: initialUpdateSnapshot.revision,
                }
              : null,
            stage: drillStage,
            bootstrapExit,
            lifecycle,
            failureExitWaitError,
            requests: requests.slice(0, 500),
            processes: {
              bootstrap: summarizeChild(bootstrapLog),
              relaunch: summarizeChild(relaunchLog),
            },
            visibleUi,
          },
          null,
          2,
        ),
      )
    }
    throw error
  } finally {
    try {
      await terminateAppProcesses(appPath)
    } finally {
      try {
        await Promise.all([
          closeServerBounded(server, trustedSockets),
          closeServerBounded(attackerServer, attackerSockets),
        ])
      } finally {
        await rm(temporary, { force: true, recursive: true })
      }
    }
  }
}

await main()
