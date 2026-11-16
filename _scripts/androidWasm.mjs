// Builds the WebAssembly modules of the Android app from source, so F-Droid
// and the published APKs ship the same files: QuickJS for YouTube's player
// script and the JPEG XL encoder for screenshots. The npm packages only
// contain prebuilt WebAssembly, which F-Droid rejects.
//
//   node _scripts/androidWasm.mjs check   compare the pins with node_modules
//   node _scripts/androidWasm.mjs fetch   download and unpack the pinned sources
//   node _scripts/androidWasm.mjs build   compile them into build/android-wasm/out
//   node _scripts/androidWasm.mjs docker  run fetch and build in Debian trixie
//
// build needs Debian trixie's emscripten (see DEBIAN_PACKAGES). F-Droid scans
// the sources between fetch and build. rspack.capacitor.config.js bundles the
// output when ANDROID_WASM_FROM_SOURCE is set.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(repo, 'build/android-wasm')
const sources = join(root, 'src')
const output = join(root, 'out')

const DEBIAN_PACKAGES = ['emscripten=3.1.69+dfsg-3', 'make', 'cmake', 'nodejs', 'ca-certificates']

// The npm packages these sources replace, at the versions they were built from.
const PACKAGES = {
  '@jitl/quickjs-wasmfile-release-sync': '0.32.0',
  '@jsquash/jxl': '1.3.0'
}

const github = (repository, ref) => `https://github.com/${repository}/archive/${ref}.tar.gz`
const ARCHIVES = [
  {
    directory: 'quickjs-emscripten',
    url: github('justjake/quickjs-emscripten', 'refs/tags/v0.32.0'),
    sha256: 'cf3f2aa0d27ab3be9c1599682c2815de6ad8e9498daeca6eecd2434850b6c4b1',
    paths: ['c', 'vendor/quickjs', 'templates', 'exportedRuntimeMethods.json', 'LICENSE']
  },
  {
    directory: 'jsquash',
    url: github('jamsinclair/jSquash', '1338a8896bffcfe99790ca60d4562ea6dd80abdd'),
    sha256: '6eb58dcc6e2c924ace917c57cc7320595502c3d7a259ec4757c6b8fd6d230fae',
    paths: ['packages/jxl/codec/enc/jxl_enc.cpp', 'packages/jxl/codec/pre.js', 'LICENSE']
  },
  {
    // jSquash's packages/jxl/codec/Makefile builds this libjxl commit with
    // these submodules.
    directory: 'libjxl',
    url: github('libjxl/libjxl', '9f544641ec83f6abd9da598bdd08178ee8a003e0'),
    sha256: '470c9f555aea620503ab1cc3a959024d7c1c1172f6b94d7de56f47a81bf8d16a',
    exclude: ['testdata', 'third_party/HEVCSoftware']
  },
  {
    directory: 'libjxl/third_party/brotli',
    url: github('google/brotli', '35ef5c554d888bef217d449346067de05e269b30'),
    sha256: 'e3142f57bedc51eb75256ff265698a4e8c944282b96888b5aa1cb33fe9378cc8',
    // Their test data includes binaries, which F-Droid's scanner rejects.
    exclude: ['tests', 'java', 'c/common/dictionary.bin.br']
  },
  {
    directory: 'libjxl/third_party/highway',
    url: github('google/highway', 'e69083a12a05caf037cabecdf1b248b7579705a5'),
    sha256: '83e36f69e5deae3a1ada97f40b13c743d21fb167db249f22d1035caf8bed63dc'
  },
  {
    directory: 'libjxl/third_party/skcms',
    url: github('google/skcms', '64374756e03700d649f897dbd98c95e78c30c7da'),
    sha256: 'd28ff68c49a4946b29d76d03d75414895f4dd897ca42be6d304ec24b9f539fe1'
  },
  {
    // libjxl's Emscripten build requires the headers but does not link them.
    directory: 'libjxl/third_party/libpng',
    url: github('glennrp/libpng', 'a40189cf881e9f0db80511c382292a5604c3c3d1'),
    sha256: 'ed747514984fddf095142aa85e983111f13d64b877b1065ed0d990f7adb31eb7'
  },
  {
    directory: 'libjxl/third_party/zlib',
    url: github('madler/zlib', 'cacf7f1d4e3d44d871b605da3b647f07d718623f'),
    sha256: '6d4d6640ca3121620995ee255945161821218752b551a1a180f4215f7d124d45'
  }
]

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, { maxBuffer: 256 * 1024 * 1024, ...options })
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed\n${error.stdout ?? ''}${error.stderr ?? ''}`, { cause: error })
  }
}

async function check() {
  for (const [name, version] of Object.entries(PACKAGES)) {
    const { version: installed } = JSON.parse(await readFile(join(repo, 'node_modules', name, 'package.json'), 'utf8'))
    if (installed !== version) {
      throw new Error(`${name} is ${installed}, but _scripts/androidWasm.mjs builds ${version}. Update its sources.`)
    }
  }
}

async function fetchSources() {
  await check()
  await rm(sources, { recursive: true, force: true })
  const work = join(root, 'download')
  for (const archive of ARCHIVES) {
    const response = await fetch(archive.url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`Downloading ${archive.url} failed with HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    const hash = createHash('sha256').update(data).digest('hex')
    if (hash !== archive.sha256) throw new Error(`${archive.url} has SHA-256 ${hash}, expected ${archive.sha256}`)

    await rm(work, { recursive: true, force: true })
    await mkdir(join(work, 'unpacked'), { recursive: true })
    await writeFile(join(work, 'source.tar.gz'), data)
    // Extract only what the build needs; the jSquash repository also commits its prebuilt WebAssembly.
    const filters = archive.paths ? ['--wildcards', '--no-wildcards-match-slash', ...archive.paths.map(path => `*/${path}`)] : []
    const excludes = (archive.exclude ?? []).map(path => `--exclude=*/${path}`)
    await run('tar', ['-xzf', join(work, 'source.tar.gz'), '-C', join(work, 'unpacked'), ...excludes, ...filters])
    const [top] = await readdir(join(work, 'unpacked'))
    const destination = join(sources, archive.directory)
    await rm(destination, { recursive: true, force: true })
    await mkdir(dirname(destination), { recursive: true })
    await rename(join(work, 'unpacked', top), destination)
  }
  await rm(work, { recursive: true, force: true })
}

