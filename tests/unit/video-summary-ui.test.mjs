import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { parse } from 'vue/compiler-sfc'

const component = await readFile(new URL('../../src/renderer/components/WatchVideoSummary/WatchVideoSummary.vue', import.meta.url), 'utf8')
const { descriptor } = parse(component)
const summaryComponent = { props: ['paragraphs'], render: compile(descriptor.template.content) }
const watch = await readFile(new URL('../../src/renderer/views/Watch/Watch.vue', import.meta.url), 'utf8')
const placements = [...watch.matchAll(/<WatchVideoSummary\s[\s\S]*?\/>/g)].map(([template]) => template)

for (const [index, template] of placements.entries()) {
  for (const hidden of [false, true]) {
    test(`summary placement ${index} respects the distraction setting ${hidden}`, async () => {
      const app = createSSRApp({
        render: compile(template),
        setup: () => ({
          clampShortsAuxPanelScroll() {},
          customShortsPlayerActive: false, fullscreenMetadataOpen: false,
          shortsMetadataOpen: true, isLoading: false, hideAiVideoSummaries: hidden,
          videoSummary: ['<img src=x onerror=alert(1)>', 'Second paragraph'], videoId: 'video'
        })
      })
      app.component('WatchVideoSummary', summaryComponent)
      app.component('ft-icon', { render: () => h('svg') })
      app.config.globalProperties.$t = key => key
      const html = await renderToString(app)
      assert.equal(html.includes('<details'), !hidden)
      assert.equal(html.includes('Second paragraph'), !hidden)
      assert.equal(html.includes('<img'), false)
      if (!hidden) {
        assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/)
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
        isLoading: false, hideAiVideoSummaries: false,
        customShortsPlayerActive: true, fullscreenMetadataOpen,
        videoSummary: ['Summary'], videoId: 'short'
      })
    })
    app.component('WatchVideoSummary', summaryComponent)
    app.component('ft-icon', { render: () => h('svg') })
    app.config.globalProperties.$t = key => key
    assert.equal((await renderToString(app)).includes('<details'), fullscreenMetadataOpen)
  })
}
