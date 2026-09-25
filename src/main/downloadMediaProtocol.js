import path from 'node:path'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { DOWNLOADED_MEDIA_MIME_TYPES } from '../constants.js'

/**
 * @param {{
 *   protocol: Pick<import('electron').Protocol, 'handle'>,
 *   getDownloadFile: (id: number, videoId: string) => Promise<{path: string, mode: string} | null>
 * }} dependencies
 */
export function registerDownloadedMediaProtocol({ protocol, getDownloadFile }) {
  protocol.handle('downloadmedia', async (request) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const url = new URL(request.url)
    const [, rawId, videoId] = url.pathname.split('/')
    if (url.host !== 'file' || !/^\d+$/.test(rawId ?? '')) {
      return new Response(null, { status: 400 })
    }

    const file = await getDownloadFile(Number(rawId), videoId ?? '')
    if (file === null) return new Response(null, { status: 404 })

    let fileSize
    try {
      const fileStats = await stat(file.path)
      if (!fileStats.isFile()) {
        return new Response(null, { status: 404 })
      }
      fileSize = fileStats.size
    } catch {
      return new Response(null, { status: 404 })
    }
    const extension = path.extname(file.path).toLowerCase()
    const mimeType = file.mode === 'audio' && extension === '.webm'
      ? 'audio/webm'
      : file.mode === 'audio' && extension === '.mp4'
        ? 'audio/mp4'
        : DOWNLOADED_MEDIA_MIME_TYPES[extension.slice(1)] ?? 'application/octet-stream'
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeType
    }
    if (fileSize === 0) {
      return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } })
    }
    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
    let start = 0
    let end = fileSize - 1
    let status = 200

    if (rangeMatch !== null) {
      const [, rawStart, rawEnd] = rangeMatch
      if (rawStart === '') {
        const suffixLength = Number(rawEnd)
        start = Math.max(0, fileSize - suffixLength)
      } else {
        start = Number(rawStart)
        if (rawEnd !== '') end = Math.min(Number(rawEnd), end)
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileSize) {
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'Content-Range': `bytes */${fileSize}` }
        })
      }
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
    }

    headers['Content-Length'] = String(end - start + 1)
    const body = request.method === 'HEAD'
      ? null
      : Readable.toWeb(createReadStream(file.path, { start, end }))
    return new Response(body, { status, headers })
  })
}
