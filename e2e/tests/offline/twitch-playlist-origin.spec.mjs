import { createServer } from 'node:http'

import { expect, test } from '../../helpers/app.mjs'

test.use({
  launchArgs: ['--host-resolver-rules=MAP euc12.playlist.ttvnw.net 127.0.0.1', '--no-proxy-server']
})

test('sends the Twitch origin through Electron’s request hook', async ({ page }) => {
  let receivedOrigin
  const server = createServer((request, response) => {
    receivedOrigin = request.headers.origin
    response.writeHead(receivedOrigin === 'https://www.twitch.tv' ? 200 : 403, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/vnd.apple.mpegurl'
    }).end('#EXTM3U\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const url = `http://euc12.playlist.ttvnw.net:${server.address().port}/v1/playlist/test.m3u8`
    const status = await page.evaluate(async playlistUrl => (await fetch(playlistUrl)).status, url)
    expect(status).toBe(200)
    expect(receivedOrigin).toBe('https://www.twitch.tv')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
