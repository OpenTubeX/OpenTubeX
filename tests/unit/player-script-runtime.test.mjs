import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { gunzipSync } from 'node:zlib'
import { Player, Platform } from 'youtubei.js'

import { evaluatePlayerCode } from '../../src/renderer/helpers/api/player-script-runtime.js'

for (const stackSize of [128, 256]) {
  test(`deciphers and recovers from recursion with a ${stackSize} KiB host stack`, async () => {
    const runtimeUrl = new URL('../../src/renderer/helpers/api/player-script-runtime.js', import.meta.url)
    const fixtureUrl = new URL('../../e2e/fixtures/player-scripts/7460dd14.js.gz', import.meta.url)
    const { stderr } = await promisify(execFile)(process.execPath, [
      `--stack_size=${stackSize}`, '--input-type=module', '-e', `
        import assert from 'node:assert/strict'
        import { readFileSync } from 'node:fs'
        import { gunzipSync } from 'node:zlib'
        import { evaluatePlayerCode } from ${JSON.stringify(runtimeUrl.href)}
        const code = gunzipSync(readFileSync(new URL(${JSON.stringify(fixtureUrl.href)}))).toString()
        const expected = { sig: '76543210ZYXWVUTSRQPONMLKJIHGFEDcBAzyxwvutsrqponmlkjih', n: 'mBzrJcW9e13' }
        // Queue callers before WASM initialization, including a real player that
        // overflows the host stack with the old fixed guest-stack allowance.
        await Promise.all([
          evaluatePlayerCode(code).then(value => assert.deepEqual(value, expected)),
          evaluatePlayerCode('function f(){return f()} try {f()} catch(e){return e.message}')
            .then(value => assert.equal(value, 'stack overflow')),
          assert.rejects(evaluatePlayerCode('function f(){return f()} f()'), /InternalError: stack overflow/),
          evaluatePlayerCode(code).then(value => assert.deepEqual(value, expected))
        ])
        assert.equal(await evaluatePlayerCode('return 42'), 42)
      `
    ], { timeout: 20_000 })
    assert.doesNotMatch(stderr, /Aborted|JS_FreeRuntime/)
  })
}

test('does not expose browser, worker, Electron or Node globals to player code', async () => {
  assert.deepEqual(await evaluatePlayerCode(`return {
    window: typeof window, document: typeof document, parent: typeof parent,
    fetch: typeof fetch, postMessage: typeof postMessage, process: typeof process,
    require: typeof require, electron: typeof ftElectron
  }`), {
    window: 'undefined', document: 'undefined', parent: 'undefined',
    fetch: 'undefined', postMessage: 'undefined', process: 'undefined',
    require: 'undefined', electron: 'undefined'
  })
  assert.equal(await evaluatePlayerCode('return globalThis.constructor.constructor("return typeof fetch")()'), 'undefined')
})

test('isolates globals and prototypes between evaluations', async () => {
  await evaluatePlayerCode('globalThis.saved = 1; Object.prototype.saved = 2; return true')
  assert.deepEqual(await evaluatePlayerCode('return [typeof globalThis.saved, typeof ({}).saved]'), ['undefined', 'undefined'])
  assert.equal(Object.prototype.saved, undefined)
})

test('returns values and errors without retaining failed contexts', async () => {
  assert.equal(await evaluatePlayerCode('return undefined'), undefined)
  await assert.rejects(evaluatePlayerCode('throw new Error("bad player")'), /bad player/)
  await assert.rejects(evaluatePlayerCode('invalid syntax }'), /SyntaxError/)
  assert.deepEqual(await evaluatePlayerCode('return {sig: "abc", n: "xyz"}'), { sig: 'abc', n: 'xyz' })
})

test('interrupts infinite loops and excessive allocation and remains usable', async () => {
  await assert.rejects(evaluatePlayerCode('while (true) {}', { timeoutMs: 20 }), /interrupted/)
  await assert.rejects(evaluatePlayerCode('return new ArrayBuffer(4 * 1024 * 1024)', {
    memoryLimitBytes: 2 * 1024 * 1024
  }), /out of memory/)
  assert.equal(await evaluatePlayerCode('return 42'), 42)
})

