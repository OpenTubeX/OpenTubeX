import assert from 'node:assert/strict'
import test from 'node:test'

import { getChannelAboutLinks } from '../../src/renderer/views/Channel/channel-about-links.js'

const link = (title, url, favicon = []) => ({
  title: { text: title },
  link: { endpoint: { toURL: () => url } },
  favicon,
})

test('channel About links use their destination instead of the YouTube redirect', () => {
  const about = { metadata: { links: [
    link('Website', 'https://www.youtube.com/redirect?event=channel_description&q=https%3A%2F%2Fexample.org%2F', [
      { width: 16, url: 'https://encrypted-tbn1.gstatic.com/favicon-tbn?q=small' },
      { width: 32, url: 'https://encrypted-tbn1.gstatic.com/favicon-tbn?q=icon' },
    ]),
    link('Direct icon', 'https://example.org/icon', [{ width: 32, url: 'https://example.org/favicon.ico' }]),
    link('Email', 'mailto:hello@example.org'),
    link('Broken', 'https://www.youtube.com/redirect?event=channel_description'),
  ] } }

  assert.deepEqual(getChannelAboutLinks(about), [
    { title: 'Website', url: 'https://example.org/', iconUrl: 'https://encrypted-tbn1.gstatic.com/favicon-tbn?q=icon' },
    { title: 'Direct icon', url: 'https://example.org/icon', iconUrl: null },
  ])
})

test('channel About links support the full metadata response', () => {
  const about = { primary_links: [{
    title: { text: 'Community' },
    endpoint: { toURL: () => 'https://example.org/community' },
    icon: [{ width: 24, url: 'https://encrypted-tbn2.gstatic.com/favicon-tbn?q=community' }],
  }] }

  assert.deepEqual(getChannelAboutLinks(about), [
    { title: 'Community', url: 'https://example.org/community', iconUrl: 'https://encrypted-tbn2.gstatic.com/favicon-tbn?q=community' },
  ])
})
