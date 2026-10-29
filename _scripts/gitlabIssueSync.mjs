import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { toHast } from 'mdast-util-to-hast'
import { raw } from 'hast-util-raw'
import { fromHtml } from 'hast-util-from-html'
import { visit, SKIP } from 'unist-util-visit'
import { VFile } from 'vfile'
import { escapeAttribute } from 'entities'
import { parseSrcset, stringifySrcset } from 'srcset'

const project = 'opentubex/OpenTubeX'
// GitLab serves uploads through the stable project ID, not the repository path.
const uploadsUrl = 'https://gitlab.com/-/project/85121418/uploads/'
const repository = 'OpenTubeX/OpenTubeX'
// GitLab rate-limits GitHub's image proxy, so images are copied to GitHub.
const mediaRepository = 'OpenTubeX/media'
const mediaRelease = 'gitlab-uploads'
const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']
const githubBot = 'github-actions[bot]'
const prefix = 'opentubex-sync'
const marker = (kind, id) => `<!-- ${prefix}:${kind}:${id} -->`
class SyncError extends Error {}

function markedId(body, kind) {
  return body?.match(new RegExp(`^<!-- ${prefix}:${kind}:(\\d+) -->`))?.[1]
}

function linkedState(body) {
  return body?.match(/^<!-- opentubex-sync:state:(opened|closed) -->$/m)?.[1]
}

function linkBody(issue, state) {
  return `${marker('link', issue.number)}\n<!-- ${prefix}:state:${state} -->\nThis report is tracked on [GitHub](${issue.html_url}). Comments, comment edits, and status changes are mirrored both ways. Edit this GitLab report to update its GitHub title and description. Triage is managed on GitHub.`
}

const serialize = node => toMarkdown(node, { extensions: [gfmToMarkdown()], unsafe: [{ character: '|' }] }).trimEnd()

// Libraries parse Markdown and embedded HTML; source edits preserve untouched text.
function markdown(body, transform) {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const htmlStarts = new Map()
  visit(tree, 'html', node => {
    visit(fromHtml(node.value, { fragment: true }), 'element', element => {
      if (element.position) htmlStarts.set(node.position.start.offset + element.position.start.offset, element.tagName)
    })
  })
  const html = toHast(tree, { allowDangerousHtml: true })
  const links = new Map()
  visit(html, 'element', node => {
    if (node.tagName === 'a' && node.position) links.set(node.position.start.offset, node.properties)
  })
  const protectedHtml = []
  visit(raw(html, { file: new VFile(body) }), 'element', node => {
    if (['a', 'code', 'pre', 'script', 'style', 'textarea'].includes(node.tagName) && htmlStarts.get(node.position?.start.offset) === node.tagName) protectedHtml.push(node.position)
  })
  const edits = []
  visit(tree, (node, index, parent) => {
    if (!node.position) return
    const { start, end } = node.position
    if (['code', 'inlineCode'].includes(node.type)) return SKIP
    if (['text', 'link', 'linkReference', 'image'].includes(node.type) && protectedHtml.some(region => start.offset >= region.start.offset && end.offset <= region.end.offset)) return SKIP
    if (node.type === 'linkReference' && links.has(start.offset)) {
      const { href, title } = links.get(start.offset)
      node = { ...node, type: 'link', url: href, title: title ?? null }
    }
    const original = body.slice(start.offset, end.offset)
    const replacement = transform(node, original, index, parent)
    if (replacement != null && replacement !== original) edits.push({ start: start.offset, end: end.offset, replacement })
    if (['html', 'image', 'imageReference', 'definition', 'link', 'linkReference'].includes(node.type)) return SKIP
  })
  for (const edit of edits.reverse()) body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end)
  return body
}

