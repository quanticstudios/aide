import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  type DiagnosticEvent,
  type DiagnosticEventType,
  type DiagnosticsRuntime,
  type DiagnosticsSnapshot,
  createSupportBundleFiles,
  isDiagnosticEventType,
  sanitizeDiagnosticsSnapshot,
} from '../shared/diagnostics'

const CURRENT_LOG_FILE = 'diagnostics.jsonl'
const MAX_RECENT_EVENTS = 25

export interface DiagnosticsServiceOptions {
  readonly logDirectory: string
  readonly maxLogBytes?: number
  readonly maxLogFiles?: number
  readonly now?: () => Date
  readonly onUpdate?: (snapshot: DiagnosticsSnapshot) => void
  readonly runtime: DiagnosticsRuntime
}

interface ZipEntry {
  readonly contents: Buffer
  readonly name: string
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff

  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getUTCFullYear())

  return {
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
  }
}

/** Writes a deliberately tiny, store-only ZIP archive to avoid a dependency. */
function createZipArchive(entries: readonly ZipEntry[], date: Date): Buffer {
  const { date: dosDate, time: dosTime } = toDosDateTime(date)
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const checksum = crc32(entry.contents)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(entry.contents.length, 18)
    local.writeUInt32LE(entry.contents.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, entry.contents)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(entry.contents.length, 20)
    central.writeUInt32LE(entry.contents.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + entry.contents.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, end])
}

export class DiagnosticsService {
  private readonly maxLogBytes: number
  private readonly maxLogFiles: number
  private readonly now: () => Date
  private readonly recentEvents: DiagnosticEvent[] = []
  private revision = 0

  public constructor(private readonly options: DiagnosticsServiceOptions) {
    this.maxLogBytes = options.maxLogBytes ?? 512 * 1024
    this.maxLogFiles = options.maxLogFiles ?? 4
    this.now = options.now ?? (() => new Date())
    mkdirSync(options.logDirectory, { mode: 0o700, recursive: true })
    this.recentEvents.push(...this.loadRecentEvents())
    this.revision = this.recentEvents.length
  }

  public getSnapshot(): DiagnosticsSnapshot {
    return sanitizeDiagnosticsSnapshot({
      generatedAt: this.now().toISOString(),
      recentEvents: this.recentEvents,
      revision: this.revision,
      runtime: this.options.runtime,
    })
  }

  public record(type: DiagnosticEventType): void {
    if (!isDiagnosticEventType(type)) {
      return
    }

    const event: DiagnosticEvent = {
      occurredAt: this.now().toISOString(),
      type,
    }

    this.recentEvents.push(event)
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.shift()
    }
    this.revision += 1
    this.appendLocalLog(event)
    this.options.onUpdate?.(this.getSnapshot())
  }

  public exportSupportBundle(destination: string): void {
    const files = createSupportBundleFiles(this.getSnapshot()).map((file) => ({
      contents: Buffer.from(file.contents, 'utf8'),
      name: file.name,
    }))

    const temporaryPath = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.partial-${randomUUID()}`,
    )

    try {
      writeFileSync(temporaryPath, createZipArchive(files, this.now()), {
        mode: 0o600,
      })
      renameSync(temporaryPath, destination)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  private appendLocalLog(event: DiagnosticEvent): void {
    const currentPath = path.join(this.options.logDirectory, CURRENT_LOG_FILE)
    const record = `${JSON.stringify(event)}\n`

    if (
      existsSync(currentPath) &&
      statSync(currentPath).size + Buffer.byteLength(record) > this.maxLogBytes
    ) {
      this.rotateLogs(currentPath)
    }

    writeFileSync(currentPath, record, { flag: 'a', mode: 0o600 })
  }

  private loadRecentEvents(): DiagnosticEvent[] {
    const fileNames = [
      ...Array.from(
        { length: Math.max(0, this.maxLogFiles - 1) },
        (_value, index) => `diagnostics.${this.maxLogFiles - index - 1}.jsonl`,
      ),
      CURRENT_LOG_FILE,
    ]
    const events: unknown[] = []

    for (const fileName of fileNames) {
      const filePath = path.join(this.options.logDirectory, fileName)
      if (!existsSync(filePath)) {
        continue
      }

      let contents: string
      try {
        contents = readFileSync(filePath, 'utf8')
      } catch {
        continue
      }

      for (const line of contents.split('\n')) {
        if (!line) continue
        try {
          events.push(JSON.parse(line))
        } catch {
          // A torn record is skipped rather than preventing older safe records.
        }
      }
    }

    return [
      ...sanitizeDiagnosticsSnapshot({
        generatedAt: this.now().toISOString(),
        recentEvents: events,
      }).recentEvents,
    ]
  }

  private rotateLogs(currentPath: string): void {
    for (let index = this.maxLogFiles - 1; index >= 1; index -= 1) {
      const source = path.join(
        this.options.logDirectory,
        `diagnostics.${index}.jsonl`,
      )
      const destination = path.join(
        this.options.logDirectory,
        `diagnostics.${index + 1}.jsonl`,
      )

      if (existsSync(source)) {
        if (index === this.maxLogFiles - 1) {
          rmSync(source)
        } else {
          renameSync(source, destination)
        }
      }
    }

    renameSync(
      currentPath,
      path.join(this.options.logDirectory, 'diagnostics.1.jsonl'),
    )
  }
}
