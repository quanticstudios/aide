import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  ExecutableProbeResult,
  ExecutableValidationResult,
} from '../shared/executable'

const execFileAsync = promisify(execFile)

interface ResolveExecutableOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

interface ProbeExecutableOptions {
  args?: string[]
  cwd?: string
  timeoutMs?: number
}

function looksLikePath(value: string): boolean {
  return (
    value.startsWith('.') ||
    value.includes('/') ||
    value.includes('\\') ||
    path.isAbsolute(value)
  )
}

async function ensureExecutable(filePath: string): Promise<void> {
  try {
    await access(
      filePath,
      process.platform === 'win32' ? constants.F_OK : constants.X_OK,
    )
  } catch {
    const message =
      process.platform === 'win32'
        ? `Configured executable "${filePath}" does not exist.`
        : `Configured executable "${filePath}" is missing or not executable.`

    throw new Error(message)
  }
}

function getPathCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') {
    return [command]
  }

  const pathExt = (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .filter(Boolean)
  const hasExtension = path.extname(command).length > 0

  if (hasExtension) {
    return [command]
  }

  return pathExt.map((extension) => `${command}${extension.toLowerCase()}`)
}

export async function resolveExecutablePath(
  input: string,
  options: ResolveExecutableOptions = {},
): Promise<string> {
  const env = options.env ?? process.env
  const trimmedInput = input.trim()

  if (!trimmedInput) {
    throw new Error('Configured executable path is required.')
  }

  if (looksLikePath(trimmedInput)) {
    const resolvedPath = path.isAbsolute(trimmedInput)
      ? trimmedInput
      : path.resolve(options.cwd ?? process.cwd(), trimmedInput)

    await ensureExecutable(resolvedPath)
    return resolvedPath
  }

  const pathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean)

  for (const pathEntry of pathEntries) {
    for (const candidate of getPathCandidates(trimmedInput, env)) {
      const candidatePath = path.join(pathEntry, candidate)

      try {
        await ensureExecutable(candidatePath)
        return candidatePath
      } catch {}
    }
  }

  throw new Error(
    `Configured executable "${trimmedInput}" was not found in PATH.`,
  )
}

export async function validateExecutablePath(
  input: string,
  options: ResolveExecutableOptions = {},
): Promise<ExecutableValidationResult> {
  try {
    const resolvedPath = await resolveExecutablePath(input, options)

    return {
      ok: true,
      path: resolvedPath,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Executable validation failed.',
      ok: false,
    }
  }
}

export async function probeExecutable(
  input: string,
  options: ProbeExecutableOptions = {},
): Promise<ExecutableProbeResult> {
  try {
    const resolvedPath = await resolveExecutablePath(input, {
      cwd: options.cwd,
    })
    const result = await execFileAsync(
      resolvedPath,
      options.args ?? ['--version'],
      {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 5000,
      },
    )
    const output = `${result.stdout}${result.stderr}`.trim()

    return {
      ok: true,
      output,
      path: resolvedPath,
    }
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'Executable probe failed.',
      ok: false,
    }
  }
}
