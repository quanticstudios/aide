import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const stateDir = () => {
  const state = process.env.XDG_STATE_HOME
  if (!state || !process.env.AIDE_E2E_PITWALL) {
    throw new Error(
      'Set AIDE_E2E_PITWALL to a pitwall binary; e2e/pitwall-daemon.ts starts it.',
    )
  }
  return path.join(state, 'pitwall')
}

/** Does what `pitwall web open` does, without a browser of its own: a one-time code for a session cookie. */
async function signIn(page: Page): Promise<void> {
  const dir = stateDir()
  const { url } = JSON.parse(
    readFileSync(path.join(dir, 'web.json'), 'utf8'),
  ) as { url: string }
  const code = randomBytes(32).toString('hex')
  writeFileSync(
    path.join(dir, 'web-open.json'),
    JSON.stringify({
      expires: new Date(Date.now() + 60_000).toISOString(),
      hash: createHash('sha256').update(code).digest('hex'),
    }),
    { mode: 0o600 },
  )
  const base = url.replace(/^ws:/, 'http:').replace(/\/ws$/, '')
  await page.goto(`${base}/_pitwall/open?code=${code}`)
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
}

async function startSession(page: Page, prompt: string): Promise<void> {
  // Inside the daemon's temp root, which the global teardown removes.
  const repo = mkdtempSync(path.join(path.dirname(stateDir()), '..', 'repo-'))
  execFileSync('git', ['init', '-q', repo])
  await page.getByRole('link', { name: 'New' }).tap()
  await page.getByLabel('Folder').fill(repo)
  await page.getByLabel('First message').fill(prompt)
  await page.getByRole('button', { name: 'Start session' }).tap()
  await expect(page).toHaveURL(/#\/s\//)
}

/** Fails on what a phone would suffer: a page wider than the screen, or a control under 44px. */
async function expectPhoneFit(page: Page): Promise<void> {
  const fit = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    screenWidth: window.innerWidth,
    small: [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea',
      ),
    ]
      .filter((element) => element.checkVisibility())
      .map((element) => ({
        box: element.getBoundingClientRect(),
        name:
          element.getAttribute('aria-label') ??
          element.textContent?.trim() ??
          element.tagName,
      }))
      .filter(({ box }) => Math.min(box.width, box.height) < 43.5)
      .map(({ box, name }) => `${name} ${box.width}x${box.height}`),
  }))
  expect(fit.pageWidth).toBeLessThanOrEqual(fit.screenWidth)
  expect(fit.small).toEqual([])
}

const cspViolations = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const violations: string[] = []
  cspViolations.set(page, violations)
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) {
      violations.push(message.text())
    }
  })
  await signIn(page)
})

test.afterEach(({ page }) => {
  // pitwall serves the bundle with a strict CSP; anything it blocks is broken on the phone.
  expect(cspViolations.get(page)).toEqual([])
})

test('starts a session on a phone and answers its approval from the sheet', async ({
  page,
}) => {
  await expectPhoneFit(page)
  await startSession(page, 'approval')

  const sheet = page.getByRole('region', { name: 'Approval required' })
  await expect(sheet).toContainText('rm -rf build && bun run build')
  await expectPhoneFit(page)
  await sheet.getByRole('button', { name: /Allow once/ }).tap()
  await expect(sheet).toBeHidden()

  await page.getByRole('link', { name: 'Back to sessions' }).tap()
  await expect(page.getByTestId('phone-session')).not.toHaveCount(0)
  await expectPhoneFit(page)

  // A cold load on New waits for the connection before it lists projects.
  await page.goto(new URL('#/new', page.url()).href)
  await page.reload()
  await expect(page.getByLabel('Folder')).not.toHaveValue('')
})

test('steers a running turn from the composer, and stops another', async ({
  page,
}) => {
  await startSession(page, 'wait-claude')
  const steer = page.getByLabel('Steer the agent')
  await steer.fill('look at the tests first')
  await page.getByRole('button', { name: 'Steer' }).tap()
  // The fake answers a steer in the running turn and ends it.
  await expect(page.getByTestId('phone-app')).toContainText(
    'Steered: look at the tests first',
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expectPhoneFit(page)

  await page.getByRole('link', { name: 'Back to sessions' }).tap()
  await startSession(page, 'wait-claude')
  const stop = page.getByRole('button', { name: 'Stop' })
  await stop.tap()
  await expect(stop).toBeHidden()
  await expect(
    page.getByRole('textbox', { exact: true, name: 'Message' }),
  ).toBeVisible()
})

test('starts a new turn for a message sent after the turn ended', async ({
  page,
}) => {
  const sends: unknown[] = []
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      const frame = JSON.parse(String(payload))
      if (frame.type === 'send') sends.push(frame)
    }),
  )
  // The socket opened in beforeEach, before this listener.
  await page.reload()
  await startSession(page, 'hello there')
  await expect(page.getByTestId('phone-app')).toContainText(
    'Handled: hello there',
  )
  const message = page.getByRole('textbox', { exact: true, name: 'Message' })
  await message.fill('second prompt')
  await page.getByRole('button', { name: 'Send' }).tap()
  await expect(page.getByTestId('phone-app')).toContainText(
    'Handled: second prompt',
  )
  // why: pitwall reports an idle chat as running, and a steer to it detours through the queue.
  expect(sends.at(-1)).not.toHaveProperty('how')
})

test('answers an input request from the sheet', async ({ page }) => {
  await startSession(page, 'input')
  const sheet = page.getByRole('region', { name: 'Input required' })
  await expect(sheet).toContainText('What should claude do next?')
  await expectPhoneFit(page)
  await sheet.getByRole('button', { name: /Continue/ }).tap()
  await sheet.getByRole('button', { name: 'Submit answer' }).tap()
  await expect(sheet).toBeHidden()
})

test('is installable and keeps nothing for offline use', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  const manifest = await cdp.send('Page.getAppManifest')
  expect(manifest.errors).toEqual([])
  expect(JSON.parse(manifest.data ?? '{}')).toMatchObject({
    display: 'standalone',
    name: 'aIDE',
  })
  const offline = await page.evaluate(async () => ({
    caches: await caches.keys(),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
  }))
  expect(offline).toEqual({ caches: [], workers: 0 })
})
