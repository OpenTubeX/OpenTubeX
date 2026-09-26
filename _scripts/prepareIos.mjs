import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { load } from 'js-yaml'

// Use existing human/AI translations for native permission prompts.
// iOS localizes InfoPlist.strings independently of the renderer's locale loader.
const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const projectPath = new URL('ios/App/App.xcodeproj/project.pbxproj', root)
const locales = JSON.parse(read('static/locales/activeLocales.json'))
let project = readFileSync(projectPath, 'utf8')
const references = []
const children = []
for (const [index, locale] of locales.entries()) {
  const human = load(read(`static/locales/${locale}.yaml`))
  let ai = {}
  try { ai = load(read(`static/locales/ai/${locale}.yaml`)) ?? {} } catch (error) { if (error.code !== 'ENOENT') throw error }
  const permissions = [
    ['NSCameraUsageDescription', 'Sync Settings', 'Pairing Scan Hint'],
    ['NSLocalNetworkUsageDescription', 'Categories', 'Sync Description']
  ].map(([permission, group, key]) => {
    const message = human?.Settings?.[group]?.[key] || ai?.Settings?.[group]?.[key]
    if (!message) throw new Error(`Missing ${permission} translation: ${locale}`)
    return `"${permission}" = ${JSON.stringify(message)};`
  })
  const directory = new URL(`ios/App/App/${locale}.lproj/`, root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('InfoPlist.strings', directory), `${permissions.join('\n')}\n`)
  const id = `A12791${index.toString(16).padStart(18, '0')}`.toUpperCase()
  references.push(`\t\t${id} = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = "${locale}"; path = "${locale}.lproj/InfoPlist.strings"; sourceTree = "<group>"; };`)
  children.push(id)
}
const start = '/* Begin iOS permission localizations */'
const end = '/* End iOS permission localizations */'
const generated = `${start}\n${references.join('\n')}\nA12790000000000000000031 = {isa = PBXVariantGroup; children = (${children.join(',')},); name = InfoPlist.strings; sourceTree = "<group>"; };\n${end}`
if (project.includes(start)) {
  project = project.slice(0, project.indexOf(start)) + generated + project.slice(project.indexOf(end) + end.length)
} else {
  project = project.replace('/* Begin PBXProject section */', `${generated}\n/* Begin PBXProject section */`)
  project = project.replace('/* End PBXBuildFile section */', 'A12790000000000000000032 = {isa = PBXBuildFile; fileRef = A12790000000000000000031; };\n/* End PBXBuildFile section */')
  project = project.replace('504EC3131FED79650016851F /* Info.plist */,', '504EC3131FED79650016851F /* Info.plist */,\nA12790000000000000000031,')
  project = project.replace('504EC30F1FED79650016851F /* Assets.xcassets in Resources */,', '504EC30F1FED79650016851F /* Assets.xcassets in Resources */,\nA12790000000000000000032,')
}
const { version } = JSON.parse(read('package.json'))
project = project.replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version.split('-')[0]};`)
// ManagedMediaSource and AbortSignal.any are required by playback and networking.
project = project.replaceAll(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 17.4;')
writeFileSync(projectPath, project)
