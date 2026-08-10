import { test, expect, sel } from '../../helpers/app.mjs'

const COMMENT_ID = 'Ugw-comment-target'
const VIDEO_URL = `https://www.youtube.com/watch?v=jNQXAC9IVRw&lc=${COMMENT_ID}`

test.use({ launchArgs: [VIDEO_URL] })

// Regression: startup URLs were routed through the shared shell too late or
// interpreted as unrelated Electron arguments (79cba985a, b96ac4baa).
test('opens a YouTube startup URL directly in the initial tab', async ({ page }) => {
  await expect(page).toHaveURL(new RegExp(`#\\/watch\\/jNQXAC9IVRw\\?.*commentId=${COMMENT_ID}`))
  await expect(page.locator(sel.tabs)).toHaveCount(1)
})
