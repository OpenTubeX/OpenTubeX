import { test, expect, goToSettingsSection } from '../../helpers/app.mjs'

// One element per stylesheet that used to stop its motion only for the
// system preference: SideNav, DesktopNavItem, TopNav, FtToggleSwitch,
// FtSelect and FtButton.
const PROBES = {
  sideNav: ['.sideNav'],
  navItem: ['.sideNav .navOption', '::before'],
  topNavButton: ['.topNav .navButton'],
  toggleSwitch: ['.settingsWindow .switch-label-text', '::before'],
  select: ['.settingsWindow .select-bar', '::before'],
  button: ['.settingsWindow .btn']
}

/** The longest transition of each probe, in milliseconds. */
function transitionDurations(page) {
  return page.evaluate((probes) => Object.fromEntries(Object.entries(probes).map(([name, [selector, pseudo]]) => {
    const element = document.querySelector(selector)
    if (!element) return [name, null]
    const durations = getComputedStyle(element, pseudo).transitionDuration.split(',')
    return [name, Math.max(...durations.map(duration => Number.parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000)))]
  })), PROBES)
}

async function openSettingsWithControls(page) {
  // Appearance has switches, selects and buttons.
  const content = await goToSettingsSection(page, 'appearance')
  await expect(content.locator('.switch-label-text').first()).toBeVisible()
  await expect(content.locator('.select-bar').first()).toBeAttached()
  await expect(content.locator('.btn').first()).toBeAttached()
}

test('the Reduced Motion setting overrides the system preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'off'))
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'no-preference')
  await openSettingsWithControls(page)

  const animated = await transitionDurations(page)
  for (const [name, duration] of Object.entries(animated)) {
    expect.soft(duration, `${name} animates with Reduced Motion off`).toBeGreaterThan(0)
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.$store.dispatch('updateReducedMotion', 'on'))
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'reduce')

  const reduced = await transitionDurations(page)
  for (const [name, duration] of Object.entries(reduced)) {
    expect.soft(duration, `${name} stays still with Reduced Motion on`).toBe(0)
  }
})
