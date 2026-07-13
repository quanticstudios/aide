import { createRequire } from 'node:module'

import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const { version: electronVersion } = require('electron/package.json')

await rebuild({
  buildPath: process.cwd(),
  electronVersion,
  force: true,
  mode: 'sequential',
  onlyModules: ['node-pty'],
  projectRootPath: process.cwd(),
})
