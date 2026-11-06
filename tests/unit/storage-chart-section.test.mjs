import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compile, createSSRApp, h } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

const { descriptor } = parse(readFileSync(new URL('../../src/renderer/components/Settings/Data/StorageSettings.vue', import.meta.url), 'utf8'))
const root = descriptor.template.ast.children.find(node => node.tag === 'div')
const chartSection = root.children.find(node => node.tag === 'FtSettingsSection')
const render = compile(chartSection.loc.source)

for (const supported of [false, true]) {
  test(`storage chart section ${supported ? 'renders when supported' : 'leaves no empty card when unsupported'}`, async () => {
    const app = createSSRApp({
      components: {
        FtTooltip: { render: () => null },
        FtSettingsSection: { setup: (_, { slots }) => () => h('section', { class: 'settingsSection' }, slots.default()) }
      },
      setup: () => ({
        SUPPORTS_STORAGE_USAGE: supported,
        t: key => key,
        chartAriaLabel: 'Storage breakdown',
        chartSegments: [],
        chartItems: [],
        chartTotalText: '0 B',
        activeChartItem: null
      }),
      render
    })
    const html = await renderToString(app)
    assert.equal(html.includes('settingsSection'), supported, 'the chart card only exists when storage usage is available')
    assert.equal(html.includes('storageBreakdown'), supported)
  })
}
