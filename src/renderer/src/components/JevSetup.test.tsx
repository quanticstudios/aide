import { describe, expect, it } from 'vitest'
import {
  JEV_CONSENT_REQUIRED_MESSAGE,
  JEV_CREDENTIAL_REQUIRED_MESSAGE,
} from '../../../shared/jev'
import { getJevFirstRunMessage } from './JevSetup'

const ready = {
  allowProcessing: true,
  canStoreCredential: true,
  hasCredential: true,
}

describe('getJevFirstRunMessage', () => {
  it('says before the first send what the send would be refused for', () => {
    expect(getJevFirstRunMessage({ ...ready, hasCredential: false })).toBe(
      JEV_CREDENTIAL_REQUIRED_MESSAGE,
    )
    expect(
      getJevFirstRunMessage({
        ...ready,
        allowProcessing: false,
        hasCredential: false,
      }),
    ).toBe(JEV_CONSENT_REQUIRED_MESSAGE)
  })

  it('says nothing once Jev is ready, or while its settings load', () => {
    expect(getJevFirstRunMessage(ready)).toBeNull()
    expect(getJevFirstRunMessage(null)).toBeNull()
  })
})
