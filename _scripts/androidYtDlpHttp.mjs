import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildAndroidGo, readGoDependencyLicenses } from './goBuild.mjs'

const [output, ndk, abis] = process.argv.slice(2)
if (!output || !ndk) throw new Error('Usage: androidYtDlpHttp.mjs OUTPUT NDK [ABIS]')
const options = await buildAndroidGo(new URL('yt-dlp-http/', import.meta.url), 'libopentubex_rumble_http.so', output, ndk, abis)
const licenses = await readGoDependencyLicenses(options)
await mkdir(join(output, 'licenses'), { recursive: true })
await writeFile(join(output, 'licenses', 'rumble-http-licenses.txt'), licenses.join('\n\n'))
