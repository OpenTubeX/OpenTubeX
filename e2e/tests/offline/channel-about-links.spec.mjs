import { test, expect } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const WEBSITE_URL = 'https://example.org/community'

test.use({
  seed: {
    settings: {
      currentLocale: 'en-US',
      backendPreference: 'invidious',
      defaultInvidiousInstance: 'https://invidious.test',
      externalLinkHandling: 'openLinkAfterPrompt'
    }
  }
})

test('channel About links respect every external link opening policy', async ({ app, page }) => {
  await app.electronApp.evaluate(({ shell }) => {
    globalThis.channelAboutExternalUrls = []
    shell.openExternal = async url => {
      globalThis.channelAboutExternalUrls.push(url)
    }
  })
  const openedUrls = () => app.electronApp.evaluate(() => globalThis.channelAboutExternalUrls)

  await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
    json: {
      author: 'Example channel',
      authorId: CHANNEL_ID,
      authorThumbnails: [],
      authorBanners: [],
      description: `Visit ${WEBSITE_URL}`,
      subCount: 10,
      totalViews: 0,
      joined: 0,
      tabs: ['videos', 'about'],
      relatedChannels: [],
      videos: [],
      latestVideos: []
    }
  }))
  const tab = await page.evaluate(id => window.ftElectron.tabs.create({
    route: `/channel/${id}/about`, makeActive: false
  }), CHANNEL_ID)
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  await expect(page.locator('.aboutInfo:visible a')).toHaveAttribute('href', WEBSITE_URL)

  // Invidious has no dedicated links response. Supply the local backend's
  // parsed links at the component boundary and exercise its real anchors.
  await page.evaluate(url => {
    const find = vnode => {
      if (vnode?.component?.type?.__name === 'ChannelAbout') return vnode.component
      const nested = vnode?.component?.subTree && find(vnode.component.subTree)
      if (nested) return nested
      for (const child of Array.isArray(vnode?.children) ? vnode.children : []) {
        const match = find(child)
        if (match) return match
      }
    }
    find(document.querySelector('#app').__vue_app__._container._vnode).props.links = [
      { title: 'Community website', url, iconUrl: null }
    ]
  }, WEBSITE_URL)

  const prompt = page.getByRole('dialog', { name: 'Are you sure you want to open this link?' })
  const expectedUrls = []
  for (const selector of ['.aboutLink:visible', '.aboutInfo:visible a']) {
    const link = page.locator(selector)
    await expect(link).toHaveAttribute('href', WEBSITE_URL)
    for (const activation of ['click', 'middle click', 'Enter']) {
      const activate = () => activation === 'Enter'
        ? link.press('Enter')
        : link.click({ button: activation === 'middle click' ? 'middle' : 'left' })

      await activate()
      expect(await openedUrls(), `${selector} must wait for confirmation on ${activation}`).toEqual(expectedUrls)
      await expect(prompt).toBeVisible({ timeout: 5000 })
      await expect(prompt.getByText(WEBSITE_URL, { exact: true })).toBeVisible()
      await prompt.getByRole('button', { name: 'No', exact: true }).click()
      await expect(prompt).toBeHidden()
      expect(await openedUrls()).toEqual(expectedUrls)

      await activate()
      await expect(prompt).toBeVisible()
      await prompt.getByRole('button', { name: 'Yes, Open Link', exact: true }).click()
      expectedUrls.push(WEBSITE_URL)
      await expect.poll(openedUrls).toEqual(expectedUrls)
      await expect(prompt).toBeHidden()
    }

    for (const policy of ['doNothing', '']) {
      await page.evaluate(value => document.querySelector('#app').__vue_app__.config.globalProperties.$store
        .dispatch('updateExternalLinkHandling', value), policy)
      await link.click()
      if (policy === 'doNothing') {
        await expect(page.getByText('External link opening has been disabled in Settings → Privacy', { exact: true }).last()).toBeVisible()
        expect(await openedUrls()).toEqual(expectedUrls)
      } else {
        expectedUrls.push(WEBSITE_URL)
        await expect.poll(openedUrls).toEqual(expectedUrls)
      }
      await expect(prompt).toBeHidden()
    }
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
      .dispatch('updateExternalLinkHandling', 'openLinkAfterPrompt'))
  }
})
