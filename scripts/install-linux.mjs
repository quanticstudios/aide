import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageLinux } from './package-linux.mjs'

const root = resolve(import.meta.dirname, '..')

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`
const desktopQuote = (value) =>
  `"${value
    .replace(/[\\"$`]/g, '\\$&')
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '%%')}"`

async function replaceFile(destination, write) {
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  try {
    await write(temporary)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function installLinux(
  appImage,
  {
    home = homedir(),
    dataHome = process.env.XDG_DATA_HOME || join(home, '.local/share'),
  } = {},
) {
  if (process.platform !== 'linux')
    throw new Error('Desktop installation requires Linux.')
  for (const directory of [home, dataHome]) {
    if (!isAbsolute(directory) || /[\r\n\0]/.test(directory)) {
      throw new Error(
        'Installation directories must be absolute paths without line breaks.',
      )
    }
  }
  const file = await open(appImage, 'r')
  try {
    const header = Buffer.alloc(11)
    await file.read(header, 0, header.length, 0)
    if (
      !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))
    ) {
      throw new Error('Expected a type 2 AppImage executable.')
    }
  } finally {
    await file.close()
  }

  const installedImage = join(dataHome, 'aide/Aide.AppImage')
  const launcher = join(home, '.local/bin/aide')
  const desktopFile = join(dataHome, 'applications/aide.desktop')
  const icon = join(dataHome, 'aide/icon.png')
  await replaceFile(icon, (temporary) =>
    copyFile(join(root, 'build/icon.png'), temporary),
  )
  await replaceFile(installedImage, async (temporary) => {
    await copyFile(appImage, temporary)
    await chmod(temporary, 0o755)
  })
  await replaceFile(launcher, (temporary) =>
    writeFile(
      temporary,
      `#!/bin/sh
set -e
config_home="\${XDG_CONFIG_HOME:-$HOME/.config}"
if [ -r "$config_home/aide/launch-env" ]; then
  . "$config_home/aide/launch-env"
fi
exec ${shellQuote(installedImage)} "$@"
`,
      { mode: 0o755 },
    ),
  )
  await replaceFile(desktopFile, (temporary) =>
    writeFile(
      temporary,
      `[Desktop Entry]
Type=Application
Name=aIDE
Comment=AI coding workspaces
Exec=${desktopQuote(launcher)} %U
Icon=${icon.replaceAll('\\', '\\\\')}
Terminal=false
Categories=Development;IDE;
StartupWMClass=aide
`,
      { mode: 0o644 },
    ),
  )
  return { installedImage, launcher, desktopFile }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let appImage = process.argv[2]
  if (!appImage) {
    const output = join(root, 'dist/local-install')
    await packageLinux(output, { appImageOnly: true })
    const images = (await readdir(output)).filter((name) =>
      name.endsWith('.AppImage'),
    )
    if (images.length !== 1)
      throw new Error('Expected exactly one built AppImage.')
    appImage = join(output, images[0])
  }
  const installed = await installLinux(resolve(appImage))
  const refresh = spawnSync(
    'update-desktop-database',
    [dirname(installed.desktopFile)],
    { stdio: 'inherit' },
  )
  if (refresh.error || refresh.status !== 0)
    console.warn(
      'Desktop cache refresh unavailable; the launcher is installed.',
    )
  console.log(
    `Installed ${installed.installedImage}\nLauncher: ${installed.desktopFile}\nClose Aide and reopen it to use this build.`,
  )
}
