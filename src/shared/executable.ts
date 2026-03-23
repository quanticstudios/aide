export interface ExecutableValidationSuccess {
  ok: true
  path: string
}

export interface ExecutableValidationFailure {
  error: string
  ok: false
}

export type ExecutableValidationResult =
  | ExecutableValidationFailure
  | ExecutableValidationSuccess

export interface ExecutableProbeSuccess {
  ok: true
  output: string
  path: string
}

export interface ExecutableProbeFailure {
  error: string
  ok: false
}

export type ExecutableProbeResult =
  | ExecutableProbeFailure
  | ExecutableProbeSuccess

export interface ExecutableProbeInput {
  args?: string[]
  command: string
}