test('deciphers archived YouTube player data identically to the previous evaluator', async () => {
  const source = gunzipSync(readFileSync(new URL('../../e2e/fixtures/innertube/shared/shared-99c4a5c04897.gz', import.meta.url))).toString()
  const player = await Player.create(undefined, async () => new Response(source), undefined, 'fixture')
  const previousEval = Platform.shim.eval
  Platform.shim.eval = data => evaluatePlayerCode(data.output)
  try {
    for (const [input, expected] of [
      ['abcdefghijklmno', 'lp23SSMqJ_Y3f'],
      ['0123456789ABCDEFGHIJ', 'ZfbAjVpVGFDyXkcReM']
    ]) {
      assert.equal(await player.decipher(`https://example.test/videoplayback?n=${input}`),
        `https://example.test/videoplayback?n=${expected}`)
    }
    const cipher = new URLSearchParams({
      url: 'https://example.test/videoplayback?n=abcdefghijklmno',
      s: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      sp: 'sig'
    })
    assert.equal(await player.decipher(undefined, cipher.toString()),
      'https://example.test/videoplayback?n=lp23SSMqJ_Y3f&sig=SfghijclmnopqrstuvwxyzA7CDaFGHIJKLMNOPQReTUVWXYZ0123456B')
  } finally {
    Platform.shim.eval = previousEval
  }
})

test('recovers after memory exhaustion with objects retained on the global object', async () => {
  await assert.rejects(evaluatePlayerCode('globalThis.a = [new ArrayBuffer(1024 * 1024)]; a.push(new ArrayBuffer(2 * 1024 * 1024))', {
    memoryLimitBytes: 2 * 1024 * 1024
  }), /out of memory/)
  assert.equal(await evaluatePlayerCode('return 42'), 42)
})

test('retries WASM initialization after a transient failure', async () => {
  let attempts = 0
  const source = readFileSync(new URL('../../src/renderer/helpers/api/player-script-runtime.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export async function', 'async function')
  const runtime = {
    setMemoryLimit() {}, setMaxStackSize() {}, setInterruptHandler() {}, dispose() {},
    newContext: () => ({
      evalCode: () => ({ dispose() {} }), unwrapResult: value => value,
      dump: () => 42, dispose() {}
    })
  }
  const evaluate = vm.runInNewContext(`${source}; evaluatePlayerCode`, {
    variant: {},
    newQuickJSWASMModuleFromVariant: async () => {
      if (++attempts === 1) throw new Error('temporary initialization failure')
      return { newRuntime: () => runtime }
    }
  })
  await assert.rejects(evaluate('return 42'), /temporary initialization failure/)
  assert.equal(await evaluate('return 42'), 42)
  assert.equal(attempts, 2)
})

test('bounds host-stack recovery and abandons trapped instances without calling their cleanup', async () => {
  const source = readFileSync(new URL('../../src/renderer/helpers/api/player-script-runtime.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace('export async function', 'async function')
  const limits = []
  let modules = 0
  let cleanups = 0
  let trap = true
  const evaluate = vm.runInNewContext(`${source}; evaluatePlayerCode`, {
    variant: {}, RangeError, WebAssembly,
    newQuickJSWASMModuleFromVariant: async () => {
      modules++
      return { newRuntime: () => ({
        setMemoryLimit() {}, setMaxStackSize: value => limits.push(value), setInterruptHandler() {},
        dispose: () => cleanups++,
        newContext: () => ({
          evalCode: () => {
            if (trap) throw new RangeError('Maximum call stack size exceeded')
            return { dispose: () => cleanups++ }
          },
          unwrapResult: value => value, dump: () => 42, dispose: () => cleanups++
        })
      }) }
    }
  })
  await assert.rejects(evaluate('return 42'), /Maximum call stack size exceeded/)
  assert.equal(cleanups, 0)
  assert.equal(modules, 4)
  assert.deepEqual(limits, [128, 64, 32, 16].map(kib => kib * 1024))
  trap = false
  assert.equal(await evaluate('return 42'), 42)
  assert.equal(modules, 5)
  assert.equal(cleanups, 3)
})

test('keeps stack exhaustion catchable inside player scripts', async () => {
  assert.deepEqual(await evaluatePlayerCode(`
    function recurse() { return recurse() }
    try {
      recurse()
    } catch (error) {
      return { n: 'decoded', error: error.message }
    }
  `), { n: 'decoded', error: 'stack overflow' })
  assert.equal(await evaluatePlayerCode('return 42'), 42)
})

test('reports uncaught stack exhaustion without aborting runtime cleanup', async () => {
  await assert.rejects(evaluatePlayerCode('function recurse() { return recurse() } recurse()'), /InternalError: stack overflow/)
  assert.equal(await evaluatePlayerCode('return 42'), 42)
})
