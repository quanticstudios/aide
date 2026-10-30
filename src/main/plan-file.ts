import { lstat, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

/** Writes the plan to a user-chosen path, refusing anything that resolves outside the workspace. */
export async function writePlanFile(
  workspaceRoot: string,
  filePath: string,
  plan: string,
): Promise<string> {
  const root = await realpath(workspaceRoot)
  const directory = await realpath(path.dirname(path.resolve(filePath)))
  const target = path.join(directory, path.basename(filePath))
  const existing = await lstat(target).catch(() => null)
  if (!isInsideRoot(root, target) || existing?.isSymbolicLink()) {
    throw new Error('Save the plan inside the workspace.')
  }
  await writeFile(target, plan.endsWith('\n') ? plan : `${plan}\n`, 'utf8')
  return target
}
