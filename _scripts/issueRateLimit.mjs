import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { eligibleAuthor, github } from './issueTriageCommon.mjs'

const MAX_ISSUES = 15
const WINDOW_MS = 24 * 60 * 60 * 1000
const EXEMPT_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

export function countEarlierIssues(issues, current, cutoff) {
  return issues.filter(issue =>
    !issue.pull_request &&
    issue.user?.id === current.user.id &&
    Date.parse(issue.created_at) >= cutoff &&
    (issue.created_at < current.created_at ||
      (issue.created_at === current.created_at && issue.number < current.number))
  ).length
}

export function isExempt(issue) {
  return !issue.user?.id || !eligibleAuthor(issue.user) ||
    EXEMPT_ASSOCIATIONS.has(issue.author_association)
}

function recentIssues(owner, repo, cutoff) {
  const result = []
  for (let page = 1; ; page++) {
    const issues = github(
      `repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`
    )
    result.push(...issues.filter(issue => Date.parse(issue.created_at) >= cutoff))
    if (issues.length < 100 || Date.parse(issues.at(-1).created_at) < cutoff) break
  }
  return result
}

export function isExcessIssue(issues, issue) {
  return !issue.pull_request && !isExempt(issue) &&
    countEarlierIssues(issues, issue, Date.parse(issue.created_at) - WINDOW_MS) >= MAX_ISSUES
}

function closeExcessIssue(owner, repo, number) {
  const endpoint = `repos/${owner}/${repo}/issues/${number}`
  if (github(endpoint).state !== 'open') return
  github(`${endpoint}/comments`, 'POST', {
    body: `This issue was automatically closed because this account opened more than ${MAX_ISSUES} issues in 24 hours. Please wait before opening another issue or add related details to an existing report. If this was a mistake, contact a maintainer in Discussions.`
  })
  github(endpoint, 'PATCH', { state: 'closed', state_reason: 'not_planned' })
  console.log(`Rate limited issue #${number}`)
}

function main() {
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')
  if (process.argv.includes('--sweep')) {
    const now = Date.now()
    const issues = recentIssues(owner, repo, now - 2 * WINDOW_MS)
    for (const issue of issues) {
      if (issue.state === 'open' && Date.parse(issue.created_at) >= now - WINDOW_MS &&
        isExcessIssue(issues, issue)) {
        closeExcessIssue(owner, repo, issue.number)
      }
    }
    return
  }

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const issue = event.issue
  let allowed = true
  if (event.action === 'opened' && !isExempt(issue)) {
    const cutoff = Date.parse(issue.created_at) - WINDOW_MS
    if (!Number.isFinite(cutoff)) throw new Error('Invalid issue creation time')
    const issues = recentIssues(owner, repo, cutoff)
    if (isExcessIssue(issues, issue)) {
      closeExcessIssue(owner, repo, issue.number)
      allowed = false
    }
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `allowed=${allowed}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
