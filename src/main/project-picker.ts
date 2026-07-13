import path from 'node:path'

import type { BrowserWindow, OpenDialogOptions } from 'electron'

interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

interface DialogModuleLike {
  showOpenDialog: (
    browserWindow: BrowserWindow,
    options: OpenDialogOptions,
  ) => Promise<OpenDialogResult>
}

export async function pickProjectRoot(
  browserWindow: BrowserWindow,
  dialogModule: DialogModuleLike,
  defaultPath?: string | null,
): Promise<string | null> {
  const testPaths = process.env.AIDE_TEST_PROJECT_PICK_PATHS?.split(
    path.delimiter,
  ).filter(Boolean)

  if (testPaths?.length) {
    const [testPath, ...remainingPaths] = testPaths
    process.env.AIDE_TEST_PROJECT_PICK_PATHS = remainingPaths.join(
      path.delimiter,
    )
    return testPath ?? null
  }

  const testPath = process.env.AIDE_TEST_PROJECT_PICK_PATH?.trim()

  if (testPath) {
    return testPath
  }

  const result = await dialogModule.showOpenDialog(browserWindow, {
    defaultPath: defaultPath?.trim() || undefined,
    properties: ['openDirectory'],
    title: 'Open project folder',
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}
