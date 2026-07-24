/**
 * Versioned public release keys embedded in the desktop application.
 *
 * This development fixture is deliberately not a production signing key. The
 * release workflow replaces it through a reviewed, signed application release
 * before enabling a production update origin.
 */
export const AIDE_RELEASE_KEYRING_VERSION = 1

export const AIDE_RELEASE_PUBLIC_KEYRING: Readonly<Record<string, string>> = {
  'aide-release-dev-2026-01': `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxp3V/T8bROfZ5b25FndVsYGjKbjD9mpjzZ8gLdnsE1g=
-----END PUBLIC KEY-----
`,
}
