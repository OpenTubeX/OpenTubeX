import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const settings = await readFile(new URL('../../src/renderer/components/PlayerSettings/PlayerSettings.vue', import.meta.url), 'utf8')
const start = settings.lastIndexOf('<FtFlexBox', settings.indexOf('class="autoPictureInPictureSettings"'))
const end = settings.indexOf('<FtFlexBox class="playerSelectGrid">', start)
const render = compile(`<div>${settings.slice(start, end)}</div>`)

for (const ios of [true, false]) {
  test(`${ios ? 'iOS' : 'Android'} exposes one background auto-PiP toggle`, async () => {
    const app = createSSRApp({ render, setup: () => ({
      IS_CAPACITOR: true, IS_IOS: ios, t: key => key,
      androidAutoPictureInPicture: true, updateAndroidAutoPictureInPicture() {},
      autoPictureInPictureTriggers: [], autoPictureInPictureTriggerLabels: [], AUTO_PIP_TRIGGER_VALUES: [],
      supportsAutoPictureInPictureMinimize: true,
    }) })
    app.component('FtFlexBox', { setup: (_, { slots }) => () => h('div', slots.default?.()) })
    app.component('FtToggleSwitch', { setup: () => () => h('input', { type: 'checkbox', 'data-mobile-pip': '' }) })
    app.component('FtCheckboxList', { setup: () => () => h('div', { 'data-desktop-pip': '' }) })
    const html = await renderToString(app)
    assert.ok(html.includes('data-mobile-pip'), html)
    assert.ok(!html.includes('data-desktop-pip'), html)
  })
}

const { bindIosAutoPictureInPicture } = await import('../../src/renderer/helpers/player/iosAutoPictureInPicture.js')

for (const [name, enabled, paused, ended, mode, supported, expected] of [
  ['playing active video', true, false, false, 'inline', true, 1],
  ['disabled or background player', false, false, false, 'inline', true, 0],
  ['paused', true, true, false, 'inline', true, 0],
  ['ended', true, false, true, 'inline', true, 0],
  ['already in PiP', true, false, false, 'picture-in-picture', true, 0],
  ['unsupported', true, false, false, 'inline', false, 0],
]) {
  test(`native resignation enters iOS PiP only for ${name}`, () => {
    const target = new EventTarget()
    const calls = []
    const video = {
      paused, ended, webkitPresentationMode: mode,
      webkitSupportsPresentationMode: () => supported,
      webkitSetPresentationMode: mode => calls.push(mode),
    }
    const cleanup = bindIosAutoPictureInPicture({ getVideo: () => video, isEnabled: () => enabled, target })
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected)
    cleanup()
    target.dispatchEvent(new Event('opentubex:prepare-background'))
    assert.equal(calls.length, expected, 'teardown removes the native listener')
  })
}
