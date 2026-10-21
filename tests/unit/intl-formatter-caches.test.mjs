import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { formatBytes } from '../../src/renderer/helpers/fileSize.js'

function source(path) {
  return readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
}

/** Wraps one Intl constructor so evaluated code can count how often it is constructed. */
function countingIntl(name) {
  const constructed = []
  const Counting = new Proxy(Intl[name], {
    construct: (target, args) => { constructed.push(args); return Reflect.construct(target, args) },
    apply: (target, _thisArg, args) => { constructed.push(args); return Reflect.construct(target, args) },
  })
  return { constructed, Intl: Object.create(Intl, { [name]: { value: Counting } }) }
}

test('formatNumber constructs at most one Intl.NumberFormat per locale and options', () => {
  const code = source('helpers/utils.js')
  const slice = code.slice(code.indexOf('/** @type {Map<string, Intl.NumberFormat>} */'), code.indexOf('/**\n * Formats a view count'))
  const counting = countingIntl('NumberFormat')
  const locale = { value: 'en-US' }
  const formatNumber = vm.runInNewContext(`${slice.replace('export function', 'function')}\nformatNumber`, {
    Intl: counting.Intl, i18n: { global: { locale } },
  })

  for (let index = 0; index < 200; index++) {
    assert.equal(formatNumber(1234), '1,234')
    assert.equal(formatNumber(14000, { notation: 'compact' }), '14K')
  }
  assert.equal(counting.constructed.length, 2)

  formatNumber(1.25, { notation: 'compact', maximumFractionDigits: 1 })
  formatNumber(1.25, { maximumFractionDigits: 1, notation: 'compact' })
  assert.equal(counting.constructed.length, 3, 'option key order must not create another formatter')

  locale.value = 'de-DE'
  assert.equal(formatNumber(1234), '1.234')
  assert.equal(counting.constructed.length, 4)
})

test('formatBytes reuses its two formatters', () => {
  const original = Intl.NumberFormat
  let constructed = 0
  Intl.NumberFormat = new Proxy(original, {
    construct: (target, args) => { constructed++; return Reflect.construct(target, args) },
  })
  try {
    for (let index = 0; index < 100; index++) {
      assert.match(formatBytes(1536), / KiB$/)
      assert.match(formatBytes(15 * 1024 * 1024), / MiB$/)
    }
    assert.equal(constructed, 2)
  } finally {
    Intl.NumberFormat = original
  }
})

test('getFirstCharacter constructs one Intl.Segmenter per locale', () => {
  const code = source('helpers/strings.js')
  const slice = code.slice(code.indexOf('/** @type {Map<string, Intl.Segmenter>} */')).replace('export function', 'function')
  const counting = countingIntl('Segmenter')
  const getFirstCharacter = vm.runInNewContext(`${slice}\ngetFirstCharacter`, { Intl: counting.Intl })

  for (let index = 0; index < 200; index++) {
    assert.equal(getFirstCharacter('👨‍👩‍👧 family', 'en-US'), '👨‍👩‍👧')
    assert.equal(getFirstCharacter('Ärger', 'de-DE'), 'Ä')
  }
  assert.equal(counting.constructed.length, 2)
})

test('the audio track menu constructs Intl.DisplayNames once per rebuild', () => {
  const code = source('components/ft-shaka-video-player/player-components/AudioTrackSelection.js')
  const start = code.indexOf('  updateAudioTracks_() {')
  const body = code.slice(start + '  updateAudioTracks_() {'.length, code.indexOf('\n  }\n', start))
  const counting = countingIntl('DisplayNames')
  class FakeElement {
    children = []
    classList = { add() {} }
    get firstChild() { return this.children[0] ?? null }
    appendChild(child) { this.children.push(child) }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1) }
    addEventListener() {}
    setAttribute() {}
    querySelector() { return null }
  }
  const backButton = new FakeElement()
  const menu = Object.assign(new FakeElement(), {
    querySelector: selector => selector === '.shaka-back-to-overflow-button' ? backButton : null,
  })
  const updateAudioTracks = vm.runInNewContext(`(function () {${body}\n})`, {
    Intl: counting.Intl,
    document: { createElement: () => new FakeElement() },
    deduplicateAudioTracks: tracks => new Map(tracks.map((track, index) => [index, track])),
  })
  const self = {
    player: { getAudioTracks: () => Array.from({ length: 50 }, (_, index) => ({ language: 'de', active: index === 0 })) },
    menu,
    currentSelection: {},
    button: new FakeElement(),
    _checkmarkIcon: new FakeElement(),
    onAudioTrackSelected_() {},
    updateVisibility_() {},
  }

  updateAudioTracks.call(self)
  assert.equal(self.audioTrackCount_, 50)
  assert.equal(menu.children[1].children[0].textContent, 'German')
  assert.equal(counting.constructed.length, 1)
})
