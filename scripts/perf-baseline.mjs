import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

import { _electron as electron } from '@playwright/test'

// see: docs/perf-baseline.md — options, metric definitions and the JSON shape
const root = path.resolve(import.meta.dirname, '..')
const config = {
  agents: Number(process.env.PERF_AGENTS ?? 5),
  durationSeconds: Number(process.env.PERF_SECONDS ?? 120),
  traceSeconds: Number(process.env.PERF_TRACE_SECONDS ?? 20),
  tokensPerSecond: Number(process.env.AIDE_FAKE_STREAM_TOKENS_PER_SECOND ?? 50),
  toolEvery: Number(process.env.AIDE_FAKE_STREAM_TOOL_EVERY ?? 150),
  toolMix: (process.env.AIDE_FAKE_STREAM_TOOL_MIX ?? 'Bash,Edit,Read').split(
    ',',
  ),
}
const output = path.resolve(process.env.PERF_OUT ?? 'perf-baseline.json')
const warmupSeconds = 10
const longTaskMicros = 100_000

const reactHook = () => {
  const stats = { chatPaneRenders: 0, commits: 0 }
  const lastProps = new WeakMap()
  window.__perfReact = stats
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    checkDCE() {},
    inject(renderer) {
      this.renderers.set(this.renderers.size + 1, renderer)
      return this.renderers.size
    },
    isDisabled: false,
    onCommitFiberRoot() {
      stats.commits += 1
      // why: React 19 swaps a host node's __reactProps$ object exactly when it re-renders that node.
      for (const node of document.querySelectorAll(
        '[data-testid="managed-session-content"]',
      )) {
        const key = Object.keys(node).find((name) =>
          name.startsWith('__reactProps$'),
        )
        const props = key ? node[key] : undefined
        if (lastProps.get(node) === props) continue
        lastProps.set(node, props)
        stats.chatPaneRenders += 1
      }
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    renderers: new Map(),
    supportsFiber: true,
  }
}

function git(cwd, ...args) {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'aide@example.com',
      GIT_AUTHOR_NAME: 'Aide Perf',
      GIT_COMMITTER_EMAIL: 'aide@example.com',
      GIT_COMMITTER_NAME: 'Aide Perf',
    },
  })
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]
}

const round = (value, digits = 1) =>
  value === null ? null : Number(value.toFixed(digits))

async function traceRenderer(page, seconds) {
  const cdp = await page.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  const done = new Promise((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve),
  )
  await cdp.send('Tracing.start', {
    traceConfig: {
      includedCategories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
      ],
    },
    transferMode: 'ReportEvents',
  })
  await sleep(seconds * 1000)
  await cdp.send('Tracing.end')
  await done
  await cdp.detach()
  return events
}

function summarizeTrace(events) {
  const started = events.find(
    (event) => event.name === 'TracingStartedInBrowser',
  )
  const rendererPid = started?.args?.data?.frames?.[0]?.processId
  const inRenderer = (event) =>
    rendererPid === undefined || event.pid === rendererPid
  const mainThreads = new Set(
    events
      .filter(
        (event) =>
          event.name === 'thread_name' &&
          event.args?.name === 'CrRendererMain' &&
          inRenderer(event),
      )
      .map((event) => `${event.pid}:${event.tid}`),
  )
  const tasks = events.filter(
    (event) =>
      event.name === 'RunTask' &&
      event.ph === 'X' &&
      mainThreads.has(`${event.pid}:${event.tid}`),
  )
  const frames = events
    .filter((event) => event.name === 'DrawFrame' && inRenderer(event))
    .map((event) => event.ts)
    .sort((a, b) => a - b)
  const intervals = frames
    .slice(1)
    .map((ts, index) => (ts - frames[index]) / 1000)

  return {
    frameTimeP50Ms: round(percentile(intervals, 0.5)),
    frameTimeP95Ms: round(percentile(intervals, 0.95)),
    framesPerSecond: round(frames.length / config.traceSeconds),
    longTasksOver100Ms: tasks.filter((event) => event.dur > longTaskMicros)
      .length,
    longestTaskMs: round(
      Math.max(0, ...tasks.map((event) => event.dur)) / 1000,
    ),
  }
}

const repository = mkdtempSync(path.join(os.tmpdir(), 'aide-perf-repo-'))
const dataDirectory = mkdtempSync(path.join(os.tmpdir(), 'aide-perf-data-'))
git(repository, 'init', '-b', 'main')
writeFileSync(path.join(repository, 'README.md'), '# aide\n')
git(repository, 'add', 'README.md')
git(repository, 'commit', '-m', 'Initial commit')

const launchedAt = performance.now()
const app = await electron.launch({
  args: [root, '--force-device-scale-factor=1'],
  // why: requiring electron downloads its binary when bun install skipped the postinstall.
  executablePath: createRequire(import.meta.url)('electron'),
  env: {
    ...process.env,
    AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
    AIDE_FAKE_MANAGED_PROVIDERS: '1',
    AIDE_FAKE_STREAM_SECONDS: String(config.durationSeconds + 60),
    AIDE_SOFTWARE_RENDERING: '1',
    AIDE_TEST_PROJECT_PICK_PATH: repository,
    ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    HYPRLAND_INSTANCE_SIGNATURE: '',
    OZONE_PLATFORM: 'x11',
    SWAYSOCK: '',
    TYPESAFE_API_KEY: 'synthetic-perf-key',
    WAYLAND_DISPLAY: '',
    XDG_SESSION_TYPE: 'x11',
  },
})

