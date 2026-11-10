// Builds libwebp for FFmpeg with the app's NDK, which aligns 64-bit libraries
// for 16 KB pages. youtubedl-android's copies are 4 KB aligned, so they cannot
// load on 16 KB page devices and stop FFmpeg from starting.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const [output, ndk, abis, version, sha256, minSdk] = process.argv.slice(2)
if (!minSdk) throw new Error('Usage: androidLibwebp.mjs OUTPUT NDK ABIS VERSION SHA256 MIN_SDK')

const url = `https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${version}.tar.gz`
const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
if (!response.ok) throw new Error(`Downloading ${url} failed with HTTP ${response.status}`)
const archive = Buffer.from(await response.arrayBuffer())
const hash = createHash('sha256').update(archive).digest('hex')
if (hash !== sha256) throw new Error(`libwebp ${version} has SHA-256 ${hash}, expected ${sha256}`)

const work = await mkdtemp(join(tmpdir(), 'opentubex-libwebp-'))
try {
  await writeFile(join(work, 'libwebp.tar.gz'), archive)
  await execFileAsync('tar', ['-xzf', 'libwebp.tar.gz'], { cwd: work })
  const source = join(work, `libwebp-${version}`)
  await rm(output, { recursive: true, force: true })
  // libwebp's own ndk-build script names the libraries as FFmpeg links them
  // (libwebp.so, libwebpmux.so) and includes sharpyuv in libwebp.so.
  await execFileAsync(join(ndk, 'ndk-build'), [
    `-j${availableParallelism()}`,
    'NDK_PROJECT_PATH=null',
    `APP_BUILD_SCRIPT=${join(source, 'Android.mk')}`,
    `NDK_OUT=${join(work, 'obj')}`,
    `NDK_LIBS_OUT=${join(output, 'jniLibs')}`,
    `APP_ABI=${abis.split(',').join(' ')}`,
    `APP_PLATFORM=android-${minSdk}`,
    'APP_OPTIM=release',
    // The build ID hashes debug information, so keep build paths out of it for
    // F-Droid's reproducible rebuild. Clang reports NDK headers by resolved path.
    `APP_CFLAGS=-ffile-prefix-map=${work}=/libwebp -ffile-prefix-map=${ndk}=/ndk -ffile-prefix-map=${await realpath(ndk)}=/ndk`,
    'APP_MODULES=webp webpmux',
    'ENABLE_SHARED=1'
  ], { cwd: work, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 })
  await mkdir(join(output, 'licenses'), { recursive: true })
  const licenses = await Promise.all(['COPYING', 'PATENTS'].map(file => readFile(join(source, file), 'utf8')))
  await writeFile(join(output, 'licenses', 'libwebp-licenses.txt'), `libwebp ${version}\n\n${licenses.join('\n\n')}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
