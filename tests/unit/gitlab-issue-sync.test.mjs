import assert from 'node:assert/strict'
import { test } from 'node:test'
import { content, createClient, sync } from '../../_scripts/gitlabIssueSync.mjs'

function fixture() {
  const state = {
    sources: [{ iid: 1, title: 'Report', description: 'Description', state: 'opened', confidential: false,
      imported: false, author: { id: 1, username: 'reporter' }, web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/issues/1' }],
    targets: [], notes: [], comments: [], writes: [], releases: [], downloads: {},
  }
  let id = 100
  const copy = value => structuredClone(value)
  const client = Object.fromEntries(['gl', 'gh'].map(side => [side, async (path, method = 'GET', body) => {
    const route = path.split('?')[0]
    if (method !== 'GET') state.writes.push({ side, route, method, body })
    if (side === 'gl' && route === 'user') return { id: 99 }
    assert.ok(!route.includes('/merge_requests'), 'Issue sync must not query GitLab merge requests')
    const commentRoute = side === 'gl' ? route.includes('/notes') : route.includes('/comments')
    const items = commentRoute ? (side === 'gl' ? state.notes : state.comments) : (side === 'gl' ? state.sources : state.targets)
    const match = route.match(/\/(?:issues|notes|comments)\/(\d+)$/)
    const item = match && items.find(item => (side === 'gl' && !commentRoute ? item.iid : commentRoute ? item.id : item.number) === Number(match[1]))
    if (method === 'GET') return copy(match ? item : items)
    if (method === 'POST') {
      const created = { id: ++id, number: id, ...body, state: 'open',
        html_url: `https://github.com/OpenTubeX/OpenTubeX/issues/${id}`,
        user: { login: 'github-actions[bot]' }, author: { id: 99, username: 'sync-bot' } }
      items.push(created)
      return copy(created)
    }
    assert.ok(item, `Missing item for ${side} ${method} ${route}`)
    Object.assign(item, body)
    if (body.state_event) item.state = body.state_event === 'close' ? 'closed' : 'opened'
    return copy(item)
  }]))
  client.media = async (path, method = 'GET', body, type) => {
    const route = path.split('?')[0]
    if (method !== 'GET') state.writes.push({ side: 'media', route, method, body, type })
    if (route === 'repos/OpenTubeX/media/releases') {
      if (method === 'GET') return state.releases.map(({ assets, ...release }) => copy(release))
      const release = { id: ++id, tag_name: body.tag_name, assets: [] }
      state.releases.push(release)
      return { id: release.id, tag_name: release.tag_name }
    }
    const releaseId = Number(route.match(/releases\/(\d+)\/assets$/)[1])
    const release = state.releases.find(release => release.id === releaseId)
    if (method === 'GET') {
      const page = Number(new URL(path, 'https://api.github.com/').searchParams.get('page'))
      return copy(release.assets.slice((page - 1) * 100, page * 100))
    }
    const name = new URL(path).searchParams.get('name')
    const asset = { name, state: 'uploaded', browser_download_url: `https://github.com/OpenTubeX/media/releases/download/${release.tag_name}/${name}` }
    release.assets.push(asset)
    return copy(asset)
  }
  client.download = async path => {
    state.writes.push({ side: 'download', route: path })
    return state.downloads[path] ?? { status: 200, type: 'image/png', bytes: Buffer.from('image') }
  }
  return { state, client }
}

test('creates a linked issue, mirrors comments both ways and makes repeat runs a no-op', async () => {
  const { state, client } = fixture()
  state.notes.push({ id: 10, body: 'GitLab comment', author: { id: 1, username: 'reporter' } })
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.comments.length, 1)
  assert.match(state.comments[0].body, /GitLab comment/)
  state.comments.push({ id: 20, body: 'GitHub response', user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.equal(state.notes.length, 3)
  assert.match(state.notes[2].body, /GitHub response/)
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('skips imported and confidential issues and internal/system notes', async () => {
  const { state, client } = fixture()
  state.sources.push({ ...state.sources[0], iid: 2, imported: true }, { ...state.sources[0], iid: 3, confidential: true })
  for (const flag of ['system', 'internal', 'confidential']) {
    state.notes.push({ id: state.notes.length + 1, body: 'Private', [flag]: true, author: { id: 1 } })
  }
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.comments.length, 0)
})

test('recovers from failure after issue creation before backlink creation', async () => {
  const { state, client } = fixture()
  const gl = client.gl
  client.gl = async (path, method, body) => {
    if (method === 'POST') throw new Error('Simulated API failure')
    return gl(path, method, body)
  }
  await assert.rejects(sync(client), /Failed to sync/)
  client.gl = gl
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.notes.length, 1)
})

test('user-supplied sync markers cannot suppress comments or forge a backlink', async () => {
  const { state, client } = fixture()
  state.notes.push({ id: 10, body: '<!-- opentubex-sync:link:999 -->\nHello', author: { id: 1, username: 'reporter' } })
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.comments.length, 1)
  assert.doesNotMatch(state.comments[0].body, /link:999/)
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('omits missing, confidential, and ambiguous counterparts without leaking private titles', async () => {
  const { state, client } = fixture()
  state.sources.push({ ...state.sources[0], iid: 2, title: 'Duplicate', imported: true, imported_from: 'github', web_url: 'https://gitlab.com/issue/2' },
    { ...state.sources[0], iid: 3, title: 'Secret', confidential: true })
  state.targets.push(...[500, 501].map(number => ({ number, title: 'Duplicate', user: { login: 'reporter' }, html_url: `https://github.com/issue/${number}` })))
  state.sources[0].description = 'See #2 #3 #999'
  await sync(client)
  assert.ok(state.targets[2].body.endsWith('See [Duplicate](https://gitlab.com/issue/2) [GitLab #3](https://gitlab.com/opentubex/OpenTubeX/-/issues/3) [GitLab #999](https://gitlab.com/opentubex/OpenTubeX/-/issues/999)'))
  assert.doesNotMatch(state.targets[2].body, /Secret|GitHub #50/)
})

test('GitLab requests retry transient failures except for note creation', async t => {
  const requests = []
  const failures = [new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }), { ok: false, status: 502 }]
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options.method)
    const failure = failures.shift()
    if (failure instanceof Error) throw failure
    return failure ?? { ok: true, json: async () => [] }
  })
  const client = createClient('test-token', 'media-token', 1)
  assert.deepEqual(await client.gl('user'), [])
  assert.deepEqual(requests, ['GET', 'GET', 'GET'])
  failures.push({ ok: false, status: 404 })
  await assert.rejects(client.gl('user'), { message: 'GitLab GET user: HTTP 404' })
  failures.push(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  requests.length = 0
  await assert.rejects(client.gl('notes', 'POST', { body: 'Reply' }), { message: 'GitLab POST notes: TimeoutError' })
  assert.deepEqual(requests, ['POST'])
  failures.push(...Array(3).fill({ ok: false, status: 503 }))
  await assert.rejects(client.gl('user'), { message: 'GitLab GET user: HTTP 503' })
})

test('rewrites GitLab uploads and escapes only GitHub-to-GitLab quick actions', () => {
  const body = content('![video](/uploads/hash/video.mp4)\n@person\n/close', true)
  assert.match(body, /https:\/\/gitlab.com\/-\/project\/85121418\/uploads\/hash\/video.mp4/)
  assert.ok(body.includes('@person\n/close'))
  assert.equal(content('/close\n  /label ~bug'), '&#47;close\n  &#47;label ~bug')
  // GitLab matches command names case-insensitively, with Unicode case folding, after deleting \r.
  assert.equal(content('/Close\r\n/REOPEN now\r/cloſe\n/assign_reviewer2'), '&#47;Close\r\n&#47;REOPEN now\r&#47;cloſe\n&#47;assign_reviewer2')
  assert.equal(content('```sh\n/close\n```\n/close'), '```sh\n/close\n```\n&#47;close')
  assert.equal(content('~~~~\n/close\n~~~\n/close\n~~~~'), '~~~~\n/close\n~~~\n/close\n~~~~')
})

test('the privileged workflow job runs only on the canonical default branch', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const { parse } = await import('yaml')
  const workflow = parse(readFileSync(new URL('../../.github/workflows/gitlab-issue-sync.yml', import.meta.url), 'utf8'))
  const canRun = (repository, ref, eventName = 'workflow_dispatch', issue = {}, actor = 'maintainer') => runInNewContext(workflow.jobs.sync.if, {
    github: { repository, ref, actor, event_name: eventName, event: { repository: eventName === 'schedule' ? {} : { default_branch: 'development' }, issue } },
    format: (template, value) => template.replace('{0}', value),
    startsWith: (value, prefix) => value?.startsWith(prefix) ?? false,
  })
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/development'), true)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/feature'), false)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/tags/development'), false)
  assert.equal(canRun('other/fork', 'refs/heads/development'), false)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/development', 'schedule'), true)
  assert.equal(canRun('other/fork', 'refs/heads/development', 'schedule'), false)
  const linkedIssue = { user: { login: 'github-actions[bot]' }, body: '<!-- opentubex-sync:issue:1 -->\n\nReport' }
  for (const eventName of ['issues', 'issue_comment']) {
    const run = (issue, actor) => canRun('OpenTubeX/OpenTubeX', 'refs/heads/development', eventName, issue, actor)
    assert.equal(run(linkedIssue), true)
    assert.equal(run({ ...linkedIssue, pull_request: {} }), false)
    assert.equal(run({ ...linkedIssue, user: { login: 'reporter' } }), false)
    assert.equal(run({ ...linkedIssue, body: 'Unlinked issue' }), false)
    assert.equal(run({ ...linkedIssue, body: null }), false)
    assert.equal(run(linkedIssue, 'github-actions[bot]'), false)
    assert.equal(canRun('other/fork', 'refs/heads/development', eventName, linkedIssue), false)
    assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/feature', eventName, linkedIssue), false)
  }
  assert.deepEqual(workflow.on.issues.types, ['closed', 'reopened'])
  assert.deepEqual(workflow.on.issue_comment.types, ['created', 'edited'])
  assert.deepEqual(workflow.on.schedule, [{ cron: '7 * * * *' }])
  assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'))
  assert.equal(workflow.concurrency.group, 'gitlab-issue-sync')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
})
