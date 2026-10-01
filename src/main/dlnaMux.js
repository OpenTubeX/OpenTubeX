import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createMediaServer } from './dlnaMediaServer.js'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

/** FFmpeg reads through local relays so credentials stay scoped to each source. */
export async function createMuxedMediaServer(videoUrl, audioUrl, address, token, options) {
  const video = createMediaServer(videoUrl, '127.0.0.1', token, options.videoHeaders)
  const audio = createMediaServer(audioUrl, '127.0.0.1', token, options.audioHeaders)
  const sources = [video, audio]
  const processes = new Set()
  const close = () => {
    for (const process of processes) process.kill('SIGKILL')
    for (const source of sources) {
      source.closeAllConnections()
      source.close()
    }
  }
  try {
    await Promise.all(sources.map(listen))
  } catch (error) {
    close()
    throw error
  }
  const urls = sources.map(source => `http://127.0.0.1:${source.address().port}/${token}/video.mp4`)
  const server = createServer((request, response) => {
    if (request.url !== `/${token}/video.mp4` || !['GET', 'HEAD'].includes(request.method) ||
        request.socket.remoteAddress?.replace(/^::ffff:/, '') !== address) {
      response.writeHead(404).end()
      return
    }
    // An in-progress fragmented MP4 has no stable byte offsets or final size.
    if (request.headers.range && !/^bytes=0-$/.test(request.headers.range)) {
      response.writeHead(416, { 'accept-ranges': 'none' }).end()
      return
    }
    const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'none', 'transfermode.dlna.org': 'Streaming' }
    if (request.method === 'HEAD') {
      response.writeHead(200, headers).end()
      return
    }
    if (processes.size >= 2) {
      response.writeHead(503).end()
      return
    }
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error']
    for (const url of urls) {
      if (options.startSeconds > 0) args.push('-ss', String(options.startSeconds))
      args.push('-i', url)
    }
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags',
      '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1')
    const process = spawn(options.ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    processes.add(process)
    const timeout = setTimeout(() => process.kill('SIGKILL'), 15_000)
    process.stdout.once('data', () => {
      clearTimeout(timeout)
      response.writeHead(200, headers)
    })
    process.stdout.pipe(response, { end: false })
    process.on('error', () => {
      if (!response.destroyed) server.muxFailed = true
      clearTimeout(timeout)
      processes.delete(process)
      if (!response.headersSent) response.writeHead(502).end()
      else response.destroy()
    })
    process.on('close', code => {
      clearTimeout(timeout)
      processes.delete(process)
      if (code === 0 && response.headersSent) response.end()
      else {
        if (!response.destroyed) server.muxFailed = true
        if (!response.headersSent) response.writeHead(502).end()
        else response.destroy()
      }
    })
    response.on('close', () => process.kill('SIGKILL'))
  })
  server.muxFailed = false
  server.on('close', close)
  return server
}
