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

// Only escape GitLab quick-action syntax outside code fences. Preserve mentions,
// URLs, email addresses and reproduction commands verbatim.
export function content(body = '', fromGitlab = false) {
  let result = (body ?? '').replace(/<!-- opentubex-sync:[\s\S]*?-->/g, '')
  if (fromGitlab) {
    result = result.replace(/(^|[(<"'\s])\/uploads\//g, `$1${uploadsUrl}`)
    // GitHub does not support GitLab's image dimension attributes.
    result = result.replace(/(!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\))\{[ \t]*(?:(?:width|height)=\d+(?:px|%)?[ \t]*)+\}/g, '$1')
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

function issueBody(issue) {
  const header = `${marker('issue', issue.iid)}\nReported by ${content(issue.author.username)} on [GitLab](${issue.web_url}).`
  return githubBody(header, content(issue.description, true))
}

function commentBody(comment, side, issue) {
  const gitlab = side === 'gitlab'
  const author = gitlab ? comment.author.username : comment.user.login
  const url = gitlab ? `${issue.web_url}#note_${comment.id}` : comment.html_url
  const header = `${marker(side, comment.id)}\n${content(author)} on [${gitlab ? 'GitLab' : 'GitHub'}](${url}):`
  const body = content(comment.body, gitlab)
  return gitlab ? githubBody(header, body) : `${header}\n\n${body}`
}

export function createClient(token) {
  return {
    async gl(path, method = 'GET', body) {
      const response = await fetch(`https://gitlab.com/api/v4/${path}`, {
        method,
        headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
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
  const targets = (await list(client, 'gh', `${ghBase}?state=all&sort=created&direction=asc`))
    .filter(issue => !issue.pull_request && issue.user.login === githubBot)
  let synced = 0
  const failures = []
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
      const body = issueBody(source)
      if (!target) {
        target = await client.gh(ghBase, 'POST', { title: source.title, body })
        targets.push(target)
      } else if (target.title !== source.title || target.body !== body) {
        await client.gh(`${ghBase}/${target.number}`, 'PATCH', { title: source.title, body })
      }
      if (!link) {
        // The backlink marks initialization complete. Retry the initial close
        // before creating it, even when a previous run already created the issue.
        if (source.state === 'closed' && target.state !== 'closed') {
          target = await client.gh(`${ghBase}/${target.number}`, 'PATCH', { state: 'closed' })
        }
        await client.gl(`${glIssue}/notes`, 'POST', {
          body: `${marker('link', target.number)}\nThis report is tracked on [GitHub](${target.html_url}). Comments and comment edits are mirrored both ways. Edit this GitLab report to update its GitHub title and description. Status and triage are managed on GitHub.`,
        })
      }
      // Read status again after content updates, so a concurrent triage change wins.
      const current = await client.gh(`${ghBase}/${target.number}`)
      const state = current.state === 'closed' ? 'closed' : 'opened'
      if (source.state !== state) {
        await client.gl(glIssue, 'PUT', { state_event: state === 'closed' ? 'close' : 'reopen' })
      }
      const comments = await list(client, 'gh', `${ghBase}/${target.number}/comments`)
      for (const note of notes) {
        if (note.system || note.internal || note.confidential ||
          (note.author.id === bot.id && (markedId(note.body, 'github') || markedId(note.body, 'link')))) continue
        const existing = comments.find(comment => comment.user.login === githubBot &&
          markedId(comment.body, 'gitlab') === String(note.id))
        const body = commentBody(note, 'gitlab', source)
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
        const body = commentBody(comment, 'github', source)
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
