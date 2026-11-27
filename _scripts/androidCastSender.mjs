import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeCastSenderLicenses } from './castSender.mjs'
import { buildAndroidGo } from './goBuild.mjs'

const [output, ndk, abis, testRoot] = process.argv.slice(2)
if (!output || !ndk) throw new Error('Usage: androidCastSender.mjs OUTPUT NDK [ABIS] [TEST_ROOT_PEM]')
// The receiver integration test (androidCastReceiverTest.mjs) adds a temporary
// root that its open source receiver's device certificate chains to.
const build = testRoot
  ? { tags: 'casttestroot', linkerFlags: `-X main.castTestRoot=${readFileSync(testRoot).toString('base64')}` }
  : {}
const options = await buildAndroidGo(new URL('cast-sender/', import.meta.url), 'libopentubex_cast.so', output, ndk, abis, build)
// Use the same linked-module license bundle as the desktop sender.
await writeCastSenderLicenses(join(output, 'licenses'), options)
