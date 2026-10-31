import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_PATH, readBootstrap } from './bootstrap'

const TOKEN = 'ab'.repeat(32)

function answer(status: number, body: unknown = {}) {
  const paths: string[] = []
  const fetchJson = async (path: string) => {
    paths.push(path)
    return new Response(JSON.stringify(body), { status })
  }
  return { fetchJson, paths }
}

describe('readBootstrap', () => {
  it('turns the relative url into a WebSocket on the page origin', async () => {
    const { fetchJson, paths } = answer(200, {
      protocol: 1,
      token: TOKEN,
      url: '/ws',
    })

    await expect(
      readBootstrap(fetchJson, 'http://127.0.0.1:4100/'),
    ).resolves.toEqual({
      endpoint: { token: TOKEN, url: 'ws://127.0.0.1:4100/ws' },
      status: 'ready',
    })
    expect(paths).toEqual([BOOTSTRAP_PATH])
  })

  it('uses wss behind https, as on the phone page at /app/', async () => {
    const { fetchJson } = answer(200, { token: TOKEN, url: '/ws' })

    const found = await readBootstrap(
      fetchJson,
      'https://box.tail1234.ts.net/app/#/s/one',
    )

    expect(found).toMatchObject({
      endpoint: { url: 'wss://box.tail1234.ts.net/ws' },
    })
  })

  it('reports no endpoint when the browser has no session', async () => {
    const { fetchJson } = answer(401)

    await expect(
      readBootstrap(fetchJson, 'http://127.0.0.1:4100/'),
    ).resolves.toEqual({ status: 'noEndpoint' })
  })
})