export function content(body = '', fromGitlab = false, mirrored = () => {}) {
  const upload = url => fromGitlab && url.startsWith('/uploads/') ? mirrored(url) ?? uploadsUrl + url.slice('/uploads/'.length) : url
  return markdown(body ?? '', (node, original, index, parent) => {
    if (node.type === 'html') {
      const html = fromHtml(original, { fragment: true, verbose: true })
      const edits = []
      visit(html, element => {
        if (element.type === 'comment' && element.value.trimStart().startsWith(`${prefix}:`)) {
          edits.push({ ...element.position, replacement: '' })
        }
        for (const key of ['src', 'href', 'poster', 'srcSet']) {
          const value = element.properties?.[key]
          const position = element.data?.position?.properties[key]
          if (typeof value !== 'string' || !position) continue
          const candidates = key === 'srcSet' ? parseSrcset(value) : [{ url: value }]
          if (!candidates.some(({ url }) => upload(url) !== url)) continue
          const updated = candidates.map(candidate => ({ ...candidate, url: upload(candidate.url) }))
          const attribute = key === 'srcSet' ? stringifySrcset(updated) : updated[0].url
          edits.push({ ...position, replacement: `${key.toLowerCase()}="${escapeAttribute(attribute)}"` })
        }
      })
      for (const { start, end, replacement } of edits.sort((a, b) => b.start.offset - a.start.offset)) {
        original = original.slice(0, start.offset) + replacement + original.slice(end.offset)
      }
      return original
    }
    if (node.url) {
      const url = upload(node.url)
      // GitLab video embeds use image nodes; GitHub needs a normal link.
      const video = fromGitlab && node.type === 'image' && URL.canParse(url, 'https://gitlab.com') && ['mp4', 'm4v', 'mov', 'webm', 'ogv'].includes(new URL(url, 'https://gitlab.com').pathname.split('.').at(-1).toLowerCase())
      if (video) return serialize({ type: 'link', url, title: node.title, children: [{ type: 'text', value: node.alt || 'Video' }] })
      if (url !== node.url) return serialize({ ...node, url })
    }
    if (node.type === 'text') {
      // GitLab matches command names with Unicode case folding after deleting \r.
      if (!fromGitlab) return original.replace(/^( {0,3})\/(?=[\p{L}\p{N}_]+(?:\s|$))/gmu, '$1&#47;')
      // These attributes are GitLab-specific image metadata, not Markdown grammar.
      if (parent?.children[index - 1]?.type === 'image') original = original.replace(/^\{[ \t]*(?:(?:width|height)=(["']?)\d+(?:px|%)?\1[ \t]*)+\}/, '')
      return original.replace(/(^|[(<"'\s])\/uploads\//g, `$1${uploadsUrl}`)
    }
  })
}

function githubBody(header, body) {
  const available = 65536 - header.length - 2
  if (body.length <= available) return `${header}\n\n${body}`
  const notice = '> Truncated to fit GitHub. Read the full text at the original GitLab link above.\n\n'
  // UTF-16 length is conservative for astral characters; never split a surrogate pair.
  const excerpt = body.slice(0, available - notice.length).replace(/[\uD800-\uDBFF]$/, '')
  return `${header}\n\n${notice}${excerpt}`
}

function issueBody(issue, references, mirrored) {
  const header = `${marker('issue', issue.iid)}\nReported by ${content(issue.author.username)} on [GitLab](${issue.web_url}).`
  return githubBody(header, references(content(issue.description, true, mirrored), 'gitlab'))
}

function commentBody(comment, side, issue, references, mirrored) {
  const gitlab = side === 'gitlab'
  const author = gitlab ? comment.author.username : comment.user.login
  const url = gitlab ? `${issue.web_url}#note_${comment.id}` : comment.html_url
  const header = `${marker(side, comment.id)}\n${content(author)} on [${gitlab ? 'GitLab' : 'GitHub'}](${url}):`
  const body = references(content(comment.body, gitlab, mirrored), side)
  return gitlab ? githubBody(header, body) : `${header}\n\n${body}`
}

function referenceResolver(sources, targets, mergeRequests) {
  const gitlab = new Map(sources.filter(issue => issue.confidential === false).map(issue => [`#${issue.iid}`, issue]))
  for (const request of mergeRequests) {
    if (!request.confidential) gitlab.set(`!${request.iid}`, request)
  }
  const gitlabReferences = new Map([...gitlab].map(([reference, item]) => [item.web_url, reference]))
  const github = new Map(targets.map(issue => [`#${issue.number}`, issue]))
  const counterparts = new Map()
  const pair = (source, target) => {
    counterparts.set(source.web_url, target)
    counterparts.set(target.html_url, source)
    github.set(`#${target.number}`, target)
  }
  for (const target of targets) {
    const source = !target.pull_request && target.user.login === githubBot && gitlab.get(`#${markedId(target.body, 'issue')}`)
    if (source) pair(source, target)
  }
  // GitLab's importer renumbers issues and merge requests. A unique title of
  // the same item type is evidence of a match; equal numbers are not.
  for (const [reference, source] of gitlab) {
    if (source.imported_from !== 'github') continue
    const request = reference.startsWith('!')
    const matches = targets.filter(target => Boolean(target.pull_request) === request && target.title === source.title)
    const originals = [...gitlab].filter(([ref, item]) => ref.startsWith('!') === request && item.title === source.title)
    if (matches.length === 1 && originals.length === 1) pair(source, matches[0])
  }
  const link = (value, url, title = null) => serialize({
    type: 'link', url, title, children: [{ type: 'text', value: value.replace(/\s+/g, ' ') }],
  })
  const render = (reference, side, suffix = '', tooltip = null) => {
    const item = (side === 'gitlab' ? gitlab : github).get(reference)
    const host = side === 'gitlab' ? 'GitLab' : 'GitHub'
    const url = item?.web_url ?? item?.html_url ?? (side === 'gitlab'
      ? `https://gitlab.com/${project}/-/${reference[0] === '!' ? 'merge_requests' : 'issues'}/${reference.slice(1)}`
      : `https://github.com/${repository}/issues/${reference.slice(1)}`)
    const other = counterparts.get(url)
    const original = link(item?.title ?? `${host} ${reference}`, url + suffix, tooltip)
    if (!other) return original
    const otherSide = side === 'gitlab' ? 'GitHub' : 'GitLab'
    const otherReference = side === 'gitlab' ? `#${other.number}` : gitlabReferences.get(other.web_url)
    return `${original} (${link(`${otherSide} ${otherReference}`, other.html_url ?? other.web_url)})`
  }
  const urlReference = (url, side, tooltip = null) => {
    if (!URL.canParse(url)) return
    const parsed = new URL(url)
    const base = side === 'gitlab' ? `https://gitlab.com/${project}/-/` : `https://github.com/${repository}/`
    if (!(parsed.origin + parsed.pathname).toLowerCase().startsWith(base.toLowerCase())) return
    const [kind, id, ...extra] = parsed.pathname.slice(new URL(base).pathname.length).split('/')
    const kinds = side === 'gitlab' ? ['issues', 'work_items', 'merge_requests'] : ['issues', 'pull']
    if (extra.length > 1 || extra.some(Boolean) || !kinds.includes(kind.toLowerCase()) || !/^\d+$/.test(id)) return
    return render(`${kind.toLowerCase() === 'merge_requests' ? '!' : '#'}${id}`, side, parsed.search + parsed.hash, tooltip)
  }
  const rewrite = (body, side) => markdown(body, (node, original) => {
    if (node.type === 'link') return urlReference(node.url, side, node.title)
    if (node.type !== 'text') return
    // Tracker syntax and non-HTTP URL fragments are application-specific.
    const tokens = /\\.|(?<![\w/&#])(?:opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX|OpenTubeX)?[#!]\d+\b|(?<![\w/&#@-])GH-\d+\b(?![@-])|(?<!\w)(?:[a-z][a-z\d+.-]*:|\.{0,2}\/|[\w.-]+[/?#])[^\s<>]+|[?#][^\s<>]+/gi
    return original.replace(tokens, token => {
      const gh = side === 'github' && token.match(/^GH-(\d+)$/i)
      if (gh) return render(`#${gh[1]}`, side)
      const reference = token.match(/^(opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX|OpenTubeX)?([#!]\d+)$/i)
      return reference && (side === 'gitlab' || (reference[2][0] === '#' && reference[1]?.toLowerCase() !== 'opentubex'))
        ? render(reference[2], side)
        : token
    })
  })
  return { rewrite, pair }
}

function mediaMirror(client) {
  const mirrored = new Map()
  const failures = []
  let releases
  return {
    failures,
    url: path => mirrored.get(path),
    async add(bodies) {
      const paths = new Set()
      for (const body of bodies) content(body, true, path => { paths.add(path) })
      for (const path of paths) {
        const [, secret, file] = path.match(/^\/uploads\/([\da-f]{32})\/([^/?#]+)$/) ?? []
        if (!secret || mirrored.has(path) || !imageExtensions.includes(file.split('.').at(-1).toLowerCase())) continue
        try {
          // Names derive from GitLab's upload secret, so each file is copied once.
          const name = `${secret}-${file.replace(/[^\w.-]+/g, '-')}`
          releases ??= await Promise.all((await list(client, 'media', `repos/${mediaRepository}/releases`))
            .filter(release => release.tag_name === mediaRelease || release.tag_name.startsWith(`${mediaRelease}-`))
            .map(async release => ({ ...release, assets: await list(client, 'media', `repos/${mediaRepository}/releases/${release.id}/assets`) })))
          let asset = releases.flatMap(release => release.assets)
            // An interrupted upload leaves an empty asset in the starter state.
            .find(asset => asset.name === name && asset.state === 'uploaded')
          if (!asset) {
            const download = await client.download(path)
            // Deleted uploads keep their GitLab link.
            if (download.status === 404) continue
            if (!download.bytes) throw new SyncError(`GitLab upload download: HTTP ${download.status}`)
            if (!download.type?.startsWith('image/')) continue
            let release = releases.find(release => release.assets.length < 1000)
            if (!release) {
              const tag = releases.length ? `${mediaRelease}-${releases.length + 1}` : mediaRelease
              release = {
                ...await client.media(`repos/${mediaRepository}/releases`, 'POST', {
                  tag_name: tag, name: tag, body: 'Images copied from GitLab reports mirrored to OpenTubeX/OpenTubeX.', make_latest: 'false',
                }),
                assets: []
              }
              releases.push(release)
            }
            asset = await client.media(`https://uploads.github.com/repos/${mediaRepository}/releases/${release.id}/assets?name=${name}`, 'POST', download.bytes, download.type)
            release.assets.push(asset)
          }
          mirrored.set(path, asset.browser_download_url)
        } catch (error) {
          failures.push(`GitLab upload ${secret}: ${error instanceof SyncError ? error.message : 'request failed'}`)
        }
      }
    },
  }
}

export function createClient(token, mediaToken) {
  const gh = (args, input, env) => {
    try {
      return JSON.parse(execFileSync('gh', args, {
        input,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 20 * 1024 * 1024,
        // Avoid emitting response bodies containing user content into Actions logs.
        stdio: ['pipe', 'pipe', 'pipe'],
      }))
    } catch (error) {
      const status = error.stderr?.toString().match(/HTTP (\d{3})/)?.[1]
      throw new SyncError(`GitHub ${args[3]} ${args[1]} failed${status ? `: HTTP ${status}` : ''}`)
    }
  }
  return {
    async gl(path, method = 'GET', body) {
      const headers = { 'Content-Type': 'application/json' }
      // Public MR metadata needs no authentication; keep the existing Work Item
      // sync token usable without adding Merge Request permissions.
      if (method !== 'GET' || path.split('?')[0] !== `projects/${encodeURIComponent(project)}/merge_requests`) {
        headers['PRIVATE-TOKEN'] = token
      }
      const response = await fetch(`https://gitlab.com/api/v4/${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw new SyncError(`GitLab ${method} ${path}: HTTP ${response.status}`)
      return response.json()
    },
    async gh(path, method = 'GET', body) {
      // Space mutations to stay below GitHub's secondary content-creation limits.
      if (method !== 'GET') await setTimeout(1100)
      return gh(['api', path, '--method', method, ...body ? ['--input', '-'] : []], body && JSON.stringify(body))
    },
    // GITHUB_TOKEN cannot write to the media repository.
    async media(path, method = 'GET', body, type) {
      const args = ['api', path, '--method', method]
      const env = { GH_TOKEN: mediaToken }
      if (!Buffer.isBuffer(body)) return gh([...args, ...body ? ['--input', '-'] : []], body && JSON.stringify(body), env)
      // Asset uploads need a Content-Length, which gh only sends for file input.
      const directory = mkdtempSync(join(tmpdir(), 'gitlab-upload-'))
      try {
        writeFileSync(join(directory, 'asset'), body)
        return gh([...args, '--input', join(directory, 'asset'), '-H', `Content-Type: ${type}`], undefined, env)
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
    async download(path) {
      const response = await fetch(uploadsUrl + path.slice('/uploads/'.length), { redirect: 'error', signal: AbortSignal.timeout(30000) })
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        bytes: response.ok ? Buffer.from(await response.arrayBuffer()) : null,
      }
    },
  }
}

export async function list(client, side, path) {
  const items = []
  for (let page = 1; ; page++) {
    const batch = await client[side](`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!Array.isArray(batch)) throw new Error(`Expected a list from ${side}`)
    items.push(...batch)
    if (batch.length < 100) return items
  }
}

// GitLab notes written by people, excluding the sync's own copies and backlinks.
const gitlabNote = (note, bot) => !note.system && !note.internal && !note.confidential &&
  !(note.author.id === bot.id && (markedId(note.body, 'github') || markedId(note.body, 'link')))

export async function sync(client) {
  const glBase = `projects/${encodeURIComponent(project)}/issues`
  const ghBase = `repos/${repository}/issues`
  const bot = await client.gl('user')
  const sources = await list(client, 'gl', `${glBase}?scope=all&state=all&order_by=created_at&sort=asc`)
  const allTargets = await list(client, 'gh', `${ghBase}?state=all&sort=created&direction=asc`)
  const mergeRequests = await list(client, 'gl', `projects/${encodeURIComponent(project)}/merge_requests?scope=all&state=all`)
  const references = referenceResolver(sources, allTargets, mergeRequests)
  const targets = allTargets
    .filter(issue => !issue.pull_request && issue.user.login === githubBot)
  let synced = 0
  const failures = []
  const prepared = []
  const media = mediaMirror(client)
  // Establish every native issue's counterpart before rendering references,
  // including references to reports created later in the same sync run.
  for (const source of sources) {
    // Only native public reports. Imported GitHub issues already have originals.
    if (source.confidential !== false || source.imported || source.imported_from === 'github') continue
    try {
      const glIssue = `${glBase}/${source.iid}`
      const notes = await list(client, 'gl', `${glIssue}/notes?sort=asc&order_by=created_at`)
      await media.add([source.description, ...notes.filter(note => gitlabNote(note, bot)).map(note => note.body)])
      const link = notes.find(note => note.author.id === bot.id && markedId(note.body, 'link'))
      const linkedNumber = link && Number(markedId(link.body, 'link'))
      let target = linkedNumber
        ? targets.find(issue => issue.number === linkedNumber)
        : targets.find(issue => markedId(issue.body, 'issue') === String(source.iid))
      // Never silently duplicate a linked issue that was deleted or transferred.
      if (linkedNumber && !target) throw new SyncError(`Missing linked GitHub issue for GitLab #${source.iid}`)
      if (!target) {
        target = await client.gh(ghBase, 'POST', { title: source.title, body: issueBody(source, references.rewrite, media.url) })
        targets.push(target)
      }
      references.pair(source, target)
      prepared.push({ source, target, notes, link })
    } catch (error) {
      failures.push(`GitLab #${source.iid}: ${error instanceof SyncError ? error.message : 'request failed'}`)
    }
  }
  for (const { source, target, notes, link } of prepared) {
    try {
      const glIssue = `${glBase}/${source.iid}`
      const body = issueBody(source, references.rewrite, media.url)
      if (target.title !== source.title || target.body !== body) {
        await client.gh(`${ghBase}/${target.number}`, 'PATCH', { title: source.title, body })
        Object.assign(target, { title: source.title, body })
      }
      // Read status again after content updates, so a concurrent triage change wins.
      const current = await client.gh(`${ghBase}/${target.number}`)
      const githubState = current.state === 'closed' ? 'closed' : 'opened'
      let state = githubState
      if (source.state !== githubState) {
        // The backlink records the state seen at the last successful sync, so
        // the side that changed since then determines the new shared state.
        // For older backlinks without a state marker, preserve a closure.
        const previous = linkedState(link?.body)
        state = previous === githubState ? source.state : previous === source.state ? githubState : 'closed'
        if (state !== githubState) {
          await client.gh(`${ghBase}/${target.number}`, 'PATCH', { state: state === 'closed' ? 'closed' : 'open' })
        } else {
          await client.gl(glIssue, 'PUT', { state_event: state === 'closed' ? 'close' : 'reopen' })
        }
      }
      const backlink = linkBody(target, state)
      if (!link) {
        await client.gl(`${glIssue}/notes`, 'POST', { body: backlink })
      } else if (link.body !== backlink) {
        await client.gl(`${glIssue}/notes/${link.id}`, 'PUT', { body: backlink })
      }
      const comments = await list(client, 'gh', `${ghBase}/${target.number}/comments`)
      for (const note of notes) {
        if (!gitlabNote(note, bot)) continue
        const existing = comments.find(comment => comment.user.login === githubBot &&
          markedId(comment.body, 'gitlab') === String(note.id))
        const body = commentBody(note, 'gitlab', source, references.rewrite, media.url)
        if (!existing) {
          await client.gh(`${ghBase}/${target.number}/comments`, 'POST', { body })
        } else if (existing.body !== body) {
          await client.gh(`${ghBase}/comments/${existing.id}`, 'PATCH', { body })
        }
      }
      for (const comment of comments) {
        if (comment.user.login === githubBot && markedId(comment.body, 'gitlab')) continue
        const existing = notes.find(note => note.author.id === bot.id &&
          markedId(note.body, 'github') === String(comment.id))
        const body = commentBody(comment, 'github', source, references.rewrite)
        if (!existing) {
          await client.gl(`${glIssue}/notes`, 'POST', { body })
        } else if (existing.body !== body) {
          await client.gl(`${glIssue}/notes/${existing.id}`, 'PUT', { body })
        }
      }
      synced++
    } catch (error) {
      failures.push(`GitLab #${source.iid}: ${error instanceof SyncError ? error.message : 'request failed'}`)
    }
  }
  // Reports with uncopied images still sync with GitLab links and are repaired by a later run.
  const errors = [
    failures.length && `Failed to sync ${failures.length} reports:\n${failures.join('\n')}`,
    media.failures.length && `Failed to copy ${media.failures.length} images:\n${media.failures.join('\n')}`,
  ].filter(Boolean)
  if (errors.length) throw new SyncError(errors.join('\n'))
  return synced
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITLAB_ISSUE_SYNC_TOKEN
  const mediaToken = process.env.MEDIA_TOKEN
  if (!token || !mediaToken || !process.env.GH_TOKEN) throw new Error('GITLAB_ISSUE_SYNC_TOKEN, MEDIA_TOKEN and GH_TOKEN are required')
  try {
    console.log(`Synchronized ${await sync(createClient(token, mediaToken))} GitLab reports.`)
  } catch (error) {
    // Subprocess errors can contain private response bodies; report no credentials/content.
    if (error instanceof SyncError) console.error(error.message)
    console.error('Issue synchronization failed. Check API access, rate limits, and linked issues. Completed writes will be reconciled on the next run.')
    process.exitCode = 1
  }
}
