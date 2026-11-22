import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

function findFinishArgs (manifest, label) {
  const lines = manifest.split('\n')
  const start = lines.findIndex((line) => /^finish-args:\s*$/.test(line))

  if (start === -1) {
    throw new Error(`${label} has no top-level finish-args block`)
  }

  let end = start + 1
  while (end < lines.length && !/^\S/.test(lines[end])) {
    end += 1
  }

  const args = []
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(/^\s+-\s+(--\S.*?)\s*$/)

    if (match) {
      args.push(match[1])
    } else if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
      throw new Error(`${label} has an unsupported finish-args entry: ${line.trim()}`)
    }
  }

  if (args.length === 0) {
    throw new Error(`${label} has an empty finish-args block`)
  }

  return { args, end, lines, start }
}

export function syncFlatpakFinishArgs (officialManifest, flatparkManifest) {
  const official = findFinishArgs(officialManifest, 'Official Flatpak manifest')
  const flatpark = findFinishArgs(flatparkManifest, 'FlatPark manifest')
  const finishArgs = official.args.map((arg) => `  - ${arg}`)

  flatpark.lines.splice(
    flatpark.start + 1,
    flatpark.end - flatpark.start - 1,
    ...finishArgs
  )

  return flatpark.lines.join('\n')
}

async function main () {
  const [officialPath, flatparkPath] = process.argv.slice(2)

  if (!officialPath || !flatparkPath) {
    throw new Error('Usage: syncFlatpakFinishArgs.mjs OFFICIAL_MANIFEST FLATPARK_MANIFEST')
  }

  const [officialManifest, flatparkManifest] = await Promise.all([
    readFile(officialPath, 'utf8'),
    readFile(flatparkPath, 'utf8')
  ])

  const updatedManifest = syncFlatpakFinishArgs(
    officialManifest,
    flatparkManifest
  )

  if (updatedManifest !== flatparkManifest) {
    await writeFile(flatparkPath, updatedManifest)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
