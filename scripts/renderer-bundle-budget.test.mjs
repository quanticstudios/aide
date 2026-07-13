import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkRendererBundleBudget,
  measureInitialRendererAssets,
} from './renderer-bundle-budget.mjs'

const temporaryDirectories = []

function createRendererOutput(indexHtml, assets) {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'aide-renderer-budget-'))
  temporaryDirectories.push(outputDirectory)

  writeFileSync(join(outputDirectory, 'index.html'), indexHtml)

  for (const [assetPath, contents] of Object.entries(assets)) {
    const path = join(outputDirectory, assetPath)
    const directory = path.slice(0, path.lastIndexOf('/'))

    if (directory) {
      mkdirSync(directory, { recursive: true })
    }

    writeFileSync(path, contents)
  }

  return outputDirectory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('renderer bundle budget', () => {
  it('counts only initial module and stylesheet assets from index.html', () => {
    const outputDirectory = createRendererOutput(
      `<!doctype html>
      <script type="module" src="./assets/index.js"></script>
      <link rel="modulepreload" href="./assets/vendor.js">
      <link rel="stylesheet" href="./assets/index.css">
      <script src="./assets/legacy.js"></script>`,
      {
        'assets/deferred.js': 'deferred-chunk',
        'assets/index.css': 'css',
        'assets/index.js': 'entry',
        'assets/legacy.js': 'legacy',
        'assets/vendor.js': 'vendor',
      },
    )

    expect(measureInitialRendererAssets(outputDirectory)).toEqual({
      css: {
        bytes: 3,
        files: ['assets/index.css'],
      },
      js: {
        bytes: 11,
        files: ['assets/index.js', 'assets/vendor.js'],
      },
    })
  })

  it('fails with both regression details when initial assets exceed their budgets', () => {
    const outputDirectory = createRendererOutput(
      `<!doctype html>
      <script type="module" src="./assets/index.js"></script>
      <link rel="stylesheet" href="./assets/index.css">`,
      {
        'assets/index.css': 'c'.repeat(1_234),
        'assets/index.js': 'j'.repeat(123_456),
      },
    )

    expect(() =>
      checkRendererBundleBudget({
        budget: { initialCssBytes: 1_000, initialJsBytes: 100_000 },
        outputDirectory,
      }),
    ).toThrow(/Initial renderer JS is 120.56 kB, exceeding the 97.66 kB budget/)
    expect(() =>
      checkRendererBundleBudget({
        budget: { initialCssBytes: 1_000, initialJsBytes: 100_000 },
        outputDirectory,
      }),
    ).toThrow(/Initial renderer CSS is 1.21 kB, exceeding the 1000 B budget/)
  })
})
