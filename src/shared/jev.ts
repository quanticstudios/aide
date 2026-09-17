export interface JevSettingsStatus {
  allowProcessing: boolean
  canStoreCredential: boolean
  hasCredential: boolean
}

export interface JevSettingsInput {
  allowProcessing: boolean
  apiKey?: string
}