async function buildQuickjs(env) {
  const source = join(sources, 'quickjs-emscripten')
  const build = join(root, 'build/quickjs')
  await mkdir(build, { recursive: true })
  // The exports that upstream's scripts/generate.ts lists for the sync variant.
  const interfaceCode = await readFile(join(source, 'c/interface.c'), 'utf8')
  const symbols = [...interfaceCode.matchAll(/^([\w()* ]+[\s*]+)(QTS_\w+)(\((.*?)\)) ?{$/gm)]
    .filter(([, type]) => !/\b(AsyncifyOnly|DebugOnly)\(/.test(type))
    .map(([, , name]) => `_${name}`)
  await writeFile(join(build, 'symbols.json'), JSON.stringify([...symbols, '_malloc', '_free']))

  // The browser build flags of upstream's variant-quickjs-wasmfile-release-sync
  // Makefile, without --closure, which Debian's emscripten does not include.
  const flags = [
    '-s', 'MODULARIZE=1', '-s', 'IMPORTED_MEMORY=1', '-s', 'EXPORT_NAME=QuickJSRaw', '-s', 'INVOKE_RUN=0',
    '-s', 'ALLOW_MEMORY_GROWTH=1', '-s', 'ALLOW_TABLE_GROWTH=1', '-s', 'STACK_SIZE=5MB', '-s', 'SUPPORT_ERRNO=0',
    '-s', 'IGNORE_MISSING_MAIN=0', '--no-entry', '-s', 'AUTO_JS_LIBRARIES=0', '-lccall.js',
    '-s', 'AUTO_NATIVE_LIBRARIES=0', '-s', 'AUTO_ARCHIVE_INDEXES=0', '-s', 'DEFAULT_TO_CXX=0',
    '-s', 'ALLOW_UNIMPLEMENTED_SYSCALLS=0',
    '-s', `EXPORTED_RUNTIME_METHODS=@${join(source, 'exportedRuntimeMethods.json')}`,
    '-Oz', '-flto', '-s', 'FILESYSTEM=0',
    '--pre-js', join(source, 'templates/pre-extension.js'), '--pre-js', join(source, 'templates/pre-wasmMemory.js'),
    '-s', 'EXPORT_ES6=1', '-s', 'ENVIRONMENT=web,worker'
  ]
  const version = (await readFile(join(source, 'vendor/quickjs/VERSION'), 'utf8')).trim()
  const quickjs = ['quickjs', 'dtoa', 'libregexp', 'libunicode', 'cutils', 'quickjs-libc']
  await Promise.all([
    ...quickjs.map(name => run('emcc', [...flags, '-D_GNU_SOURCE', `-DCONFIG_VERSION="${version}"`, '-DCONFIG_STACK_CHECK',
      '-c', '-o', join(build, `${name}.o`), join(source, `vendor/quickjs/${name}.c`)], { env })),
    run('emcc', [...flags, '-Wcast-function-type', '-c', '-o', join(build, 'interface.o'), join(source, 'c/interface.c')], { env })
  ])
  await mkdir(join(output, 'quickjs'), { recursive: true })
  await run('emcc', [...flags, '-Wcast-function-type', '-s', `EXPORTED_FUNCTIONS=@${join(build, 'symbols.json')}`,
    '-o', join(output, 'quickjs/emscripten-module.mjs'), join(build, 'interface.o'),
    ...quickjs.map(name => join(build, `${name}.o`))], { env })
  await copyFile(join(source, 'LICENSE'), join(output, 'quickjs/LICENSE'))
}

async function buildJxl(env) {
  const libjxl = join(sources, 'libjxl')
  const codec = join(sources, 'jsquash/packages/jxl/codec')
  const build = join(root, 'build/libjxl')
  const skcms = join(libjxl, 'third_party/skcms')
  // The settings of jSquash's tools/cpp.Dockerfile and packages/jxl/codec/Makefile.
  const cflags = ['-O3', '-flto']
  const cxxflags = [...cflags, '-std=c++17', '-Wno-deprecated-declarations']
  const ldflags = [...cflags, '-s', 'PTHREAD_POOL_SIZE=navigator.hardwareConcurrency', '-s', 'FILESYSTEM=0',
    '-s', 'ALLOW_MEMORY_GROWTH=1', '-s', 'TEXTDECODER=0']
  const jxlEnv = { ...env, CFLAGS: cflags.join(' '), CXXFLAGS: cxxflags.join(' '), LDFLAGS: ldflags.join(' ') }
  await run('emcmake', ['cmake', '-DBUILD_SHARED_LIBS=0', '-DJPEGXL_ENABLE_BENCHMARK=0', '-DJPEGXL_ENABLE_EXAMPLES=0',
    '-DBUILD_TESTING=0', '-DCMAKE_CROSSCOMPILING_EMULATOR=node',
    // The encoder only links libjxl, so skip the parts that need more sources.
    '-DJPEGXL_ENABLE_TOOLS=0', '-DJPEGXL_ENABLE_SJPEG=0', '-DJPEGXL_ENABLE_OPENEXR=0', '-DJPEGXL_ENABLE_JNI=0',
    '-DJPEGXL_ENABLE_MANPAGES=0', '-B', build, libjxl], { env: jxlEnv })
  await run('emmake', ['make', '-C', build, `-j${availableParallelism()}`, 'jxl-static'], { env: jxlEnv })
  await run('emcc', ['-Wall', '-O3', '-o', join(build, 'skcms.cc.o'), `-I${skcms}`, '-c', join(skcms, 'skcms.cc')], { env: jxlEnv })
  await run('emar', ['rc', join(build, 'third_party/libskcms.a'), join(build, 'skcms.cc.o')], { env: jxlEnv })
  await mkdir(join(output, 'jxl'), { recursive: true })
  await run('em++', [...cxxflags, ...ldflags,
    '-I', libjxl, '-I', join(libjxl, 'lib'), '-I', join(libjxl, 'lib/include'), '-I', join(build, 'lib/include'),
    '-I', join(libjxl, 'third_party/highway'), '-I', skcms,
    '--pre-js', join(codec, 'pre.js'), '--bind', '-s', 'ENVIRONMENT=web,worker', '-s', 'EXPORT_ES6=1',
    '-s', 'DYNAMIC_EXECUTION=0', '-s', 'MODULARIZE=1', '-o', join(output, 'jxl/jxl_enc.js'),
    join(codec, 'enc/jxl_enc.cpp'), join(build, 'lib/libjxl.a'),
    ...['libbrotlidec-static.a', 'libbrotlienc-static.a', 'libbrotlicommon-static.a'].map(lib => join(build, 'third_party/brotli', lib)),
    join(build, 'third_party/libskcms.a'), join(build, 'third_party/highway/libhwy.a')], { env: jxlEnv })
  await copyFile(join(libjxl, 'LICENSE'), join(output, 'jxl/LICENSE'))
}

async function build() {
  const { stdout } = await run('emcc', ['--version'])
  if (!/^emcc \(.*\) 3\.1\.69 /.test(stdout)) throw new Error(`Building needs Debian trixie's emscripten 3.1.69, found:\n${stdout}`)
  await rm(output, { recursive: true, force: true })
  await rm(join(root, 'build'), { recursive: true, force: true })
  // Keep build paths out of the output, so every checkout builds the same files.
  const env = { ...process.env, EMCC_CFLAGS: `-ffile-prefix-map=${root}=/android-wasm` }
  await buildQuickjs(env)
  await buildJxl(env)
  // Emscripten names --pre-js files by absolute path in comments.
  for (const directory of await readdir(output)) {
    for (const file of await readdir(join(output, directory))) {
      if (!/\.m?js$/.test(file)) continue
      const path = join(output, directory, file)
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll(`${root}/`, ''))
    }
  }
  await rm(join(root, 'build'), { recursive: true, force: true })
}

function docker() {
  const script = [
    'set -eu',
    'apt-get update -qq',
    `DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ${DEBIAN_PACKAGES.join(' ')} >/dev/null`,
    'trap \'chown -R "$HOST_IDS" build/android-wasm\' EXIT',
    'node _scripts/androidWasm.mjs fetch',
    'node _scripts/androidWasm.mjs build'
  ].join('\n')
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['run', '--rm', '-e', `HOST_IDS=${process.getuid()}:${process.getgid()}`,
      '-v', `${repo}:/src`, '-w', '/src', 'debian:trixie', 'bash', '-c', script], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`docker exited with status ${code}`)))
  })
}

const commands = { check, fetch: fetchSources, build, docker }
const command = commands[process.argv[2]]
if (!command) throw new Error('Usage: node _scripts/androidWasm.mjs check|fetch|build|docker')
await command()
