import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'
import { createI18n } from 'vue-i18n'

const files = {
  autoLoad: path.join(process.cwd(), 'src/renderer/components/FtAutoLoadNextPageWrapper.vue'),
  comments: path.join(process.cwd(), 'src/renderer/components/CommentSection/CommentSection.vue'),
  spinner: path.join(process.cwd(), 'src/renderer/components/FtSpinner/FtSpinner.vue'),
  userPlaylists: path.join(process.cwd(), 'src/renderer/views/UserPlaylists/UserPlaylists.vue'),
}

test('pagination controls pass translated labels to buttons and status indicators', async () => {
  const [autoLoad, comments, spinner, userPlaylists] = await Promise.all(
    Object.values(files).map(file => readFile(file, 'utf8'))
  )

  assert.match(autoLoad, /:label="\$t\('Global\.Loading More'\)"/)
  assert.match(comments, /:label="\$t\('Comments\.Load More Comments'\)"/)
  assert.match(userPlaylists, /:label="\$t\('User Playlists\.Load More Playlists'\)"/)
  assert.match(spinner, /:aria-label="label"/)
})

test('the comment loading status has a German accessibility name', async () => {
  const [english, german] = await Promise.all([
    readFile(path.join(process.cwd(), 'static/locales/en-US.yaml'), 'utf8'),
    readFile(path.join(process.cwd(), 'static/locales/de-DE.yaml'), 'utf8'),
  ])
  const i18n = createI18n({
    legacy: false,
    locale: 'de-DE',
    fallbackLocale: 'en-US',
    messages: {
      'de-DE': loadYaml(german),
      'en-US': loadYaml(english),
    },
  })

  assert.equal(i18n.global.t('Comments.Load More Comments'), 'Weitere Kommentare laden')
})
