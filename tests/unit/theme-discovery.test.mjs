import assert from 'node:assert/strict'
import { test } from 'node:test'
import { themeScreenshotUrl } from '../../src/renderer/helpers/themeDiscovery.js'

test('does not load screenshot URLs from third-party servers or local resources', () => {
  for (const url of [
    'file:///etc/passwd', 'data:image/svg+xml,test', 'javascript:alert(1)',
    'http://github.com/user-attachments/assets/id',
    'https://github.com.evil.test/user-attachments/assets/id',
    'https://tracker.test/image.png', 'https://127.0.0.1/image.png',
    'https://user:pass@github.com/user-attachments/assets/id',
    'https://github.com:444/user-attachments/assets/id',
    'https://github.com/OpenTubeX/OpenTubeX',
    'https://private-user-images.githubusercontent.com/not-an-attachment',
    null,
  ]) assert.equal(themeScreenshotUrl(url), null, String(url))
})
