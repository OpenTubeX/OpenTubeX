import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { chromium } from '@playwright/test'

let browser
before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) })
after(async () => { await browser?.close() })

async function pageWithModule(path) {
  const context = await browser.newContext({ viewport: { width: 400, height: 700 } })
  const page = await context.newPage()
  await page.route('http://mobile.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }))
  await page.goto('http://mobile.test')
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  await page.evaluate(async source => {
    window.module = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))
  }, source)
  return { page, context }
}

test('record storage imports shipped NeDB data, persists only changed records, and rolls back failed batches', async () => {
  const { page, context } = await pageWithModule('../../src/datastores/androidRecordStorage.js')
  try {
    const result = await page.evaluate(async () => {
      const legacy = await new Promise((resolve, reject) => {
        const request = indexedDB.open('NeDB', 3)
        request.onupgradeneeded = () => request.result.createObjectStore('nedbdata')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      const lines = [
        { _id: 'old', value: 1 }, { _id: 'old', value: 2 },
        { _id: 'deleted', value: 3 }, { _id: 'deleted', $$deleted: true },
        { _id: 'date', date: { $$date: 1234 } },
        { $$indexCreated: { fieldName: 'videoId', unique: true } },
      ].map(JSON.stringify).concat('malformed legacy line').join('\n')
      await new Promise((resolve, reject) => {
        const tx = legacy.transaction('nedbdata', 'readwrite')
        tx.objectStore('nedbdata').put(lines, 'history.db')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
      const storage = window.module.createAndroidRecordStorage()
      const parse = raw => raw.split('\n').filter(Boolean).map(JSON.parse)
      const imported = parse(await storage.readFileAsync('history.db'))
      let writes = 0
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) { writes++; return original.apply(this, args) }
      await storage.appendFileAsync('history.db', JSON.stringify({ _id: 'old', value: 4 }))
      const singleWrites = writes
      await storage.crashSafeWriteFileLinesAsync('history.db', [])
      const compactWrites = writes - singleWrites
      IDBObjectStore.prototype.put = function (...args) {
        if (args[1] === 'document:fail') throw new Error('Simulated quota failure')
        return original.apply(this, args)
      }
      let rejected = false
      try {
        await storage.appendFileAsync('history.db', [{ _id: 'old', value: 99 }, { _id: 'fail' }].map(JSON.stringify).join('\n'))
      } catch { rejected = true }
      IDBObjectStore.prototype.put = original
      const reopened = window.module.createAndroidRecordStorage()
      const retained = parse(await reopened.readFileAsync('history.db'))
      await reopened.appendFileAsync('history.db', JSON.stringify({ _id: 'old', $$deleted: true }))
      const deleted = parse(await storage.readFileAsync('history.db'))
      await reopened.unlinkAsync('history.db')
      const empty = await storage.readFileAsync('history.db')
      legacy.close()
      return { imported, singleWrites, compactWrites, rejected, retained, deleted, empty }
    })
    assert.equal(result.imported.length, 3)
    assert.equal(result.imported.find(record => record._id === 'old').value, 2)
    assert.deepEqual(result.imported.find(record => record._id === 'date').date, { $$date: 1234 })
    assert.equal(result.singleWrites, 1)
    assert.equal(result.compactWrites, 0)
    assert.equal(result.rejected, true)
    assert.equal(result.retained.find(record => record._id === 'old').value, 4)
    assert.equal(result.retained.some(record => record._id === 'fail'), false)
    assert.equal(result.deleted.some(record => record._id === 'old'), false)
    assert.equal(result.empty, '')
  } finally { await context.close() }
})

for (const scale of [1, 1.25]) {
  test(`windowed cards release content and retain accurate scroll geometry at scale ${scale}`, async () => {
    const { page, context } = await pageWithModule('../../src/renderer/helpers/windowedList.js')
    try {
      await page.evaluate(scale => {
        document.body.style.cssText = 'margin:0'
        const list = document.createElement('div')
        list.id = 'list'
        list.style.cssText = `width:100%;font-size:${16 * scale}px`
        document.body.append(list)
        const windowing = window.module.createListWindow()
        window.items = []
        for (let index = 0; index < 120; index++) {
          const shell = document.createElement('div')
          shell.style.minHeight = `${131.25 * scale}px`
          shell.dataset.height = String(131.25 * scale)
          list.append(shell)
          let mounted = false
          const mount = () => {
            if (mounted) return
            mounted = true
            queueMicrotask(() => {
              shell.style.height = ''
              shell.innerHTML = `<article style="height:${shell.dataset.height}px"><button>Card ${index}</button></article>`
            })
          }
          mount()
          const observation = windowing.observe(shell, {
            mount, isMounted: () => mounted,
            isProtected: () => shell.contains(document.activeElement),
            unmount: height => {
              mounted = false
              queueMicrotask(() => { shell.style.height = `${height}px`; shell.replaceChildren() })
            }
          })
          window.items.push({ shell, observation, mount })
        }
      }, scale)
      await page.waitForFunction(() => document.querySelectorAll('article').length < 30)
      const originalHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.locator('article button').first().focus()
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(100)
      assert.equal(await page.locator('article button').first().textContent(), 'Card 0')
      await page.evaluate(() => document.activeElement.blur())
      await page.waitForFunction(() => document.querySelector('article button')?.textContent !== 'Card 0')
      assert.ok(await page.locator('article').count() < 30)
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), originalHeight)
      for (const trigger of ['resize', 'remove', 'filter', 'replace', 'collapse']) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.evaluate(trigger => {
          if (trigger === 'resize') {
            document.querySelector('#list').style.cssText += ';width:73.25%;display:grid;grid-template-columns:repeat(2, 1fr)'
          } else if (trigger === 'collapse') {
            for (const item of window.items) {
              item.shell.dataset.height = '30.5'
              item.shell.style.minHeight = '30.5px'
              item.shell.querySelector('article')?.style.setProperty('height', '30.5px')
              item.observation.refresh()
            }
          } else {
            const amount = trigger === 'remove' ? 80 : trigger === 'filter' ? 20 : 10
            for (const item of window.items.splice(amount)) { item.observation.dispose(); item.shell.remove() }
          }
        }, trigger)
        if (trigger === 'resize') await page.setViewportSize({ width: 600, height: 900 })
        await page.waitForTimeout(100)
        const geometry = await page.evaluate(() => ({
          top: window.scrollY, height: document.documentElement.scrollHeight,
          viewport: window.innerHeight, end: document.querySelector('#list').getBoundingClientRect().bottom + window.scrollY,
        }))
        assert.ok(geometry.top <= Math.max(0, geometry.end - geometry.viewport) + 1, `${trigger}: ${JSON.stringify(geometry)}`)
        assert.ok(geometry.height <= Math.max(geometry.viewport, geometry.end) + 1, `${trigger}: no stale scroll range`)
        if (trigger === 'collapse') assert.equal(geometry.end, 152.5)
      }
    } finally { await context.close() }
  })
}

