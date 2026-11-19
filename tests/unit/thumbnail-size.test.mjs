import assert from 'node:assert/strict'
import test from 'node:test'

import { FULL_WIDTH_COLUMNS, getThumbnailGridStyles } from '../../src/renderer/constants/thumbnailSize.js'

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
