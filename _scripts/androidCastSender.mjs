import { join } from 'node:path'
import { writeCastSenderLicenses } from './castSender.mjs'
import { buildAndroidGo } from './goBuild.mjs'

const [output, ndk, abis] = process.argv.slice(2)
if (!output || !ndk) throw new Error('Usage: androidCastSender.mjs OUTPUT NDK [ABIS]')
const options = await buildAndroidGo(new URL('cast-sender/', import.meta.url), 'libopentubex_cast.so', output, ndk, abis)
// Use the same linked-module license bundle as the desktop sender.
await writeCastSenderLicenses(join(output, 'licenses'), options)
