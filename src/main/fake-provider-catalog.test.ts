import { describe, expect, it } from 'vitest'

import { isFakeProviderCatalogEnabled } from './fake-provider-catalog'

describe('fake provider catalog', () => {
  it('turns on only for the fake provider modes e2e uses', () => {
    expect(isFakeProviderCatalogEnabled({})).toBe(false)
    expect(
      isFakeProviderCatalogEnabled({ AIDE_FAKE_MANAGED_PROVIDERS: '0' }),
    ).toBe(false)
    for (const mode of ['1', 'fail-start', 'missing-cli'])
      expect(
        isFakeProviderCatalogEnabled({ AIDE_FAKE_MANAGED_PROVIDERS: mode }),
      ).toBe(true)
  })
})
