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
  const title = value => value.replace(/\s+/g, ' ').replace(/[\\`*_[\]<>|&]/g, '\\$&')
  const render = (reference, side, suffix = '', tooltip = '') => {
    const item = (side === 'gitlab' ? gitlab : github).get(reference)
    const host = side === 'gitlab' ? 'GitLab' : 'GitHub'
    const url = item?.web_url ?? item?.html_url ?? (side === 'gitlab'
      ? `https://gitlab.com/${project}/-/${reference[0] === '!' ? 'merge_requests' : 'issues'}/${reference.slice(1)}`
      : `https://github.com/${repository}/issues/${reference.slice(1)}`)
    const other = counterparts.get(url)
    const link = `[${title(item?.title ?? `${host} ${reference}`)}](${url}${suffix}${tooltip})`
    if (!other) return link
    const otherSide = side === 'gitlab' ? 'GitHub' : 'GitLab'
    const otherReference = side === 'gitlab' ? `#${other.number}` : gitlabReferences.get(other.web_url)
    return `${link} ([${otherSide} ${otherReference}](${other.html_url ?? other.web_url}))`
  }
  const urlReference = (url, side, tooltip = '') => {
    const pattern = side === 'gitlab'
      ? /^https:\/\/gitlab\.com\/opentubex\/OpenTubeX\/-\/(issues|work_items|merge_requests)\/(\d+)([?#][^\s<>]*)?$/i
      : /^https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/(issues|pull)\/(\d+)([?#][^\s<>]*)?$/i
    const match = url.match(pattern)
    return match && render(`${match[1] === 'merge_requests' ? '!' : '#'}${match[2]}`, side, match[3] ?? '', tooltip)
  }
  const rewrite = (body, side) => {
    const labelKey = label => label.trim().replace(/\s+/g, ' ').toLowerCase()
    const referenceLabels = new Set()
    const htmlTag = /<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?:\s+[a-z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/i
    let fence = null
    let htmlEnd = null
    let quoteDepth = 0
    let paragraph = false
    const listIndents = []
    const result = []
    let prose = []
    let definitionTitleEnd = -1
    // Consume code, escapes, Markdown links, HTML, and URLs before considering
    // shorthand references, so fragments and reproduction commands stay intact.
    const balancedEnd = (text, start, open, close) => {
      let depth = 0
      let quote = null
      for (let index = start; index < text.length; index++) {
        const char = text[index]
        if (char === '\\') { index++; continue }
        if (quote) { if (char === quote) quote = null; continue }
        if (open === '(' && /[\s]/.test(text[index - 1]) && /["']/.test(char)) { quote = char; continue }
        if (char === open) depth++
        else if (char === close && --depth === 0) return index + 1
      }
      return -1
    }
    const rewriteProse = text => {
      const tokens = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)|\\.|<!--[^]*?(?:--!?>|$)|<(code|pre|script|style|textarea)\b[^>]*>[^]*?(?:<\/\2>|$)|!?\[|<|https?:\/\/[^\s<>]+|(?<![\w/\\&#])(?:opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX)?[#!]\d+\b/gi
      let output = ''
      let position = 0
      let match
      while ((match = tokens.exec(text))) {
        output += text.slice(position, match.index)
        let token = match[0]
        if (token === '[' || token === '![') {
          const image = token === '!['
          const start = match.index + (image ? 1 : 0)
          const labelEnd = balancedEnd(text, start, '[', ']')
          if (labelEnd !== -1) {
            let end = labelEnd
            if (text[end] === '(') end = balancedEnd(text, end, '(', ')')
            else if (text[end] === '[') {
              const referenceEnd = balancedEnd(text, end, '[', ']')
              const referenceLabel = referenceEnd === -1 ? null : text.slice(end + 1, referenceEnd - 1) || text.slice(start + 1, labelEnd - 1)
              if (referenceLabel !== null && referenceLabels.has(labelKey(referenceLabel))) end = referenceEnd
            } else if (text[end] === ':') end = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end)
            if (end === -1) end = labelEnd
            tokens.lastIndex = end
            token = text.slice(match.index, end)
            const label = text.slice(start + 1, labelEnd - 1)
            const suffix = text.slice(labelEnd, end)
            const link = suffix.match(/^\(<?(https?:\/\/[^\s)>]+)>?([ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\)$/i)
            if (link && !image) token = urlReference(link[1], side, link[2] ?? '') ?? token
            else if (!suffix && !referenceLabels.has(labelKey(label))) token = `${image ? '!' : ''}[${rewriteProse(label)}]`
          }
        } else if (token === '<') {
          const remaining = text.slice(match.index)
          const raw = remaining.match(/^(?:<\?[\s\S]*?\?>|<![A-Z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)/)
          const tag = remaining.match(htmlTag)
          const autolink = remaining.match(/^<(?:[a-z][a-z\d+.-]{1,31}:[^\s<>]*|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*)>/i)
          const end = raw?.[0] ?? autolink?.[0] ?? (tag?.index === 0 ? tag[0] : null)
          if (end) {
            tokens.lastIndex = match.index + end.length
            token = urlReference(end.slice(1, -1), side) ?? end
          }
        } else if (/^https?:/i.test(token)) {
          const excess = {
            ')': (token.match(/\)/g) ?? []).length - (token.match(/\(/g) ?? []).length,
            ']': (token.match(/\]/g) ?? []).length - (token.match(/\[/g) ?? []).length,
          }
          let url = token
          while (/[.,;:!?)\]]$/.test(url)) {
            const last = url.at(-1)
            if (last in excess) {
              if (excess[last] <= 0) break
              excess[last]--
            }
            url = url.slice(0, -1)
          }
          token = (urlReference(url, side) ?? url) + token.slice(url.length)
        } else {
          const reference = token.match(/^(?:opentubex\/OpenTubeX|OpenTubeX\/OpenTubeX)?([#!]\d+)$/i)?.[1]
          if (reference && (side === 'gitlab' || reference[0] === '#')) token = render(reference, side)
        }
        output += token
        position = tokens.lastIndex
      }
      return output + text.slice(position)
    }
    const expandIndent = text => text.replace(/^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?/, prefix => {
      let column = 0
      let expanded = ''
      for (const char of prefix) {
        const width = char === '\t' ? 4 - column % 4 : 1
        column += width
        expanded += char === '\t' ? ' '.repeat(width) : char
      }
      return expanded
    })
    const flush = () => {
      if (!prose.length) return
      result.push({ prose: prose.join('\n') })
      prose = []
    }
    const lines = body.split('\n')
    const continuationTitleEnd = (start, depth, listIndent) => {
      let candidate = ''
      for (let index = start; index < lines.length; index++) {
        let text = lines[index]
        for (let quote = 0; quote < depth; quote++) {
          if (!/^ {0,3}> ?/.test(text)) return -1
          text = text.replace(/^ {0,3}> ?/, '')
        }
        const expanded = expandIndent(text)
        if (!expanded.trim() || expanded.match(/^ */)[0].length < listIndent) return -1
        const titleLine = expanded.slice(listIndent)
        if (!candidate && !/^[ \t]*["'(]/.test(titleLine)) return -1
        candidate += `${candidate ? '\n' : ''}${titleLine}`
        if (/^[ \t]*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\))[ \t]*$/.test(candidate)) return index
      }
      return -1
    }
    for (const [index, line] of lines.entries()) {
      if (index <= definitionTitleEnd) {
        flush()
        result.push({ literal: line })
        continue
      }
      let text = line
      let depth = 0
      const container = fence ?? htmlEnd
      const quoteLimit = container?.quoteDepth ?? Infinity
      while (depth < quoteLimit && /^ {0,3}> ?/.test(text)) {
        text = text.replace(/^ {0,3}> ?/, '')
        depth++
      }
      let expanded = expandIndent(text)
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
        expanded = expandIndent(text)
        indent = expanded.match(/^ */)[0].length
      }
      if (htmlEnd) {
        result.push({ literal: line })
        if (htmlEnd.pattern.test(text)) htmlEnd = null
        continue
      }
      const lazyQuote = paragraph && depth < quoteDepth && Boolean(text.trim())
      if (!fence && depth !== quoteDepth && !lazyQuote) {
        listIndents.length = 0
        paragraph = false
      }
      if (!lazyQuote) quoteDepth = depth
      if (!fence && line.trim()) {
        while (listIndents.length && indent < listIndents.at(-1)) {
          listIndents.pop()
          paragraph = false
        }
      }
      const contentIndent = listIndents.at(-1) ?? 0
      let indentedCode = !paragraph && indent >= contentIndent + 4
      const thematicBreak = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(expanded.slice(contentIndent))
      let listItem = !fence && !indentedCode && !thematicBreak && expanded.match(/^ *(?:[-+*]|(\d{1,9})[.)])(?:[ \t]{1,4}(?![ \t])|[ \t])/)
      if (paragraph && listItem?.[1] && Number(listItem[1]) !== 1) listItem = null
      const lineContent = expanded.slice(listItem ? listItem[0].length : contentIndent)
      const setextHeading = paragraph && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lineContent)
      if (listItem) {
        listIndents.push(listItem[0].length)
        if (/^ {4}/.test(lineContent)) indentedCode = true
      }
      let definition = null
      if (!fence && !indentedCode) {
        definition = lineContent.match(/^ {0,3}\[((?:\\.|[^\]\\])+)\]:/)
        if (definition) {
          referenceLabels.add(labelKey(definition[1]))
          if ((!paragraph || listItem) && /^[ \t]*(?:<[^<>\n]*>|(?:\\.|[^\s\\])+)[ \t]*$/.test(lineContent.slice(definition[0].length))) {
            definitionTitleEnd = continuationTitleEnd(index + 1, depth, listItem ? listItem[0].length : contentIndent)
          }
        }
        const rawEnd = /^ {0,3}<\?/.test(lineContent)
          ? /\?>/
          : /^ {0,3}<!\[CDATA\[/.test(lineContent)
            ? /\]\]>/
            : /^ {0,3}<![A-Z]/.test(lineContent) ? />/ : null
        if (rawEnd) {
          flush()
          htmlEnd = { pattern: rawEnd, quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          paragraph = false
          result.push({ literal: line })
          if (rawEnd.test(lineContent)) htmlEnd = null
          continue
        }
        const opening = lineContent.match(/^ {0,3}(?:<(pre|script|style|textarea)(?=[ \t>]|$)|<!--)/i)
        if (opening) {
          flush()
          htmlEnd = { pattern: opening[1] ? new RegExp(`</${opening[1]}>`, 'i') : /--!?>/, quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          paragraph = false
          result.push({ literal: line })
          if (htmlEnd.pattern.test(lineContent)) htmlEnd = null
          continue
        }
        const blockTag = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[ \t>]|\/>|$)/i.test(lineContent)
        const completeTag = (!paragraph || listItem) && /^ {0,3}</.test(lineContent) && lineContent.trim().match(htmlTag)?.[0] === lineContent.trim()
        if (blockTag || completeTag) {
          flush()
          htmlEnd = { pattern: /^[ \t]*$/, quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          paragraph = false
          result.push({ literal: line })
          continue
        }
      }
      let delimiter = lineContent.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (!fence && delimiter?.[1][0] === '`' && delimiter[2].includes('`')) delimiter = null
      if (delimiter || fence || indentedCode) {
        paragraph = false
        flush()
        result.push({ literal: line })
        if (delimiter) {
          if (!fence) {
            fence = { marker: delimiter[1], quoteDepth: depth, listIndent: listItem ? listItem[0].length : contentIndent }
          } else if (delimiter[1][0] === fence.marker[0] && delimiter[1].length >= fence.marker.length && !delimiter[2].trim()) fence = null
        }
      } else {
        paragraph = Boolean(lineContent.trim()) && !thematicBreak && !setextHeading && !definition && !/^ {0,3}#{1,6}(?:\s|$)/.test(lineContent)
        prose.push(line)
      }
    }
    flush()
    return result.map(part => part.literal ?? rewriteProse(part.prose)).join('\n')
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
