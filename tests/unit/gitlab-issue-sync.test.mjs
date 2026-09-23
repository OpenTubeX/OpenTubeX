import assert from 'node:assert/strict'
import { test } from 'node:test'
import { content, list, sync } from '../../_scripts/gitlabIssueSync.mjs'

function fixture() {
  const state = {
    sources: [{ iid: 1, title: 'Report', description: 'Description', state: 'opened', confidential: false,
      imported: false, author: { id: 1, username: 'reporter' }, web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/issues/1' }],
    targets: [], notes: [], comments: [], writes: [],
  }
  let id = 100
  const copy = value => structuredClone(value)
  const client = Object.fromEntries(['gl', 'gh'].map(side => [side, async (path, method = 'GET', body) => {
    const route = path.split('?')[0]
    if (method !== 'GET') state.writes.push({ side, route, method, body })
    if (side === 'gl' && route === 'user') return { id: 99 }
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

test('GitLab owns title/body, both sides can change status, and GitHub owns triage', async () => {
  const { state, client } = fixture()
  await sync(client)
  Object.assign(state.targets[0], { title: 'Changed on GitHub', body: 'Marker removed', state: 'closed', labels: ['bug'], milestone: 3 })
  state.sources[0].description = 'Edited on GitLab'
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.targets[0].title, 'Report')
  assert.match(state.targets[0].body, /Edited on GitLab/)
  assert.deepEqual(state.targets[0].labels, ['bug'])
  assert.equal(state.targets[0].milestone, 3)
  assert.equal(state.sources[0].state, 'closed')
  state.targets[0].state = 'open'
  await sync(client)
  assert.equal(state.sources[0].state, 'opened')
  state.sources[0].state = 'closed'
  await sync(client)
  assert.equal(state.sources[0].state, 'closed')
  assert.equal(state.targets[0].state, 'closed')
  state.sources[0].state = 'opened'
  await sync(client)
  assert.equal(state.targets[0].state, 'open')
})

test('comment edits update their existing copies in both directions', async () => {
  const { state, client } = fixture()
  state.notes.push({ id: 10, body: 'Original', author: { id: 1, username: 'reporter' } })
  await sync(client)
  state.comments.push({ id: 20, body: 'Reply', user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  state.notes[0].body = 'Edited report comment'
  state.comments[1].body = 'Edited reply'
  await sync(client)
  assert.equal(state.comments.length, 2)
  assert.equal(state.notes.length, 3)
  assert.match(state.comments[0].body, /Edited report comment/)
  assert.match(state.notes[2].body, /Edited reply/)
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

test('preserves initial closed state and does not recreate a missing linked issue', async () => {
  const { state, client } = fixture()
  state.sources[0].state = 'closed'
  await sync(client)
  assert.equal(state.targets[0].state, 'closed')
  state.targets = []
  await assert.rejects(sync(client), /Missing linked GitHub issue/)
})

test('an older backlink closes GitHub when GitLab closes the report', async () => {
  const { state, client } = fixture()
  await sync(client)
  state.notes[0].body = state.notes[0].body.replace(/^<!-- opentubex-sync:state:opened -->\n/m, '')
  state.sources[0].state = 'closed'
  await sync(client)
  assert.equal(state.targets[0].state, 'closed')
  assert.equal(state.sources[0].state, 'closed')
  assert.match(state.notes[0].body, /opentubex-sync:state:closed/)
  state.targets[0].state = 'open'
  await sync(client)
  assert.equal(state.sources[0].state, 'opened')
})

test('a failed status update keeps the previous state marker for retry', async () => {
  const { state, client } = fixture()
  await sync(client)
  state.sources[0].state = 'closed'
  const gh = client.gh
  client.gh = async (path, method, body) => {
    if (body?.state === 'closed') throw new Error('Simulated API failure')
    return gh(path, method, body)
  }
  await assert.rejects(sync(client), /Failed to sync/)
  assert.match(state.notes[0].body, /opentubex-sync:state:opened/)
  client.gh = gh
  await sync(client)
  assert.equal(state.targets[0].state, 'closed')
  assert.match(state.notes[0].body, /opentubex-sync:state:closed/)
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

test('pagination reads beyond 100 items', async () => {
  const calls = []
  const items = await list({ gl: async path => {
    calls.push(path)
    return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]
  } }, 'gl', 'issues?state=all')
  assert.equal(items.length, 101)
  assert.equal(calls.length, 2)
  assert.match(calls[1], /&per_page=100&page=2$/)
})

test('rewrites GitLab uploads and escapes only GitHub-to-GitLab quick actions', () => {
  const body = content('![video](/uploads/hash/video.mp4)\n@person\n/close', true)
  assert.match(body, /https:\/\/gitlab.com\/-\/project\/85121418\/uploads\/hash\/video.mp4/)
  assert.ok(body.includes('@person\n/close'))
  assert.equal(content('/close\n  /label ~bug'), '&#47;close\n  &#47;label ~bug')
  assert.equal(content('```sh\n/close\n```\n/close'), '```sh\n/close\n```\n&#47;close')
  assert.equal(content('~~~~\n/close\n~~~\n/close\n~~~~'), '~~~~\n/close\n~~~\n/close\n~~~~')
})

test('mirrors uploaded images from issue 1468 in descriptions and comments and repairs existing copies', async () => {
  const { state, client } = fixture()
  const file = 'c2cc7b30727ac87589b6cf25afb79c3a/Screenshot_2026-09-20_20-35-28.png'
  const image = `![Screenshot](/uploads/${file}){width=900 height=507}`
  const expected = `![Screenshot](https://gitlab.com/-/project/85121418/uploads/${file})`
  state.sources[0].description = image
  state.notes.push({ id: 10, body: image, author: { id: 1, username: 'reporter' } })
  await sync(client)
  assert.ok(state.targets[0].body.endsWith(expected))
  assert.ok(state.comments[0].body.endsWith(expected))

  for (const item of [state.targets[0], state.comments[0]]) {
    item.body = item.body.replace(expected, image.replace('/uploads/', 'https://gitlab.com/opentubex/OpenTubeX/uploads/'))
  }
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.comments.length, 1)
  assert.ok(state.targets[0].body.endsWith(expected))
  assert.ok(state.comments[0].body.endsWith(expected))
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('converts upload links and image dimensions without changing unrelated links or attributes', () => {
  const url = 'https://gitlab.com/-/project/85121418/uploads/hash/image.png'
  for (const dimensions of ['{width=900 height=507}', '{width=100px}', '{height=50% width=75%}']) {
    assert.equal(content(`![Screenshot](/uploads/hash/image.png)${dimensions}`, true), `![Screenshot](${url})`)
    assert.equal(content(`![Screenshot](https://example.org/image.png "Title")${dimensions}`, true), '![Screenshot](https://example.org/image.png "Title")')
  }
  assert.equal(content('/uploads/hash/image.png', true), url)
  assert.equal(content('[attachment](/uploads/hash/image.png)', true), `[attachment](${url})`)
  assert.equal(content('[image]: </uploads/hash/image.png>', true), `[image]: <${url}>`)
  assert.equal(content('<img src="/uploads/hash/image.png" width="900">', true), `<img src="${url}" width="900">`)
  assert.equal(content('![image](/uploads/hash/image(1).png){width=100}', true), '![image](https://gitlab.com/-/project/85121418/uploads/hash/image(1).png)')
  const unchanged = '[link](https://example.org){width=100}\n![image](https://example.org/image.png){custom=100}\nText {width=100}\n![image](https://example.org/image.png) [link](https://example.org){width=100}'
  assert.equal(content(unchanged, true), unchanged)
  const githubImage = '![image](https://github.com/user-attachments/assets/example){width=100}'
  assert.equal(content(githubImage), githubImage)
})

test('repairs video embeds from issue 1452 in existing descriptions and comments', async () => {
  const { state, client } = fixture()
  const file = 'ad58bc7f52258220477bffdbf89decab/screen-20260919-215554-1789847747236.mp4'
  const link = `[Recording](https://gitlab.com/-/project/85121418/uploads/${file})`
  state.sources[0].description = `![Recording](/uploads/${file})`
  state.notes.push({ id: 10, body: state.sources[0].description, author: { id: 1, username: 'reporter' } })
  await sync(client)
  assert.ok(state.targets[0].body.endsWith(`\n\n${link}`))
  assert.ok(state.comments[0].body.endsWith(`\n\n${link}`))
  for (const item of [state.targets[0], state.comments[0]]) {
    item.body = item.body.replace(link, `!${link}`)
  }
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.comments.length, 1)
  assert.ok(state.targets[0].body.endsWith(`\n\n${link}`))
  assert.ok(state.comments[0].body.endsWith(`\n\n${link}`))
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('links GitLab video formats while preserving images and GitHub content', () => {
  for (const extension of ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'MP4']) {
    const url = `https://example.org/recording(1).${extension}`
    for (const target of [url, `${url}?download=1#t=2`, `<${url}>`, `${url} "Recording"`]) {
      assert.equal(content(`![Video](${target}){width=900 height=507}`, true), `[Video](${target})`)
    }
    assert.equal(content(`![](${url})`, true), `[Video](${url})`)
  }
  const unchanged = '![Screenshot](https://example.org/image.png?name=video.mp4)\n![Image](https://example.org/video.mp4.png)'
  assert.equal(content(unchanged, true), unchanged)
  const githubVideo = '![Recording](https://example.org/video.mp4)'
  assert.equal(content(githubVideo), githubVideo)
})

test('a broken link does not starve later reports', async () => {
  const { state, client } = fixture()
  await sync(client)
  state.targets = []
  state.sources.push({ ...state.sources[0], iid: 2, title: 'Later report' })
  const gl = client.gl
  client.gl = async (path, method, body) => {
    if (path.includes('/issues/2/notes')) {
      if (!method || method === 'GET') return []
      return { id: 999, ...body }
    }
    return gl(path, method, body)
  }
  await assert.rejects(sync(client))
  assert.equal(state.targets.length, 1)
  assert.equal(state.targets[0].title, 'Later report')
})

test('retries incomplete closed-report initialization without reopening GitLab', async () => {
  const { state, client } = fixture()
  state.sources[0].state = 'closed'
  const gh = client.gh
  client.gh = async (path, method, body) => {
    if (body?.state === 'closed') throw new Error('Failed closing initial copy')
    return gh(path, method, body)
  }
  await assert.rejects(sync(client))
  client.gh = gh
  await sync(client)
  assert.equal(state.targets.length, 1)
  assert.equal(state.targets[0].state, 'closed')
  assert.equal(state.sources[0].state, 'closed')
})

test('preserves URLs, email addresses, inline code and fenced reproduction commands', () => {
  const text = 'https://www.npmjs.com/package/@scope/name\nuser@example.org\n`@scope/name`\n```sh\n/usr/bin/opentubex\n```'
  assert.equal(content(text, true), text)
  assert.equal(content(text, false), text)
})

test('the privileged workflow job runs only on the canonical default branch', async () => {
  const { readFileSync } = await import('node:fs')
  const { runInNewContext } = await import('node:vm')
  const { parse } = await import('yaml')
  const workflow = parse(readFileSync(new URL('../../.github/workflows/gitlab-issue-sync.yml', import.meta.url), 'utf8'))
  const canRun = (repository, ref, eventName = 'workflow_dispatch') => runInNewContext(workflow.jobs.sync.if, {
    github: { repository, ref, event_name: eventName, event: { repository: eventName === 'schedule' ? {} : { default_branch: 'development' } } },
    format: (template, value) => template.replace('{0}', value),
  })
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/development'), true)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/feature'), false)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/tags/development'), false)
  assert.equal(canRun('other/fork', 'refs/heads/development'), false)
  assert.equal(canRun('OpenTubeX/OpenTubeX', 'refs/heads/development', 'schedule'), true)
  assert.equal(canRun('other/fork', 'refs/heads/development', 'schedule'), false)
})

test('oversized reports and notes fit GitHub limits with attribution and stable truncation notices', async () => {
  const { state, client } = fixture()
  state.sources[0].description = '😀'.repeat(40000)
  state.notes.push({ id: 10, body: 'x'.repeat(70000), author: { id: 1, username: 'reporter' } })
  await sync(client)
  for (const body of [state.targets[0].body, state.comments[0].body]) {
    assert.ok(body.length <= 65536)
    assert.match(body, /Truncated to fit GitHub/)
    assert.match(body, /https:\/\/gitlab.com\/opentubex\/OpenTubeX\/-\/issues\/1/)
    assert.match(body, /^<!-- opentubex-sync:/)
    assert.ok(!/[\uD800-\uDBFF]$/.test(body))
  }
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
  state.sources[0].description = 'Short again'
  state.notes[0].body = 'Short comment again'
  await sync(client)
  assert.doesNotMatch(state.targets[0].body, /Truncated to fit GitHub/)
  assert.doesNotMatch(state.comments[0].body, /Truncated to fit GitHub/)
})
