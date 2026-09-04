import { readFile } from 'node:fs/promises'
import { test, expect } from '../../helpers/app.mjs'

test('nightly themed launcher wrench stays inside the adaptive icon safe zone', async ({ page }, testInfo) => {
  const xml = await readFile('android/app/src/debug/res/drawable/ic_launcher_nightly_monochrome.xml', 'utf8')
  const result = await page.evaluate(source => {
    const vector = new DOMParser().parseFromString(source, 'application/xml')
    const attribute = (element, name) => element.getAttributeNS('http://schemas.android.com/apk/res/android', name)
    const size = Number(attribute(vector.documentElement, 'viewportWidth'))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d')
    const groups = [...vector.querySelectorAll('group')]
    const draw = group => {
      context.save()
      context.translate(Number(attribute(group, 'translateX')), Number(attribute(group, 'translateY')))
      context.scale(Number(attribute(group, 'scaleX')), Number(attribute(group, 'scaleY')))
      for (const path of group.querySelectorAll('path')) {
        context.fill(new Path2D(attribute(path, 'pathData')))
      }
      context.restore()
    }

    draw(groups.at(-1))
    const pixels = context.getImageData(0, 0, size, size).data
    // Android guarantees the central 66dp circle of the 108dp adaptive layer.
    const safeRadius = size * 33 / 108
    let visiblePixels = 0
    let unsafePixels = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (pixels[(y * size + x) * 4 + 3] > 127) {
          visiblePixels++
          if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > safeRadius) unsafePixels++
        }
      }
    }

    context.clearRect(0, 0, size, size)
    context.beginPath()
    context.arc(size / 2, size / 2, size / 3, 0, Math.PI * 2)
    context.clip()
    context.fillStyle = '#302e43'
    context.fillRect(0, 0, size, size)
    context.fillStyle = '#c9c2ef'
    groups.forEach(draw)
    const preview = document.createElement('canvas')
    preview.width = preview.height = 144
    preview.getContext('2d').drawImage(canvas, size / 6, size / 6, size * 2 / 3, size * 2 / 3, 0, 0, 144, 144)
    return { visiblePixels, unsafePixels, preview: preview.toDataURL() }
  }, xml)

  await testInfo.attach('themed-launcher-icon', {
    body: Buffer.from(result.preview.split(',')[1], 'base64'),
    contentType: 'image/png'
  })
  expect(result.visiblePixels).toBeGreaterThan(0)
  expect(result.unsafePixels, 'wrench pixels outside the launcher safe zone').toBe(0)
})
