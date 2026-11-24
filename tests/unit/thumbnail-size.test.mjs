import assert from 'node:assert/strict'
import test from 'node:test'

import { FULL_WIDTH_COLUMNS, getThumbnailGridColumnCount, getThumbnailGridStyles } from '../../src/renderer/constants/thumbnailSize.js'

test('phone grids fit two columns at the default thumbnail size', () => {
  for (const width of [240, 313, 343, 380, 428.8]) {
    const size = Number.parseFloat(getThumbnailGridStyles(100, width)['--thumbnail-grid-size'])
    assert.equal(size * 2 + 8, width)
  }
})

test('a fixed column count fills each row regardless of thumbnail size', () => {
  for (const [width, viewportWidth] of [[343, 343], [800, 1200], [1600, 1920]]) {
    for (const columns of [2, 5, 10]) {
      for (const size of [60, 100, 180]) {
        const styles = getThumbnailGridStyles(size, width, viewportWidth, width + 12, columns)
        const cardSize = Number.parseFloat(styles['--thumbnail-grid-size'])
        assert.ok(Math.abs(cardSize * columns + (columns - 1) * 8 - width) < 1e-9)
        assert.equal(styles['--thumbnail-grid-stretch'], `calc((100% - ${12 + (columns - 1) * 8}px) / ${columns})`)
      }
    }
  }
})

test('stretches cards with the rendered grid width from the same size', () => {
  const resolveStretch = (stretch, width) => {
    const [, offset, ratio = '1'] = stretch.match(/^calc\(\(?100% - (-?[\d.]+)px\)?(?: \* ([\d.e-]+))?\)$/)
    return (width - Number(offset)) * Number(ratio)
  }
  for (const [size, gridWidth, viewportWidth, renderedWidth] of [
    [100, 396, 412, 396], [60, 396, 412, 396], [140, 396, 412, 396],
    [100, 844, 1000, 844], [180, 844, 1000, 829], [100, 450, 900, 450]
  ]) {
    const styles = getThumbnailGridStyles(size, gridWidth, viewportWidth, renderedWidth)
    const stretch = resolveStretch(styles['--thumbnail-grid-stretch'], renderedWidth)
    assert.ok(Math.abs(stretch - Number.parseFloat(styles['--thumbnail-grid-size'])) < 1e-9)
    // Grows with the grid before the next measurement.
    assert.ok(resolveStretch(styles['--thumbnail-grid-stretch'], renderedWidth + 100) > stretch)
  }
  assert.equal(getThumbnailGridStyles(100)['--thumbnail-grid-stretch'], '0px')
})

test('a more spacious grid keeps the default column count', () => {
  // Default fits three 262px cards in 804px; Comfortable's wider gaps must not drop one.
  const size = Number.parseFloat(getThumbnailGridStyles(100, 804, 1280, 804, 0, 1.5)['--thumbnail-grid-size'])
  assert.equal(size * 3 + 2 * 12, 804)
})

test('full width cards fill phone rows and stay capped in wider windows', () => {
  const phone = getThumbnailGridStyles(100, 396, 412, 396, FULL_WIDTH_COLUMNS)
  assert.equal(Number.parseFloat(phone['--thumbnail-grid-size']), 396)
  assert.equal(phone['--thumbnail-grid-stretch'], 'calc(100% - 0px)')

  const styles = getThumbnailGridStyles(100, 1700, 1780, 1700, FULL_WIDTH_COLUMNS)
  const cardSize = Number.parseFloat(styles['--thumbnail-grid-size'])
  assert.ok(cardSize < 1700)
  assert.equal(styles['--thumbnail-grid-stretch'], `min(calc(100% - 0px), ${cardSize}px)`)
  // The thumbnail size scales the cap.
  const capped = size => Number.parseFloat(getThumbnailGridStyles(size, 1700, 1780, 1700, FULL_WIDTH_COLUMNS)['--thumbnail-grid-size'])
  assert.ok(capped(60) < capped(100) && capped(100) < capped(180))
  // A desktop grid narrower than the cap still fills its row.
  assert.equal(Number.parseFloat(getThumbnailGridStyles(100, 500, 800, 500, FULL_WIDTH_COLUMNS)['--thumbnail-grid-size']), 500)
})

// Lists mount the cards a viewport-wide grid row holds before their grid is
// measured. Holding fewer in a narrower grid leaves placeholders on screen.
test('a grid narrower than the viewport holds no more cards per row', () => {
  for (const youtubeStyleShorts of [false, true]) {
    for (const size of [60, 100, 140, 180]) {
      for (const viewportWidth of [360, 412, 681, 1280, 1920]) {
        const estimate = getThumbnailGridColumnCount(size, viewportWidth, viewportWidth, 0, 1, youtubeStyleShorts)
        for (let width = 240; width <= viewportWidth; width += 3) {
          assert.ok(getThumbnailGridColumnCount(size, width, viewportWidth, 0, 1, youtubeStyleShorts) <= estimate)
        }
      }
    }
  }
  assert.equal(getThumbnailGridColumnCount(100, 1280, 1280, 0, 1, false), 4)
  assert.equal(getThumbnailGridColumnCount(100, 400, 412, 0, 1, false), 2)
  assert.equal(getThumbnailGridColumnCount(100, 1000, 1280, 7, 1, false), 7)
  assert.equal(getThumbnailGridColumnCount(100, 1000, 1280, FULL_WIDTH_COLUMNS, 1, false), 1)
})
