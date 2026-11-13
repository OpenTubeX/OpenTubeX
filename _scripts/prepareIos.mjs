import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homeWidgetStrings, loadTranslator, locales, root } from './nativeTranslations.mjs'

// iOS localizes InfoPlist.strings and the widget extension independently of the renderer's locale loader.
const read = path => readFileSync(new URL(path, root), 'utf8')
const projectPath = new URL('ios/App/App.xcodeproj/project.pbxproj', root)
let project = readFileSync(projectPath, 'utf8')
const references = []
const children = []
const widgetReferences = []
const widgetChildren = []
// The widget extension's SwiftUI strings use the en-US messages as their keys.
const translateEnglish = loadTranslator('en-US')
for (const [index, locale] of locales.entries()) {
  const translate = loadTranslator(locale)
  const permissions = [
    ['NSCameraUsageDescription', 'Settings', 'Sync Settings', 'Pairing Scan Hint'],
    ['NSLocalNetworkUsageDescription', 'Native Permissions', 'Local Network']
  ].map(([permission, ...path]) => `"${permission}" = ${JSON.stringify(translate(...path))};`)
  const directory = new URL(`ios/App/App/${locale}.lproj/`, root)
  mkdirSync(directory, { recursive: true })
  writeFileSync(new URL('InfoPlist.strings', directory), `${permissions.join('\n')}\n`)
  const id = `A12791${index.toString(16).padStart(18, '0')}`.toUpperCase()
  references.push(`\t\t${id} = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = "${locale}"; path = "${locale}.lproj/InfoPlist.strings"; sourceTree = "<group>"; };`)
  children.push(id)

  const widgetStrings = Object.values(homeWidgetStrings)
    .map(key => `${JSON.stringify(translateEnglish('Home Widgets', key))} = ${JSON.stringify(translate('Home Widgets', key))};`)
  const widgetDirectory = new URL(`ios/App/OpenTubeXWidgets/${locale}.lproj/`, root)
  mkdirSync(widgetDirectory, { recursive: true })
  writeFileSync(new URL('Localizable.strings', widgetDirectory), `${widgetStrings.join('\n')}\n`)
  const widgetId = `E1D6E8${index.toString(16).padStart(18, '0')}`.toUpperCase()
  widgetReferences.push(`${widgetId} = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = "${locale}"; path = "${locale}.lproj/Localizable.strings"; sourceTree = "<group>"; };`)
  widgetChildren.push(widgetId)
}
const widgetStart = '/* Begin iOS widget localizations */'
const widgetEnd = '/* End iOS widget localizations */'
if (!project.includes(widgetStart)) throw new Error('Unable to localize iOS widgets: missing project markers')
project = project.slice(0, project.indexOf(widgetStart)) +
  `${widgetStart}\n${widgetReferences.join('\n')}\nE1D6E7000000000000000008 /* Localizable.strings */ = {isa = PBXVariantGroup; children = (${widgetChildren.join(',')},); name = Localizable.strings; sourceTree = "<group>"; };\n${widgetEnd}` +
  project.slice(project.indexOf(widgetEnd) + widgetEnd.length)
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
// The widget extension's identifier and App Group derive from the app's.
let configuredWidgets = false
project = project.replace(/(E1D6E7000000000000000043 \/\* Release \*\/ = \{[\s\S]*?buildSettings = \{)([\s\S]*?)(\n\t\t\t\};)/, (match, start, settings, end) => {
  if (!/APP_BUNDLE_IDENTIFIER = [^;]+;/.test(settings) || !/APP_URL_SCHEME = [^;]+;/.test(settings)) {
    throw new Error('Unable to configure iOS Release identity: missing widget build settings')
  }
  configuredWidgets = true
  return start + settings
    .replace(/APP_BUNDLE_IDENTIFIER = [^;]+;/, `APP_BUNDLE_IDENTIFIER = ${appId};`)
    .replace(/APP_URL_SCHEME = [^;]+;/, `APP_URL_SCHEME = ${appUrlScheme};`) + end
})
if (!configuredWidgets) throw new Error('Unable to configure iOS Release identity: missing widget Release configuration')
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
