import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { test, expect } from '../../helpers/app.mjs'

test('interprets player code without host access and keeps the UI responsive', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const worker = new Worker('app://bundle/player-script-worker.js')
    let nextId = 0
    const evaluate = code => new Promise((resolve, reject) => {
      const id = ++nextId
      const listener = ({ data }) => {
        if (data.id !== id) return
        worker.removeEventListener('message', listener)
        if (data.error) reject(new Error(data.error))
        else resolve(data.result)
      }
      worker.addEventListener('message', listener)
      worker.postMessage({ id, code })
    })
    try {
      worker.postMessage(null)
      const values = await Promise.all([
        evaluate('return {sig: "abc", n: "xyz"}'),
        evaluate('return [typeof window, typeof document, typeof fetch, typeof postMessage, typeof process, typeof ftElectron]'),
        evaluate('globalThis.saved = 42; return saved'),
        evaluate('return typeof saved')
      ])
      const loop = evaluate('while (true) {}').then(() => 'unexpected success', error => error.message)
      const responsive = await Promise.race([
        loop.then(() => false),
        new Promise(resolve => setTimeout(() => resolve(true), 50))
      ])
      const error = await loop
      const memoryError = await evaluate('globalThis.a = [new ArrayBuffer(32 * 1024 * 1024)]; a.push(new ArrayBuffer(64 * 1024 * 1024))')
        .then(() => 'unexpected success', error => error.message)
      return { values, responsive, error, memoryError, recovered: await evaluate('return 42') }
    } finally {
      worker.terminate()
    }
  })
  expect(result.values).toEqual([
    { sig: 'abc', n: 'xyz' },
    Array(6).fill('undefined'),
    42,
    'undefined'
  ])
  expect(result.responsive).toBe(true)
  expect(result.error).toContain('interrupted')
  expect(result.memoryError).toContain('out of memory')
  expect(result.recovered).toBe(42)
  await expect(page.locator('#sigFrame')).toHaveCount(0)
})

test('deciphers a real player and survives caught and uncaught recursion', async ({ page }) => {
  const code = gunzipSync(readFileSync(new URL('../../fixtures/player-scripts/7460dd14.js.gz', import.meta.url))).toString()
  const results = await page.evaluate(async code => {
    const worker = new Worker('app://bundle/player-script-worker.js')
    let nextId = 0
    const pending = new Map()
    worker.onmessage = ({ data }) => {
      pending.get(data.id)?.(data)
      pending.delete(data.id)
    }
    worker.onerror = event => {
      for (const resolve of pending.values()) resolve({ error: event.message })
      pending.clear()
    }
    const evaluate = code => new Promise(resolve => {
      const id = ++nextId
      pending.set(id, resolve)
      worker.postMessage({ id, code })
    })
    try {
      return await Promise.all([
        evaluate(code),
        evaluate('function f(){return f()} try {f()} catch(e){return e.message}'),
        evaluate('function f(){return f()} f()'),
        evaluate(code)
      ])
    } finally {
      worker.terminate()
    }
  }, code)
  for (const i of [0, 3]) {
    expect(results[i].error).toBeUndefined()
    expect(results[i].result).toEqual({
      sig: '76543210ZYXWVUTSRQPONMLKJIHGFEDcBAzyxwvutsrqponmlkjih',
      n: 'mBzrJcW9e13'
    })
  }
  expect(results[1].result).toBe('stack overflow')
  expect(results[2].error).toBe('InternalError: stack overflow')
})