try {
  let page = await app.firstWindow()
  const openProject = () =>
    page.getByRole('button', { name: /open project/i }).last()
  await openProject().waitFor({ timeout: 60_000 })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  )
  const coldStartMs = performance.now() - launchedAt

  // why: the first window loads before Playwright can add an init script, so the React hook needs a reload.
  await app.context().addInitScript(reactHook)
  await page.reload()
  page = await app.firstWindow()
  await openProject().click()
  await page.getByTestId('active-workspace-name').waitFor()
  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.typesafe.ai/v1/systemone') {
        return await nativeFetch(url, options)
      }
      const { questions } = JSON.parse(String(options?.body))
      return Response.json({
        answers: Object.fromEntries(
          Object.keys(questions).map((key) => [
            key,
            { noul: 0.8, type: 'noul' },
          ]),
        ),
        model: 'jev-1.13.0',
        usage: { input_tokens: 100, output_tokens: 10 },
      })
    }
  })
  for (let index = 0; index < config.agents; index += 1) {
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /unified ai agent chat/i }).click()
  }
  const prompts = page.getByRole('textbox', { name: /prompt/i })
  await prompts.nth(config.agents - 1).waitFor()

  await app.evaluate(({ BrowserWindow }) => {
    const stats = { bytes: 0, messages: 0 }
    globalThis.__perfIpc = stats
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents
      const send = contents.send.bind(contents)
      // why: structured clone has no size API, so JSON length stands in for the bytes sent to the renderer.
      contents.send = (channel, ...args) => {
        stats.bytes += Buffer.byteLength(JSON.stringify(args) ?? '')
        stats.messages += 1
        send(channel, ...args)
      }
    }
  })

  for (let index = 0; index < config.agents; index += 1) {
    await prompts.nth(index).fill('perf-stream')
    await prompts.nth(index).press('Enter')
  }
  const streamingAt = performance.now()
  await sleep(warmupSeconds * 1000)

  const readCounters = () =>
    Promise.all([
      app.evaluate(() => ({ ...globalThis.__perfIpc })),
      page.evaluate(() => ({ ...window.__perfReact })),
    ])
  const [ipcStart, reactStart] = await readCounters()
  const countersAt = performance.now()

  // why: a canary that changes every frame keeps the compositor drawing, so DrawFrame intervals show the achievable frame rate.
  await page.evaluate(() => {
    const canary = document.createElement('div')
    canary.style.cssText =
      'position:fixed;left:0;bottom:0;width:1px;height:1px;pointer-events:none'
    document.body.append(canary)
    const tick = (time) => {
      canary.style.opacity = String(0.5 + (Math.floor(time) % 2) / 2)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const trace = summarizeTrace(await traceRenderer(page, config.traceSeconds))

  const remaining =
    config.durationSeconds * 1000 - (performance.now() - streamingAt)
  if (remaining > 0) await sleep(remaining)
  const [ipcEnd, reactEnd] = await readCounters()
  const seconds = (performance.now() - countersAt) / 1000
  const processes = await app.evaluate(({ app }) => app.getAppMetrics())
  const rssMb = (type) =>
    round(
      processes
        .filter((entry) => entry.type === type)
        .reduce((sum, entry) => sum + entry.memory.workingSetSize, 0) / 1024,
    )
  const states = await page.evaluate(async () =>
    Object.values(await window.aide.getManagedSessionSnapshots()).map(
      (snapshot) => snapshot.sessionState,
    ),
  )
  if (states.filter((state) => state === 'running').length !== config.agents) {
    await page.screenshot({ path: `${output}.png` })
    throw new Error(
      `Expected ${config.agents} agents streaming at the end, got [${states}]; screenshot at ${output}.png.`,
    )
  }

  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root })
      .toString()
      .trim(),
    machine: {
      ci: Boolean(process.env.CI),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      electron: await app.evaluate(() => process.versions.electron),
      loadAverage: round(os.loadavg()[0], 2),
      memoryGb: round(os.totalmem() / 1024 ** 3),
      os: `${os.type()} ${os.release()}`,
    },
    config,
    metrics: {
      coldStartMs: Math.round(coldStartMs),
      mainRssMb: rssMb('Browser'),
      rendererRssMb: rssMb('Tab'),
      ...trace,
      ipcBytesPerSecond: Math.round((ipcEnd.bytes - ipcStart.bytes) / seconds),
      ipcMessagesPerSecond: round(
        (ipcEnd.messages - ipcStart.messages) / seconds,
      ),
      reactCommitsPerSecond: round(
        (reactEnd.commits - reactStart.commits) / seconds,
      ),
      chatPaneRendersPerSecond: round(
        (reactEnd.chatPaneRenders - reactStart.chatPaneRenders) / seconds,
      ),
    },
  }
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`)

  console.log('| Metric | Value |\n| --- | --- |')
  for (const [name, value] of Object.entries(result.metrics)) {
    console.log(`| ${name} | ${value} |`)
  }
  console.log(`\nWrote ${output}`)
} finally {
  await app.close()
  rmSync(repository, { force: true, recursive: true })
  rmSync(dataDirectory, { force: true, recursive: true })
}
