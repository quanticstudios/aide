import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { JevSettings } from './jev-settings'

const directories: string[] = []

function createSettings() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'aide-jev-settings-'))
  directories.push(directory)
  const filename = path.join(directory, 'jev.json')
  const storage = {
    decryptString: (value: Buffer) =>
      value.toString().split('').reverse().join(''),
    encryptString: (value: string) =>
      Buffer.from(value.split('').reverse().join('')),
    getSelectedStorageBackend: () => 'gnome_libsecret' as const,
    isEncryptionAvailable: () => true,
  }
  return {
    filename,
    storage,
    settings: new JevSettings(filename, storage, () => undefined),
  }
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

it('keeps credentials out of status and persists permission for the exact workspace root', () => {
  const { settings, filename, storage } = createSettings()
  expect(settings.getStatus('/workspace').allowProcessing).toBe(true)
  expect(() => settings.requireApiKey('/workspace')).toThrow('TypeSafe API key')
  settings.update('/workspace', {
    apiKey: 'secret-token',
    allowProcessing: true,
  })
  expect(settings.requireApiKey('/workspace')).toBe('secret-token')
  expect(JSON.stringify(settings.getStatus('/workspace'))).not.toContain(
    'secret-token',
  )
  expect(readFileSync(filename, 'utf8')).not.toContain('secret-token')
  const reopened = new JevSettings(filename, storage, () => undefined)
  expect(reopened.requireApiKey('/workspace')).toBe('secret-token')
  expect(reopened.requireApiKey('/another-workspace')).toBe('secret-token')
  reopened.update('/workspace', { allowProcessing: false })
  expect(() => reopened.requireApiKey('/workspace')).toThrow('Allow TypeSafe')
  expect(
    new JevSettings(filename, storage, () => undefined).getStatus('/workspace')
      .allowProcessing,
  ).toBe(false)
})

it('rejects unencrypted storage, missing credentials, malformed input and corrupt settings', () => {
  const { settings, filename, storage } = createSettings()
  settings.update('/workspace', { allowProcessing: true })
  expect(() => settings.requireApiKey('/workspace')).toThrow('TypeSafe API key')
  expect(() =>
    settings.update('/workspace', { apiKey: 'x\ny', allowProcessing: true }),
  ).toThrow('Invalid Jev settings')
  const unavailable = new JevSettings(
    filename,
    { ...storage, isEncryptionAvailable: () => false },
    () => undefined,
  )
  expect(() =>
    unavailable.update('/workspace', {
      apiKey: 'secret',
      allowProcessing: true,
    }),
  ).toThrow('secure credential storage')
  const plaintext = new JevSettings(
    filename,
    { ...storage, getSelectedStorageBackend: () => 'basic_text' },
    () => undefined,
  )
  expect(() =>
    plaintext.update('/workspace', { apiKey: 'secret', allowProcessing: true }),
  ).toThrow('secure credential storage')
  writeFileSync(filename, '{broken')
  expect(() =>
    new JevSettings(filename, storage, () => undefined).requireApiKey(
      '/workspace',
    ),
  ).toThrow('Jev settings could not be read')
})

it('uses an environment credential without saving it and supports explicit credential removal', () => {
  const { filename, storage } = createSettings()
  const settings = new JevSettings(filename, storage, () => 'environment-token')
  settings.update('/workspace', { allowProcessing: true })
  expect(settings.requireApiKey('/workspace')).toBe('environment-token')
  expect(readFileSync(filename, 'utf8')).not.toContain('environment-token')
  settings.update('/workspace', {
    apiKey: 'stored-token',
    allowProcessing: true,
  })
  settings.update('/workspace', { apiKey: '', allowProcessing: false })
  expect(
    new JevSettings(filename, storage, () => undefined).getStatus('/workspace')
      .hasCredential,
  ).toBe(false)
})

it('enables processing for existing settings while retaining explicit opt-outs', () => {
  const { filename, storage } = createSettings()
  writeFileSync(filename, JSON.stringify({ credential: null, roots: ['/old'] }))
  const settings = new JevSettings(filename, storage, () => 'environment-token')
  expect(settings.requireApiKey('/new')).toBe('environment-token')
  settings.update('/new', { allowProcessing: false })
  expect(() => settings.requireApiKey('/new')).toThrow('Allow TypeSafe')
  settings.update('/new', { allowProcessing: true })
  expect(settings.requireApiKey('/new')).toBe('environment-token')
})

it('hands the key and the workspaces without consent to the daemon', () => {
  const { settings } = createSettings()
  expect(settings.getDaemonSettings()).toEqual({
    apiKey: null,
    disabledRoots: [],
  })
  settings.update('/workspace', {
    apiKey: 'secret-token',
    allowProcessing: false,
  })
  expect(settings.getDaemonSettings()).toEqual({
    apiKey: 'secret-token',
    disabledRoots: ['/workspace'],
  })
})
