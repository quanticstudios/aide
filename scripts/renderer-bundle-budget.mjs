import { readFileSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_RENDERER_BUDGET = {
  initialCssBytes: 535 * 1024,
  initialJsBytes: 1.25 * 1024 * 1024,
}

function isLocalOutputAsset(assetPath) {
  return !/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(assetPath)
}

function getAttribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function listInitialAssetPaths(indexHtml) {
  const assets = {
    css: new Set(),
    js: new Set(),
  }

  for (const tag of indexHtml.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const [markup, tagName] = tag
    const rel = getAttribute(markup, 'rel')?.toLowerCase().split(/\s+/) ?? []

    if (
      tagName.toLowerCase() === 'script' &&
      getAttribute(markup, 'type')?.toLowerCase() === 'module'
    ) {
      const source = getAttribute(markup, 'src')

      if (source && isLocalOutputAsset(source)) {
        assets.js.add(source)
      }
    }

    if (tagName.toLowerCase() === 'link' && rel.includes('modulepreload')) {
      const source = getAttribute(markup, 'href')

      if (source && isLocalOutputAsset(source)) {
        assets.js.add(source)
      }
    }

    if (tagName.toLowerCase() === 'link' && rel.includes('stylesheet')) {
      const source = getAttribute(markup, 'href')

      if (source && isLocalOutputAsset(source)) {
        assets.css.add(source)
      }
    }
  }

  return assets
}

function resolveAssetPath(outputDirectory, assetPath) {
  const assetPathWithoutQuery = assetPath.replace(/[?#].*$/, '')
  const localPath = assetPathWithoutQuery.startsWith('/')
    ? assetPathWithoutQuery.slice(1)
    : assetPathWithoutQuery
  const resolvedPath = resolve(outputDirectory, localPath)
  const pathFromOutput = relative(outputDirectory, resolvedPath)

  if (pathFromOutput.startsWith('..') || pathFromOutput === '') {
    throw new Error(
      `Initial asset must be inside ${outputDirectory}: ${assetPath}`,
    )
  }

  return { file: pathFromOutput, path: resolvedPath }
}

function measureAssets(outputDirectory, assetPaths) {
  const assets = [...assetPaths]
    .map((assetPath) => resolveAssetPath(outputDirectory, assetPath))
    .sort((a, b) => a.file.localeCompare(b.file))

  return {
    bytes: assets.reduce(
      (total, asset) => total + statSync(asset.path).size,
      0,
    ),
    files: assets.map((asset) => asset.file),
  }
}

export function measureInitialRendererAssets(outputDirectory) {
  const resolvedOutputDirectory = resolve(outputDirectory)
  const indexHtml = readFileSync(
    resolve(resolvedOutputDirectory, 'index.html'),
    'utf8',
  )
  const initialAssetPaths = listInitialAssetPaths(indexHtml)

  return {
    css: measureAssets(resolvedOutputDirectory, initialAssetPaths.css),
    js: measureAssets(resolvedOutputDirectory, initialAssetPaths.js),
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${(bytes / 1024).toFixed(2)} kB`
}

export function checkRendererBundleBudget({
  budget = DEFAULT_RENDERER_BUDGET,
  outputDirectory,
}) {
  const measurements = measureInitialRendererAssets(outputDirectory)
  const failures = []

  if (measurements.js.bytes > budget.initialJsBytes) {
    failures.push(
      `Initial renderer JS is ${formatBytes(measurements.js.bytes)}, exceeding the ${formatBytes(budget.initialJsBytes)} budget.`,
    )
  }

  if (measurements.css.bytes > budget.initialCssBytes) {
    failures.push(
      `Initial renderer CSS is ${formatBytes(measurements.css.bytes)}, exceeding the ${formatBytes(budget.initialCssBytes)} budget.`,
    )
  }

  if (failures.length > 0) {
    throw new Error(failures.join(' '))
  }

  return measurements
}

function run() {
  const outputDirectory = process.argv[2] ?? 'out/renderer'
  const measurements = checkRendererBundleBudget({ outputDirectory })

  console.log(
    `Initial renderer assets: JS ${formatBytes(measurements.js.bytes)} (${measurements.js.files.join(', ')}) | CSS ${formatBytes(measurements.css.bytes)} (${measurements.css.files.join(', ')})`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run()
}