test('a failed import retains legacy data and retries after a storage failure', async () => {
  const { page, context } = await pageWithModule('../../src/datastores/androidRecordStorage.js')
  try {
    const result = await page.evaluate(async () => {
      const legacy = await new Promise(resolve => {
        const request = indexedDB.open('NeDB', 2)
        request.onupgradeneeded = () => request.result.createObjectStore('nedbdata')
        request.onsuccess = () => resolve(request.result)
      })
      const write = value => new Promise((resolve, reject) => {
        const tx = legacy.transaction('nedbdata', 'readwrite')
        tx.objectStore('nedbdata').put(value, 'history.db')
        tx.oncomplete = resolve
        tx.onabort = () => reject(tx.error)
      })
      await write('{"_id":"retained","value":1}')
      const originalPut = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'records') throw new DOMException('Quota exhausted', 'QuotaExceededError')
        return originalPut.apply(this, args)
      }
      const storage = window.module.createAndroidRecordStorage()
      let failed = false
      try { await storage.readFileAsync('history.db') } catch { failed = true }
      const retained = await new Promise(resolve => {
        const request = legacy.transaction('nedbdata').objectStore('nedbdata').get('history.db')
        request.onsuccess = () => resolve(request.result)
      })
      IDBObjectStore.prototype.put = originalPut
      const repaired = await storage.readFileAsync('history.db')
      legacy.close()
      return { failed, retained, repaired }
    })
    assert.equal(result.failed, true)
    assert.equal(result.retained, '{"_id":"retained","value":1}')
    assert.deepEqual(JSON.parse(result.repaired), { _id: 'retained', value: 1 })
  } finally { await context.close() }
})
