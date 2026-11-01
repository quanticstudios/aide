import type { ManagedSessionAttachment } from '../../../shared/managed-session'
import type { ProviderSkill } from '../../../shared/provider-skills'

const managedDraftDatabaseName = 'aide-renderer'
const managedDraftDatabaseVersion = 1
const managedDraftStoreName = 'managed-drafts'

export interface ManagedDraft {
  attachments: ManagedSessionAttachment[]
  selectedSkill?: ProviderSkill
  text: string
}

function isProviderSkill(value: unknown): value is ProviderSkill {
  if (!value || typeof value !== 'object') {
    return false
  }

  const skill = value as Partial<ProviderSkill>
  return (
    (skill.provider === 'claude' || skill.provider === 'codex') &&
    typeof skill.id === 'string' &&
    typeof skill.name === 'string' &&
    typeof skill.description === 'string' &&
    (skill.owner === 'Claude' || skill.owner === 'Codex')
  )
}

function validateStorageKey(storageKey: string): void {
  if (!storageKey || storageKey.length > 1_024) {
    throw new Error('The managed draft storage key is invalid.')
  }
}

export function validateManagedDraft(value: unknown): ManagedDraft {
  if (!value || typeof value !== 'object') {
    throw new Error('The saved managed draft is invalid.')
  }
  const draft = value as Partial<ManagedDraft>
  if (
    typeof draft.text !== 'string' ||
    !Array.isArray(draft.attachments) ||
    (draft.selectedSkill !== undefined && !isProviderSkill(draft.selectedSkill))
  ) {
    throw new Error('The saved managed draft is invalid.')
  }
  return {
    attachments: draft.attachments,
    ...(draft.selectedSkill ? { selectedSkill: draft.selectedSkill } : {}),
    text: draft.text,
  }
}

function openManagedDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      managedDraftDatabaseName,
      managedDraftDatabaseVersion,
    )
    let settled = false

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(managedDraftStoreName)) {
        request.result.createObjectStore(managedDraftStoreName)
      }
    }
    request.onerror = () => {
      settled = true
      reject(
        request.error ?? new Error('Could not open managed draft storage.'),
      )
    }
    request.onblocked = () => {
      settled = true
      reject(new Error('Managed draft storage is blocked by another window.'))
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    }
  })
}

export async function runManagedDraftRequest<Result>(
  mode: IDBTransactionMode,
  startRequest: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> {
  const database = await openManagedDraftDatabase()
  return new Promise((resolve, reject) => {
    let request: IDBRequest<Result>
    let result: Result

    try {
      const transaction = database.transaction(managedDraftStoreName, mode)
      request = startRequest(transaction.objectStore(managedDraftStoreName))
      request.onsuccess = () => {
        result = request.result
      }
      transaction.oncomplete = () => {
        database.close()
        resolve(result)
      }
      const rejectTransaction = () => {
        database.close()
        reject(
          transaction.error ??
            request.error ??
            new Error('Managed draft storage failed.'),
        )
      }
      transaction.onerror = rejectTransaction
      transaction.onabort = rejectTransaction
    } catch (error) {
      database.close()
      reject(error)
    }
  })
}

export async function loadManagedDraft(
  storageKey: string,
): Promise<ManagedDraft | null> {
  validateStorageKey(storageKey)
  const stored = await runManagedDraftRequest('readonly', (store) =>
    store.get(storageKey),
  )
  return stored === undefined ? null : validateManagedDraft(stored)
}

export async function saveManagedDraft(
  storageKey: string,
  draft: ManagedDraft,
): Promise<void> {
  validateStorageKey(storageKey)
  validateManagedDraft(draft)
  await runManagedDraftRequest('readwrite', (store) =>
    store.put(draft, storageKey),
  )
}

export async function removeManagedDraft(storageKey: string): Promise<void> {
  validateStorageKey(storageKey)
  await runManagedDraftRequest('readwrite', (store) => store.delete(storageKey))
}
