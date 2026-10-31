import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  allowPitwallOrigin,
  getPitwallStateDir,
  readPitwallEndpoint,
} from './pitwall-endpoint'

const TOKEN = '9f'.repeat(32)

function writeEndpoint(contents: unknown): string {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), 'pitwall-')),
    'web.json',
  )
  writeFileSync(
    file,
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  )
  return file
}

describe('getPitwallStateDir', () => {
  it('follows pitwall: XDG_STATE_HOME, then LOCALAPPDATA on Windows, then ~/.local/state', () => {
    expect(getPitwallStateDir({ XDG_STATE_HOME: '/x' }, 'linux', '/h')).toBe(
      path.join('/x', 'pitwall'),
    )
    expect(getPitwallStateDir({ LOCALAPPDATA: '/l' }, 'win32', '/h')).toBe(
      path.join('/l', 'pitwall'),
    )
    expect(getPitwallStateDir({ LOCALAPPDATA: '/l' }, 'darwin', '/h')).toBe(
      path.join('/h', '.local', 'state', 'pitwall'),
    )
  })
})

describe('readPitwallEndpoint', () => {
  it('returns the url and token, and nothing else', async () => {
    const file = writeEndpoint({
      url: 'ws://127.0.0.1:41234/ws',
      token: TOKEN,
      pid: process.pid,
    })
    expect(await readPitwallEndpoint(file)).toEqual({
      url: 'ws://127.0.0.1:41234/ws',
      token: TOKEN,
    })
  })

  it.each([
    ['a missing file', null],
    ['damaged JSON', '{"url":'],
    ['a remote host', { url: 'ws://example.com:80/ws', token: TOKEN }],
    ['another path', { url: 'ws://127.0.0.1:1/other', token: TOKEN }],
    [
      'a short token',
      { url: 'ws://127.0.0.1:1/ws', token: 'abc', pid: process.pid },
    ],
    ['no pid', { url: 'ws://127.0.0.1:1/ws', token: TOKEN }],
    [
      'a daemon that exited',
      { url: 'ws://127.0.0.1:1/ws', token: TOKEN, pid: 2 ** 31 - 2 },
    ],
  ])('returns null for %s', async (_name, contents) => {
    const file =
      contents === null
        ? path.join(tmpdir(), 'pitwall-missing', 'web.json')
        : writeEndpoint(contents)
    expect(await readPitwallEndpoint(file)).toBeNull()
  })
})

describe('allowPitwallOrigin', () => {
  it("drops Origin from the daemon's upgrade only", () => {
    const onBeforeSendHeaders = vi.fn()
    allowPitwallOrigin(
      { webRequest: { onBeforeSendHeaders } } as never,
      () => 'ws://127.0.0.1:4100/ws',
    )
    const [filter, listener] = onBeforeSendHeaders.mock.calls[0]
    expect(filter).toEqual({ urls: ['ws://127.0.0.1/*', 'ws://localhost/*'] })

    const callback = vi.fn()
    listener(
      {
        url: 'ws://127.0.0.1:4100/ws',
        requestHeaders: { Origin: 'file://', 'User-Agent': 'aide' },
      },
      callback,
    )
    expect(callback).toHaveBeenLastCalledWith({
      requestHeaders: { 'User-Agent': 'aide' },
    })

    listener(
      { url: 'ws://127.0.0.1:5173/ws', requestHeaders: { Origin: 'file://' } },
      callback,
    )
    expect(callback).toHaveBeenLastCalledWith({})
  })
})
