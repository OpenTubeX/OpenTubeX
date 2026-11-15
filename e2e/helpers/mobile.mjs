/** Keeps the simulated phone layout in place when Electron's App rerenders. */
export async function mockCapacitorPhoneLayout(page) {
  await page.locator('.app').evaluate(app => {
    const applyLayout = () => {
      for (const name of ['topTabs', 'bottomTabs', 'verticalTabs', 'verticalTabsLeft', 'verticalTabsRight']) {
        if (app.classList.contains(name)) app.classList.remove(name)
      }
      for (const name of ['capacitorTabs', 'capacitorPhoneLayout']) {
        if (!app.classList.contains(name)) app.classList.add(name)
      }
    }
    new MutationObserver(applyLayout).observe(app, { attributes: true, attributeFilter: ['class'] })
    applyLayout()
  })
}
