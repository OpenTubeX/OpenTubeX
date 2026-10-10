import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const project = 'opentubex/OpenTubeX'
// GitLab serves uploads through the stable project ID, not the repository path.
const uploadsUrl = 'https://gitlab.com/-/project/85121418/uploads/'
const repository = 'OpenTubeX/OpenTubeX'
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

// Only escape GitLab quick-action syntax outside code fences. Preserve mentions,
// URLs, email addresses and reproduction commands verbatim.
export function content(body = '', fromGitlab = false) {
  let result = (body ?? '').replace(/<!-- opentubex-sync:[\s\S]*?-->/g, '')
  if (fromGitlab) {
    result = result.replace(/(^|[(<"'\s])\/uploads\//g, `$1${uploadsUrl}`)
    // GitHub does not support GitLab's image dimension attributes.
    result = result.replace(/(!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\))\{[ \t]*(?:(?:width|height)=\d+(?:px|%)?[ \t]*)+\}/g, '$1')
    // GitLab renders video image syntax as a player; GitHub needs a normal link.
    result = result.replace(/!\[([^\]\n]*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g, (image, label, target) => {
      const path = target.match(/^<?([^>\s?#]+)/)?.[1] ?? ''
      return /\.(mp4|m4v|mov|webm|ogv)$/i.test(path) ? `[${label || 'Video'}](${target})` : image
    })
  } else {
    let fence = null
    result = result.split('\n').map(line => {
      const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (delimiter) {
        if (!fence) fence = delimiter[1]
        else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null
        return line
      }
      return fence ? line : line.replace(/^( {0,3})\/(?=[a-z_]+(?:\s|$))/, '$1&#47;')
    }).join('\n')
  }
  return result
}

function githubBody(header, body) {
  const available = 65536 - header.length - 2
  if (body.length <= available) return `${header}\n\n${body}`
  const notice = '> Truncated to fit GitHub. Read the full text at the original GitLab link above.\n\n'
  // UTF-16 length is conservative for astral characters; never split a surrogate pair.
  const excerpt = body.slice(0, available - notice.length).replace(/[\uD800-\uDBFF]$/, '')
  return `${header}\n\n${notice}${excerpt}`
}

function issueBody(issue, references) {
  const header = `${marker('issue', issue.iid)}\nReported by ${content(issue.author.username)} on [GitLab](${issue.web_url}).`
  return githubBody(header, references(content(issue.description, true), 'gitlab'))
}

function commentBody(comment, side, issue, references) {
  const gitlab = side === 'gitlab'
  const author = gitlab ? comment.author.username : comment.user.login
  const url = gitlab ? `${issue.web_url}#note_${comment.id}` : comment.html_url
  const header = `${marker(side, comment.id)}\n${content(author)} on [${gitlab ? 'GitLab' : 'GitHub'}](${url}):`
  const body = references(content(comment.body, gitlab), side)
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
  const title = value => value.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&')
  const render = (reference, side, suffix = '') => {
    const item = (side === 'gitlab' ? gitlab : github).get(reference)
    const host = side === 'gitlab' ? 'GitLab' : 'GitHub'
    const url = item?.web_url ?? item?.html_url ?? (side === 'gitlab'
      ? `https://gitlab.com/${project}/-/${reference[0] === '!' ? 'merge_requests' : 'issues'}/${reference.slice(1)}`
      : `https://github.com/${repository}/issues/${reference.slice(1)}`)
    const other = counterparts.get(url)
    const link = `[${title(item?.title ?? `${host} ${reference}`)}](${url}${suffix})`
    if (!other) return link
    const otherSide = side === 'gitlab' ? 'GitHub' : 'GitLab'
    const otherReference = side === 'gitlab' ? `#${other.number}` : gitlabReferences.get(other.web_url)
    return `${link} ([${otherSide} ${otherReference}](${other.html_url ?? other.web_url}))`
  }
  const urlReference = (url, side) => {
    const pattern = side === 'gitlab'
      ? /^https:\/\/gitlab\.com\/opentubex\/OpenTubeX\/-\/(issues|work_items|merge_requests)\/(\d+)([?#][^\s<>]*)?$/i
      : /^https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/(issues|pull)\/(\d+)([?#][^\s<>]*)?$/i
    const match = url.match(pattern)
    return match && render(`${match[1] === 'merge_requests' ? '!' : '#'}${match[2]}`, side, match[3] ?? '')
  }
  const rewrite = (body, side) => {
    let fence = null
    let htmlEnd = null
    let quoteDepth = 0
    let paragraph = false
    const listIndents = []
    const result = []
    let prose = []
    const flush = () => {
      if (!prose.length) return
      // Consume code, escapes, Markdown links, HTML, and URLs before considering
      // shorthand references, so fragments and reproduction commands stay intact.
      result.push(prose.join('\n').replace(/(`+)(?!`)[\s\S]*?\1(?!`)|\\.|<!--[^]*?(?:--!?>|$)|<(code|pre)\b[^>]*>[^]*?(?:<\/\2>|$)|!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|\[[^\]\n]*\]:[^\n]*|<[^>]*>|https?:\/\/[^\s<>]+|(?<![\w/\\&#])(?:opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX)?[#!]\d+\b/gi, token => {
        if (/^https?:/i.test(token)) {
          const url = token.replace(/[.,;:!?)\]]+$/, '')
          return (urlReference(url, side) ?? url) + token.slice(url.length)
        }
        if (/^<https?:/i.test(token)) return urlReference(token.slice(1, -1), side) ?? token
        if (token.startsWith('[')) {
          const url = token.match(/^\[[^\]]*\]\(<?(https?:\/\/[^\s)>]+)>?(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\)$/i)?.[1]
          return url ? urlReference(url, side) ?? token : token
        }
        const reference = token.match(/^(?:opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX)?([#!]\d+)$/i)?.[1]
        return reference && (side === 'gitlab' || reference[0] === '#') ? render(reference, side) : token
      }))
      prose = []
    }
    for (const line of body.split('\n')) {
      let text = line
      let depth = 0
      const container = fence ?? htmlEnd
      const quoteLimit = container?.quoteDepth ?? Infinity
      while (depth < quoteLimit && /^ {0,3}> ?/.test(text)) {
        text = text.replace(/^ {0,3}> ?/, '')
        depth++
      }
      let expanded = text.replace(/^[ \t]*/, indent => indent.replaceAll('\t', '    '))
      let indent = expanded.match(/^ */)[0].length
      if (fence && (depth < fence.quoteDepth || (text.trim() && indent < fence.listIndent))) fence = null
      if (htmlEnd && (depth < htmlEnd.quoteDepth || (text.trim() && indent < htmlEnd.listIndent))) {
        flush()
        htmlEnd = null
      }
      if (container && !fence && !htmlEnd) {
        while (/^ {0,3}> ?/.test(text)) {
          text = text.replace(/^ {0,3}> ?/, '')
          depth++
        }
        expanded = text.replace(/^[ \t]*/, indent => indent.replaceAll('\t', '    '))
        indent = expanded.match(/^ */)[0].length
      }
      if (htmlEnd) {
        prose.push(line)
        if (htmlEnd.pattern.test(line)) htmlEnd = null
        continue
      }
      if (!fence && depth !== quoteDepth) {
        listIndents.length = 0
        paragraph = false
      }
      quoteDepth = depth
      if (!fence && line.trim()) {
        while (listIndents.length && indent < listIndents.at(-1)) listIndents.pop()
      }
      const contentIndent = listIndents.at(-1) ?? 0
      let indentedCode = !paragraph && indent >= contentIndent + 4
      const thematicBreak = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(expanded.slice(contentIndent))
      const listItem = !fence && !indentedCode && !thematicBreak && expanded.match(/^ *(?:[-+*]|\d+[.)])(?:[ \t]{1,4}(?![ \t])|[ \t])/)
      const lineContent = expanded.slice(listItem ? listItem[0].length : contentIndent)
      if (listItem) {
        listIndents.push(listItem[0].length)
        if (/^ {4}/.test(lineContent)) indentedCode = true
      }
      if (!fence && !indentedCode) {
        const opening = lineContent.match(/<(code|pre)\b[^>]*>|<!--/i)
        if (opening) {
          htmlEnd = { pattern: opening[1] ? new RegExp(`</${opening[1]}>`, 'i') : /--!?>/, quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          paragraph = false
          prose.push(line)
          if (htmlEnd.pattern.test(lineContent)) htmlEnd = null
          continue
        }
      }
      let delimiter = lineContent.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (!fence && delimiter?.[1][0] === '`' && delimiter[2].includes('`')) delimiter = null
      if (delimiter || fence || indentedCode) {
        paragraph = false
        flush()
        result.push(line)
        if (delimiter) {
          if (!fence) {
            fence = { marker: delimiter[1], quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          } else if (delimiter[1][0] === fence.marker[0] && delimiter[1].length >= fence.marker.length && !delimiter[2].trim()) fence = null
        }
      } else {
        paragraph = Boolean(lineContent.trim()) && !thematicBreak && !/^ {0,3}(?:#{1,6}(?:\s|$)|\[[^\]]+\]:)/.test(lineContent)
        prose.push(line)
      }
    }
    flush()
    return result.join('\n')
  }
  return { rewrite, pair }
}

export function createClient(token) {
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
      const args = ['api', path, '--method', method]
      if (body) args.push('--input', '-')
      try {
        return JSON.parse(execFileSync('gh', args, {
          input: body ? JSON.stringify(body) : undefined,
          encoding: 'utf8',
          timeout: 30000,
          maxBuffer: 20 * 1024 * 1024,
          // Avoid emitting response bodies containing user content into Actions logs.
          stdio: ['pipe', 'pipe', 'pipe'],
        }))
      } catch (error) {
        const status = error.stderr?.toString().match(/HTTP (\d{3})/)?.[1]
        throw new SyncError(`GitHub ${method} ${path} failed${status ? `: HTTP ${status}` : ''}`)
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
  // Establish every native issue's counterpart before rendering references,
  // including references to reports created later in the same sync run.
  for (const source of sources) {
    // Only native public reports. Imported GitHub issues already have originals.
    if (source.confidential !== false || source.imported || source.imported_from === 'github') continue
    try {
      const glIssue = `${glBase}/${source.iid}`
      const notes = await list(client, 'gl', `${glIssue}/notes?sort=asc&order_by=created_at`)
      const link = notes.find(note => note.author.id === bot.id && markedId(note.body, 'link'))
      const linkedNumber = link && Number(markedId(link.body, 'link'))
      let target = linkedNumber
        ? targets.find(issue => issue.number === linkedNumber)
        : targets.find(issue => markedId(issue.body, 'issue') === String(source.iid))
      // Never silently duplicate a linked issue that was deleted or transferred.
      if (linkedNumber && !target) throw new SyncError(`Missing linked GitHub issue for GitLab #${source.iid}`)
      if (!target) {
        target = await client.gh(ghBase, 'POST', { title: source.title, body: issueBody(source, references.rewrite) })
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
      const body = issueBody(source, references.rewrite)
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
        if (note.system || note.internal || note.confidential ||
          (note.author.id === bot.id && (markedId(note.body, 'github') || markedId(note.body, 'link')))) continue
        const existing = comments.find(comment => comment.user.login === githubBot &&
          markedId(comment.body, 'gitlab') === String(note.id))
        const body = commentBody(note, 'gitlab', source, references.rewrite)
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
  if (failures.length) throw new SyncError(`Failed to sync ${failures.length} reports:\n${failures.join('\n')}`)
  return synced
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GITLAB_ISSUE_SYNC_TOKEN
  if (!token || !process.env.GH_TOKEN) throw new Error('GITLAB_ISSUE_SYNC_TOKEN and GH_TOKEN are required')
  try {
    console.log(`Synchronized ${await sync(createClient(token))} GitLab reports.`)
  } catch (error) {
    // Subprocess errors can contain private response bodies; report no credentials/content.
    if (error instanceof SyncError) console.error(error.message)
    console.error('Issue synchronization failed. Check API access, rate limits, and linked issues. Completed writes will be reconciled on the next run.')
    process.exitCode = 1
  }
}
