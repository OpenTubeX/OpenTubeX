import { test, expect } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: {
      baseTheme: 'dark',
      uiScale: 95
    }
  }
})

async function captureControl (page, label) {
  const rect = await label.evaluate(element => element.getBoundingClientRect().toJSON())

  await page.evaluate(({ left: originLeft, top: originTop }) => {
    for (const { id, left, top, color } of [
      { id: 'alignment-marker-a', left: originLeft, top: originTop - 6, color: '#00ff00' },
      { id: 'alignment-marker-b', left: originLeft - 6, top: originTop, color: '#0000ff' }
    ]) {
      const marker = document.createElement('div')
      marker.id = id
      Object.assign(marker.style, {
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: '4px',
        height: '4px',
        backgroundColor: color,
        zIndex: '2147483647'
      })
      document.body.append(marker)
    }
  }, rect)

  const image = await page.screenshot()
  await page.evaluate(() => {
    document.querySelector('#alignment-marker-a').remove()
    document.querySelector('#alignment-marker-b').remove()
  })

  return { image, rect }
}

async function analyzeControl (page, unchecked, checked) {
  return page.evaluate(async ({ uncheckedCapture, checkedCapture }) => {
    const decode = async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()

      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)

      return {
        width: image.width,
        height: image.height,
        pixels: context.getImageData(0, 0, image.width, image.height).data
      }
    }

    const before = await decode(uncheckedCapture.image)
    const after = await decode(checkedCapture.image)
    const markerBounds = (pixels, channel) => {
      const points = []

      for (let y = 0; y < before.height; y++) {
        for (let x = 0; x < before.width; x++) {
          const offset = (y * before.width + x) * 4
          const color = pixels.slice(offset, offset + 3)
          const isMarker = channel === 'green'
            ? color[1] > 240 && color[0] < 10 && color[2] < 10
            : color[2] > 240 && color[0] < 10 && color[1] < 10

          if (isMarker) {
            points.push({ x, y })
          }
        }
      }

      return bounds(points)
    }

    const horizontalMarker = markerBounds(before.pixels, 'green')
    const verticalMarker = markerBounds(before.pixels, 'blue')
    const left = horizontalMarker.left
    const right = Math.min(before.width, left + 22)
    const top = verticalMarker.top
    const bottom = Math.min(before.height, top + 24)
    const colors = new Map()
    const borderPoints = []
    const indicatorPoints = []

    const distance = (first, second) => Math.hypot(
      first[0] - second[0],
      first[1] - second[1],
      first[2] - second[2]
    )

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * before.width + x) * 4
        const key = [...before.pixels.slice(offset, offset + 3)].join(',')
        colors.set(key, (colors.has(key) ? colors.get(key) : 0) + 1)
      }
    }

    const background = [...colors.entries()]
      .sort((first, second) => second[1] - first[1])[0][0]
      .split(',')
      .map(Number)

    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * before.width + x) * 4
        const beforeColor = before.pixels.slice(offset, offset + 3)
        const afterColor = after.pixels.slice(offset, offset + 3)

        if (distance(beforeColor, background) > 30) {
          borderPoints.push({ x: x - left, y: y - top })
        }
        if (distance(beforeColor, afterColor) > 30) {
          indicatorPoints.push({ x: x - left, y: y - top })
        }
      }
    }

    function bounds (points) {
      const xs = points.map(({ x }) => x)
      const ys = points.map(({ y }) => y)
      const left = Math.min(...xs)
      const right = Math.max(...xs)
      const top = Math.min(...ys)
      const bottom = Math.max(...ys)

      return {
        left,
        right,
        top,
        bottom,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2
      }
    }

    return {
      border: bounds(borderPoints),
      indicator: bounds(indicatorPoints)
    }
  }, {
    uncheckedCapture: {
      ...unchecked,
      image: unchecked.image.toString('base64')
    },
    checkedCapture: {
      ...checked,
      image: checked.image.toString('base64')
    }
  })
}

async function expectCenteredControl (page, label, testInfo, name) {
  const unchecked = await captureControl(page, label)

  await label.click()
  await page.evaluate(() => {
    if (document.activeElement) {
      document.activeElement.blur()
    }
  })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(450)

  const checked = await captureControl(page, label)
  await testInfo.attach(`${name}-unchecked`, { body: unchecked.image, contentType: 'image/png' })
  await testInfo.attach(`${name}-checked`, { body: checked.image, contentType: 'image/png' })

  const { border, indicator } = await analyzeControl(page, unchecked, checked)
  const offset = {
    x: indicator.centerX - border.centerX,
    y: indicator.centerY - border.centerY
  }

  const message = `${name} pixel bounds: ${JSON.stringify({ border, indicator })}`
  expect(Math.abs(offset.x), message).toBeLessThanOrEqual(0.5)
  expect(Math.abs(offset.y), message).toBeLessThanOrEqual(0.5)
}

test('radio dots and checkbox marks stay centered at 95% UI scale', async ({ page }, testInfo) => {
  await page.locator('.navFilterButton').click()
  await expect(page.getByRole('heading', { name: 'Search Filters' })).toBeVisible()
  await page.waitForTimeout(450)

  const videos = page.locator('.searchRadio', { hasText: 'Type' })
    .locator('label', { hasText: 'Videos' })
  const live = page.locator('.searchRadio', { hasText: 'Features' })
    .locator('label', { hasText: 'Live' })

  await expectCenteredControl(page, videos, testInfo, 'radio')
  await expectCenteredControl(page, live, testInfo, 'checkbox')
})
