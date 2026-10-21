import { test, expect } from '../../helpers/app.mjs'

test.use({ seed: { settings: { currentLocale: 'en-US' } } })

// A selector keyed on the class attribute that ends in a universal descendant
// makes Chromium restyle the whole subtree of every element whose class
// changes, such as the body or a window that toggles its transition classes.
test('class changes restyle only the changed element', async ({ page }) => {
  await page.evaluate(() => window.$store.dispatch('showSettingsWindow'))
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('.settingsWindow')).not.toHaveClass(/settings-window-enter-active/)

  const session = await page.context().newCDPSession(page)
  const events = []
  session.on('Tracing.dataCollected', ({ value }) => events.push(...value))
  await session.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
  const subtreeSizes = await page.evaluate(() => Object.fromEntries(
    [['body', document.body], ['settings window', document.querySelector('.settingsWindow')]].map(([name, element]) => {
      // Reading a computed value flushes pending style work.
      const flushStyles = () => getComputedStyle(element).getPropertyValue('color')
      flushStyles()
      console.timeStamp(`${name} start`)
      for (const toggle of [true, false]) {
        element.classList.toggle('styleInvalidationProbe', toggle)
        flushStyles()
      }
      console.timeStamp(`${name} end`)
      return [name, element.querySelectorAll('*').length]
    })
  ))
  const complete = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
  await session.send('Tracing.end')
  await complete
  await session.detach()

  const stamp = message => events.find(event => event.name === 'TimeStamp' && event.args?.data?.message === message)
  for (const [name, subtreeSize] of Object.entries(subtreeSizes)) {
    const start = stamp(`${name} start`)
    const end = stamp(`${name} end`)
    const restyled = events
      .filter(event => event.name === 'UpdateLayoutTree' && event.tid === start.tid && event.ts >= start.ts && event.ts <= end.ts)
      .reduce((total, event) => total + (event.args?.elementCount ?? 0), 0)
    console.log(`Toggling a class on the ${name} restyled ${restyled} of ${subtreeSize} descendants`)
    expect(subtreeSize, `the ${name} needs a large subtree`).toBeGreaterThan(500)
    expect(restyled, `toggling a class on the ${name} restyled its subtree`).toBeLessThan(10)
  }
})
