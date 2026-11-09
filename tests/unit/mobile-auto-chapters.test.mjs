import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const settingsSource = await readFile(new URL('../../src/renderer/components/Settings/Playback/PlayerSettings.vue', import.meta.url), 'utf8')
const toggle = [...settingsSource.matchAll(/<FtToggleSwitch\s[\s\S]*?\/>/g)]
  .map(([template]) => template)
  .find(template => template.includes('Automatically Open Chapters'))
const render = compile(`<div>${toggle}</div>`)

test('automatically open chapters is hidden on Android', async () => {
  const app = createSSRApp({
    render,
    setup: () => ({ IS_CAPACITOR: true, t: key => key, autoOpenChapters: true, updateAutoOpenChapters() {} })
  })
  app.component('FtToggleSwitch', {
    setup: (_props, { attrs }) => () => h('span', { 'data-label': attrs.label })
  })
  const html = await renderToString(app)
  assert.equal(html.includes('Automatically Open Chapters'), false)
})
