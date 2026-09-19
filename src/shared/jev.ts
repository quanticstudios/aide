export interface JevSettingsStatus {
  allowProcessing: boolean
  canStoreCredential: boolean
  hasCredential: boolean
}

export interface JevSettingsInput {
  allowProcessing: boolean
  apiKey?: string
}

/** Sends are blocked with this message until the workspace allows TypeSafe processing. */
export const JEV_CONSENT_REQUIRED_MESSAGE =
  'Allow TypeSafe processing for this workspace in Settings before sending a message.'

/** Sends are blocked with this message until a TypeSafe credential is available. */
export const JEV_CREDENTIAL_REQUIRED_MESSAGE =
  'Add a TypeSafe API key in Settings before sending a message.'
