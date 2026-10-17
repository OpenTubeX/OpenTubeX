import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getThumbnailGridStyles,
  getThumbnailListStyles
} from '../../src/renderer/constants/thumbnailSize.js'

test('phone grids fit two columns at the default thumbnail size', () => {
  for (const width of [240, 313, 343, 380, 428.8]) {
    const size = Number.parseFloat(getThumbnailGridStyles(100, width)['--thumbnail-grid-size'])
    assert.equal(size * 2 + 8, width)
  }
})

test('every phone thumbnail slider step changes the card width proportionally', () => {
  for (const width of [313, 343, 380, 428.8]) {
    const defaultSize = (width - 8) / 2
    let previousSize = 0
    for (let size = 60; size <= 100; size += 10) {
      const cardSize = Number.parseFloat(getThumbnailGridStyles(size, width)['--thumbnail-grid-size'])
      assert.equal(cardSize, defaultSize * (size / 100))
      assert.ok(cardSize > previousSize)
      assert.ok(cardSize < width)
      previousSize = cardSize
    }
  }
})

test('only the full width view type fills the row with one card', () => {
  for (const [width, viewportWidth] of [[343, 343], [640, 640], [1200, 1440]]) {
    for (const size of [60, 100, 180]) {
      const sized = getThumbnailGridStyles(size, width, viewportWidth)
      const fullWidth = getThumbnailGridStyles(size, width, viewportWidth, width, true)
      assert.ok(Number.parseFloat(sized['--thumbnail-grid-size']) < width)
      assert.equal(fullWidth['--thumbnail-grid-size'], `${width}px`)
      assert.equal(fullWidth['--thumbnail-grid-stretch'], 'calc(100% - 0px)')
      // Wider windows keep sized Shorts; phones show them through the grid size.
      assert.equal(fullWidth['--shorts-thumbnail-grid-min-size'], sized['--shorts-thumbnail-grid-min-size'])
    }
  }
})

test('phone grids show larger saved sizes at two cards per row', () => {
  for (const width of [313, 343, 428.8]) {
    for (const size of [110, 140, 180]) {
      assert.deepEqual(getThumbnailGridStyles(size, width), getThumbnailGridStyles(100, width))
    }
  }
})

test('desktop grids retain proportional thumbnail sizing', () => {
  for (const width of [532, 800, 1200]) {
    const defaultSize = Number.parseFloat(getThumbnailGridStyles(100, width)['--thumbnail-grid-size'])
    for (const size of [60, 180]) {
      assert.equal(Number.parseFloat(getThumbnailGridStyles(size, width, 1200)['--thumbnail-grid-size']), defaultSize * (size / 100))
    }
  }
})

test('narrow grids in desktop viewports retain their full-width default', () => {
  assert.equal(getThumbnailGridStyles(100, 450, 900)['--thumbnail-grid-size'], '450px')
})

test('scales YouTube-style Shorts cards with the thumbnail size setting', () => {
  assert.equal(
    getThumbnailGridStyles(60)['--shorts-thumbnail-grid-min-size'],
    '114px'
  )
  assert.equal(
    getThumbnailGridStyles(100)['--shorts-thumbnail-grid-min-size'],
    '190px'
  )
  assert.equal(
    getThumbnailGridStyles(180)['--shorts-thumbnail-grid-min-size'],
    '342px'
  )
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

// Only the grid properties depend on the measured grid width; keeping the list
// ones separate is what lets them live on the document body.
test('keeps the grid and list properties separate', () => {
  assert.deepEqual(Object.keys(getThumbnailGridStyles(100, 800)), [
    '--thumbnail-grid-size',
    '--thumbnail-grid-stretch',
    '--shorts-thumbnail-grid-min-size'
  ])
  assert.deepEqual(getThumbnailListStyles(50), {
    '--thumbnail-list-size': '168px',
    '--thumbnail-list-max-size': '12.5vw',
    '--thumbnail-list-mobile-max-size': '15vw'
  })
})
