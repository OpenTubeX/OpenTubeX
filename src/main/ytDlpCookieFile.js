import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HEADER = '# Netscape HTTP Cookie File'

/**
 * Reads the cookies of a Netscape cookie file, keyed like yt-dlp's cookie jar.
 * @param {string} text
 * @returns {Map<string, { line: string, state: string }>}
 */
function parseCookies(text) {
  const cookies = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) continue
    const fields = line.replace(/^#HttpOnly_/, '').split('\t')
    if (fields.length !== 7) continue
    const [domain, , path, secure, expires, name, value] = fields
    // yt-dlp drops the HttpOnly prefix and stores session cookies as expiring at
    // 0 when it saves, so only compare what it keeps.
    cookies.set(`${domain}\t${path}\t${name}`, { line, state: `${secure}\t${Math.trunc(Number(expires)) || 0}\t${value}` })
  }
  return cookies
}

/**
 * Applies the cookies one yt-dlp process changed to the current file, keeping
 * those other processes changed in the meantime.
 * @param {string} base the file the process started with
 * @param {string} result the file the process saved
 * @param {string} current the shared file now
 * @returns {string | null} the merged file, or null when nothing changed
 */
export function mergeYtDlpCookies(base, result, current) {
  // yt-dlp writes the header first and ends every cookie with a newline, so
  // a process stopped while saving must not remove the cookies it did not write.
  if (!result.startsWith(HEADER) || !result.endsWith('\n')) return null
  const before = parseCookies(base)
  const after = parseCookies(result)
  const merged = parseCookies(current)
  let changed = false
  for (const [key, cookie] of after) {
    if (before.get(key)?.state === cookie.state || merged.get(key)?.state === cookie.state) continue
    merged.set(key, cookie)
    changed = true
  }
  for (const [key, cookie] of before) {
    if (after.has(key) || merged.get(key)?.state !== cookie.state) continue
    merged.delete(key)
    changed = true
  }
  return changed ? `${HEADER}\n${[...merged.values()].map(cookie => `${cookie.line}\n`).join('')}` : null
}

/**
 * yt-dlp rewrites its `--cookies` file when it exits. Processes that shared one
 * could read another's partial write, and the last to exit would discard the
 * cookies YouTube rotated for the others. Each process gets a private copy
 * instead, which `release` merges back once it exits. The file operations are
 * synchronous, so no other process's copy or merge can run between them.
 * @param {string[]} args
 * @returns {{ args: string[], release: () => void }}
 */
export function checkOutYtDlpCookies(args) {
  const index = args.lastIndexOf('--cookies')
  const shared = args[index + 1]
  if (index === -1 || shared === undefined) return { args, release() {} }
  let base
  try {
    base = readFileSync(shared, 'utf8')
  } catch {
    // yt-dlp reports the missing file.
    return { args, release() {} }
  }
  let directory
  let copy
  try {
    directory = mkdtempSync(join(tmpdir(), 'opentubex-cookies-'))
    copy = join(directory, 'cookies.txt')
    writeFileSync(copy, base, { mode: 0o600 })
  } catch (error) {
    // Without room for a copy, share the file as before instead of failing the process.
    console.warn('Could not copy the yt-dlp cookie file', error.code ?? error)
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
    return { args, release() {} }
  }
  let released = false
  return {
    args: args.with(index + 1, copy),
    release() {
      if (released) return
      released = true
      try {
        const merged = mergeYtDlpCookies(base, readFileSync(copy, 'utf8'), readFileSync(shared, 'utf8'))
        if (merged !== null) writeFileSync(shared, merged)
      } catch (error) {
        console.warn('Could not save the cookies yt-dlp updated', error.code ?? error)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  }
}

/**
 * Runs one yt-dlp process with a private copy of its cookie file.
 * @template T
 * @param {string[]} args
 * @param {(args: string[]) => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withYtDlpCookies(args, run) {
  const cookies = checkOutYtDlpCookies(args)
  try {
    return await run(cookies.args)
  } finally {
    cookies.release()
  }
}
