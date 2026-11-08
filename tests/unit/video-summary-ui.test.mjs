import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { parse } from 'vue/compiler-sfc'

const component = await readFile(new URL('../../src/renderer/components/WatchVideoSummary/WatchVideoSummary.vue', import.meta.url), 'utf8')
const { descriptor } = parse(component)
const summaryComponent = { props: ['paragraphs', 'expanded'], render: compile(descriptor.template.content) }
const watch = await readFile(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
const placements = [...watch.matchAll(/<WatchVideoSummary\s[\s\S]*?\/>/g)].map(([template]) => template)

assert.equal(placements.length, 2, 'expected Shorts and general summary placements')

for (const [index, template] of placements.entries()) {
  for (const mode of ['hide', 'collapsed', 'expanded']) {
    test(`summary placement ${index} respects the distraction setting ${mode}`, async () => {
      const app = createSSRApp({
        render: compile(template),
        setup: () => ({
          clampShortsAuxPanelScroll() {},
          customShortsPlayerActive: false, fullscreenMetadataOpen: false,
          shortsMetadataOpen: true, isLoading: false, aiVideoSummaryMode: mode,
          videoSummary: ['<img src=x onerror=alert(1)>', 'Second paragraph'], videoId: 'video'
        })
      })
      app.component('WatchVideoSummary', summaryComponent)
      app.component('FtInlineMetadata', { render() { return h('span', this.$slots.default()) } })
      app.component('ft-icon', { render: () => h('svg') })
      app.config.globalProperties.$t = key => key
      const html = await renderToString(app)
      assert.equal(html.includes('<details'), mode !== 'hide')
      assert.equal(html.includes('Second paragraph'), mode !== 'hide')
      assert.equal(html.includes('<img'), false)
      if (mode !== 'hide') {
        assert.equal(/<details[^>]*\sopen(?:[\s=>])/.test(html), mode === 'expanded')
        assert.ok(html.includes('&lt;img'))
        assert.ok(html.includes('<summary>'))
        assert.match(html, /<summary>[\s\S]*Quality and accuracy may vary[\s\S]*<\/summary>/)
        assert.ok(html.includes('Quality and accuracy may vary'))
      }
    })
  }
}

for (const fullscreenMetadataOpen of [false, true]) {
  test(`general summary follows Shorts fullscreen metadata visibility ${fullscreenMetadataOpen}`, async () => {
    const app = createSSRApp({
      render: compile(placements[1]),
      setup: () => ({
        isLoading: false, aiVideoSummaryMode: 'collapsed',
        customShortsPlayerActive: true, fullscreenMetadataOpen,
        videoSummary: ['Summary'], videoId: 'short'
      })
    })
    app.component('WatchVideoSummary', summaryComponent)
      app.component('FtInlineMetadata', { render() { return h('span', this.$slots.default()) } })
    app.component('ft-icon', { render: () => h('svg') })
    app.config.globalProperties.$t = key => key
    assert.equal((await renderToString(app)).includes('<details'), fullscreenMetadataOpen)
  })
}
