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
    ['NSCameraUsageDescription', 'Settings', 'Sync Settings', 'Pairing Scan Hint'],
    ['NSLocalNetworkUsageDescription', 'Native Permissions', 'Local Network']
  ].map(([permission, ...path]) => {
    const message = path.reduce((value, key) => value?.[key], human) || path.reduce((value, key) => value?.[key], ai)
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
const isNightly = /-nightly-\d+$/.test(version)
const appId = isNightly ? 'org.opentubex.app.nightly' : 'org.opentubex.app'
const appName = isNightly ? 'OpenTubeX Nightly' : 'OpenTubeX'
const appUrlScheme = isNightly ? 'opentubex-nightly' : 'opentubex'
// Only the app's Release configuration changes; Debug keeps its Dev identity.
let configuredRelease = false
project = project.replace(/(504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?buildSettings = \{)([\s\S]*?)(\n\t\t\t\};)/, (match, start, settings, end) => {
  if (!/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/.test(settings) ||
      !/APP_DISPLAY_NAME = [^;]+;/.test(settings) ||
      !/APP_URL_SCHEME = [^;]+;/.test(settings)) {
    throw new Error('Unable to configure iOS Release identity: missing build settings')
  }
  const updated = settings
    .replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/, `PRODUCT_BUNDLE_IDENTIFIER = ${appId};`)
    .replace(/APP_DISPLAY_NAME = [^;]+;/, `APP_DISPLAY_NAME = "${appName}";`)
    .replace(/APP_URL_SCHEME = [^;]+;/, `APP_URL_SCHEME = ${appUrlScheme};`)
  configuredRelease = true
  return start + updated + end
})
if (!configuredRelease) throw new Error('Unable to configure iOS Release identity: missing Release configuration')
const configPath = new URL('ios/App/App/capacitor.config.json', root)
const config = JSON.parse(readFileSync(configPath, 'utf8'))
config.appId = appId
config.appName = appName
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
project = project.replaceAll(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version.split('-')[0]};`)
// ManagedMediaSource and AbortSignal.any are required by playback and networking.
project = project.replaceAll(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 17.4;')
writeFileSync(projectPath, project)

// Capacitor regenerates this package during sync. Reapply the native dependency.
const packagePath = new URL('ios/App/CapApp-SPM/Package.swift', root)
let capacitorPackage = readFileSync(packagePath, 'utf8')
capacitorPackage = capacitorPackage.replace('platforms: [.iOS(.v17)]', 'platforms: [.iOS("17.4")]')
const ffmpegPackage = '.package(name: "OpenTubeXFFmpeg", path: "../FFmpegKit")'
const ffmpegProduct = '.product(name: "OpenTubeXFFmpeg", package: "OpenTubeXFFmpeg")'
if (!capacitorPackage.includes(ffmpegPackage)) {
  capacitorPackage = capacitorPackage.replace('\n    dependencies: [', `\n    dependencies: [\n        ${ffmpegPackage},`)
}
if (!capacitorPackage.includes(ffmpegProduct)) {
  capacitorPackage = capacitorPackage.replace('\n            dependencies: [\n                .product', `\n            dependencies: [\n                ${ffmpegProduct},\n                .product`)
}
if (!capacitorPackage.includes(ffmpegPackage) || !capacitorPackage.includes(ffmpegProduct)) {
  throw new Error('Unable to configure the Capacitor Swift package for FFmpegKit')
}
writeFileSync(packagePath, capacitorPackage)
