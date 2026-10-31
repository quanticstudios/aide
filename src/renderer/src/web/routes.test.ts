import { describe, expect, it } from 'vitest'
import { parsePhoneRoute, sessionHash } from './routes'

describe('phone routes', () => {
  it('reads the list, a new session and one session from the hash', () => {
    expect(parsePhoneRoute('')).toEqual({ kind: 'list' })
    expect(parsePhoneRoute('#/')).toEqual({ kind: 'list' })
    expect(parsePhoneRoute('#/new')).toEqual({ kind: 'new' })
    expect(parsePhoneRoute('#/s/abc')).toEqual({
      kind: 'session',
      sessionId: 'abc',
    })
  })

  it('round-trips a session id with characters a URL escapes', () => {
    const sessionId = 'ws-1:pane/2 #3'
    expect(parsePhoneRoute(sessionHash(sessionId))).toEqual({
      kind: 'session',
      sessionId,
    })
  })
})
