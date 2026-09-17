import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { SafeStorage } from 'electron'
import { z } from 'zod'
import type { JevSettingsStatus } from '../shared/jev'

const credentialSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[\x21-\x7e]+$/)
const settingsSchema = z
  .object({
    credential: z.string().max(16384).nullable(),
    roots: z.array(z.string().max(4096)).max(1000),
  })
  .strict()
const inputSchema = z
  .object({
    allowProcessing: z.boolean(),
    apiKey: z.union([z.literal(''), credentialSchema]).optional(),
  })
  .strict()

/** Jev settings keep encrypted credentials and explicit workspace processing permissions in the main process. */
export class JevSettings {
  public constructor(
    private readonly filename: string,
    private readonly storage: Pick<
      SafeStorage,
      | 'encryptString'
      | 'decryptString'
      | 'isEncryptionAvailable'
      | 'getSelectedStorageBackend'
    >,
    private readonly readEnvironmentKey: () => string | undefined = () =>
      process.env.TYPESAFE_API_KEY,
  ) {}

  public getStatus(workspaceRoot: string): JevSettingsStatus {
    const settings = this.read()
    return {
      allowProcessing: settings.roots.includes(path.resolve(workspaceRoot)),
      canStoreCredential: this.canStoreCredential(),
      hasCredential: Boolean(this.readCredential(settings.credential)),
    }
  }

  public update(workspaceRoot: string, input: unknown): JevSettingsStatus {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new Error('Invalid Jev settings.')
    const settings = this.read()
    const root = path.resolve(workspaceRoot)
    const roots = settings.roots.filter((entry) => entry !== root)
    if (parsed.data.allowProcessing) roots.push(root)
    let credential = settings.credential
    if (parsed.data.apiKey === '') credential = null
    else if (parsed.data.apiKey !== undefined) {
      if (!this.canStoreCredential()) {
        throw new Error(
          'Enable secure credential storage or launch Aide with TYPESAFE_API_KEY.',
        )
      }
      try {
        credential = this.storage
          .encryptString(parsed.data.apiKey)
          .toString('base64')
      } catch {
        throw new Error('The TypeSafe API key could not be saved securely.')
      }
    }
    const serialized = JSON.stringify(
      settingsSchema.parse({ credential, roots }),
    )
    mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filename}.${randomUUID()}`
    try {
      const descriptor = openSync(temporaryPath, 'wx', 0o600)
      try {
        writeFileSync(descriptor, serialized)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      renameSync(temporaryPath, this.filename)
    } catch {
      throw new Error('Jev settings could not be saved.')
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    }
    return this.getStatus(workspaceRoot)
  }

  public requireApiKey(workspaceRoot: string): string {
    const settings = this.read()
    if (!settings.roots.includes(path.resolve(workspaceRoot))) {
      throw new Error(
        'Allow TypeSafe processing for this workspace in Jev setup before sending a message.',
      )
    }
    const credential = this.readCredential(settings.credential)
    if (!credential)
      throw new Error(
        'Add a TypeSafe API key in Jev setup before sending a message.',
      )
    return credential
  }

  private canStoreCredential(): boolean {
    return (
      this.storage.isEncryptionAvailable() &&
      (process.platform !== 'linux' ||
        !['basic_text', 'unknown'].includes(
          this.storage.getSelectedStorageBackend(),
        ))
    )
  }

  private readCredential(encrypted: string | null): string | null {
    const environment = credentialSchema.safeParse(this.readEnvironmentKey())
    if (environment.success) return environment.data
    if (!encrypted || !this.canStoreCredential()) return null
    try {
      const decrypted = credentialSchema.safeParse(
        this.storage.decryptString(Buffer.from(encrypted, 'base64')),
      )
      return decrypted.success ? decrypted.data : null
    } catch {
      return null
    }
  }

  private read(): z.infer<typeof settingsSchema> {
    try {
      if (!existsSync(this.filename)) return { credential: null, roots: [] }
      if (statSync(this.filename).size > 4_200_000)
        throw new Error('Oversized settings')
      return settingsSchema.parse(
        JSON.parse(readFileSync(this.filename, 'utf8')),
      )
    } catch {
      throw new Error(
        'Jev settings could not be read. Restore or remove the Jev settings file in Aide user data.',
      )
    }
  }
}
