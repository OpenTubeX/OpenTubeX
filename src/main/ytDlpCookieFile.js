import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

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
 * @param {boolean} finished whether the process exited on its own, so that it finished saving
 * @returns {string | null} the merged file, or null when nothing changed
 */
export function mergeYtDlpCookies(base, result, current, finished) {
  // yt-dlp writes the header first and ends every cookie with a newline. A
  // process stopped while saving can still leave complete rows, so only one
  // that finished saving can remove the cookies missing from its file.
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
  for (const [key, cookie] of finished ? before : []) {
    if (after.has(key) || merged.get(key)?.state !== cookie.state) continue
    merged.delete(key)
    changed = true
  }
  return changed ? `${HEADER}\n${[...merged.values()].map(cookie => `${cookie.line}\n`).join('')}` : null
}

/**
 * Replaces a file with a complete temporary one, so that a failed write keeps
 * the previous cookies. A folder without room for it is written in place.
 * @param {string} path
 * @param {string} text
 */
function replaceFile(path, text) {
  const target = realpathSync(path)
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' })
  } catch {
    rmSync(temporary, { force: true })
    writeFileSync(target, text)
    return
  }
  try {
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * yt-dlp rewrites its `--cookies` file when it exits. Processes that shared one
 * could read another's partial write, and the last to exit would discard the
 * cookies YouTube rotated for the others. Each process gets a private copy
 * instead, which `release` merges back once it exits. The file operations are
 * synchronous, so no other process's copy or merge can run between them.
 * @param {string[]} args
 * @returns {{ args: string[], release: (finished: boolean) => void }}
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
    release(finished) {
      if (released) return
      released = true
      try {
        const merged = mergeYtDlpCookies(base, readFileSync(copy, 'utf8'), readFileSync(shared, 'utf8'), finished)
        if (merged !== null) replaceFile(shared, merged)
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
  let result
  try {
    result = await run(cookies.args)
  } catch (error) {
    // execFile reports the exit code of a process that exited with an error,
    // and none for one it stopped after a timeout or abort.
    cookies.release(typeof error?.code === 'number' && !error.killed)
    throw error
  }
  cookies.release(true)
  return result
}
