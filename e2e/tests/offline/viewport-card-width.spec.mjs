import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { compile } from 'sass'

import { test, expect, repoRoot, setWindowSize } from '../../helpers/app.mjs'

const pageCases = [
  ['Channel', 'card'],
  ['Home', 'homePage'],
  ['History', 'card'],
  ['Stats', 'statsPage'],
  ['SearchPage', 'card'],
  ['Subscriptions', 'card'],
  ['SubscribedChannels', 'card'],
  ['UserPlaylists', 'card'],
  ['Trending', 'card'],
  ['Popular', 'card'],
  ['Hashtag', 'card'],
].map(([view, className]) => ({
  file: `views/${view}/${view}.css`,
  markup: `<div class="${className} target">Page content</div>`,
  ratio: 0.92,
}))
pageCases.push(
  {
    file: 'views/Playlist/Playlist.scss',
    markup: '<div class="routerView grid"><div class="playlistInfoContainer target">Info</div><div class="playlistItemsCard target">Videos</div></div>',
    ratio: 0.92,
  },
  {
    file: 'components/ChannelHome/ChannelHome.css',
    markup: '<section class="shelfContainer target">Shelf</section>',
    ratio: 0.85,
  },
)

test('browsing cards retain their width when legacy viewport units become stale', async ({ app, page }) => {
  const cases = await Promise.all(pageCases.map(async fixture => {
    const file = path.join(repoRoot, 'src/renderer', fixture.file)
    const css = file.endsWith('.scss') ? compile(file).css : await readFile(file, 'utf8')
    // Physical iPad resume repro: 100vw stayed at 535px while innerWidth and
    // 100dvw were 1080px. Emulate only that stale legacy unit in real page CSS;
    // leave dynamic units and the browser's current viewport untouched.
    const staleCss = css.replace(/(\d*\.?\d+)vw\b/g, (_, value) => `${Number(value) * 5.35}px`)
    return { ...fixture, css: staleCss }
  }))
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'viewportCardRegression'
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:10000'
    document.body.append(frame)
  })
  const frame = await page.locator('#viewportCardRegression').elementHandle().then(element => element.contentFrame())

  for (const [width, height, scale] of [[1330, 870, 0.75], [900, 700, 1], [1450, 850, 1.25], [1300, 900, 1.5]]) {
    await setWindowSize(app, page, { width, height })
    await page.evaluate(scale => window.ftElectron.setZoomFactor(scale), scale)
    for (const fixture of cases) {
      await frame.setContent(`<style>body{margin:0}.route{width:calc(100% - 100px);margin:auto}${fixture.css}</style><main class="route">${fixture.markup}</main>`)
      const sizes = await frame.evaluate(ratio => {
        const parentWidth = document.querySelector('.route').getBoundingClientRect().width
        return [...document.querySelectorAll('.target')].map(element => ({
          actual: element.getBoundingClientRect().width,
          expected: Math.min(parentWidth, innerWidth * ratio),
        }))
      }, fixture.ratio)
      for (const size of sizes) {
        expect.soft(Math.abs(size.actual - size.expected), `${fixture.file} at ${scale * 100}%`).toBeLessThan(1)
      }
    }
  }
})
