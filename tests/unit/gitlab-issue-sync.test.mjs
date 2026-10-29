import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { content, createClient, list, sync } from '../../_scripts/gitlabIssueSync.mjs'

function fixture() {
  const state = {
    sources: [{ iid: 1, title: 'Report', description: 'Description', state: 'opened', confidential: false,
      imported: false, author: { id: 1, username: 'reporter' }, web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/issues/1' }],
    targets: [], mergeRequests: [], notes: [], comments: [], writes: [], releases: [], downloads: {},
  }
  let id = 100
  const copy = value => structuredClone(value)
  const client = Object.fromEntries(['gl', 'gh'].map(side => [side, async (path, method = 'GET', body) => {
    const route = path.split('?')[0]
    if (method !== 'GET') state.writes.push({ side, route, method, body })
    if (side === 'gl' && route === 'user') return { id: 99 }
    if (side === 'gl' && route.endsWith('/merge_requests')) return copy(state.mergeRequests)
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

test('mirrors issue 1993 references with GitLab titles and the actual GitHub numbers', async () => {
  const { state, client } = fixture()
  state.sources[0].iid = 538
  state.sources[0].title = 'Smart pull for "View All" playlists'
  state.sources[0].web_url = 'https://gitlab.com/opentubex/OpenTubeX/-/work_items/538'
  await sync(client)
  const target = state.targets[0]
  state.sources[0].description = '* [ ] #538\n* [ ] https://gitlab.com/opentubex/OpenTubeX/-/work_items/538\n\n`open\n\nOutside #538`\n\n<a href="https://example.org">#538</a> Outside #538'
  state.notes.push({ id: 10, body: 'See <span>#538</span> and <strong>#538</strong>', author: { id: 1, username: 'reporter' } })
  await sync(client)
  const reference = `[Smart pull for "View All" playlists](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(`* [ ] ${reference}\n* [ ] ${reference}\n\n` + '`open\n\nOutside ' + reference + '`\n\n<a href="https://example.org">#538</a> Outside ' + reference))
  assert.ok(state.comments[0].body.endsWith(`See <span>${reference}</span> and <strong>${reference}</strong>`))
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('GitHub references mirrored back to GitLab keep their actual issue and PR URLs', async () => {
  const { state, client } = fixture()
  await sync(client)
  const target = state.targets[0]
  state.targets.push({ number: 538, title: 'Unrelated pull request', body: '', state: 'open',
    pull_request: {}, user: { login: 'maintainer' }, html_url: 'https://github.com/OpenTubeX/OpenTubeX/pull/538' })
  state.comments.push({ id: 20, body: `See <span>#${target.number}</span> and <strong>#538</strong>`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith(
    `See <span>[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))</span> and <strong>[Unrelated pull request](https://github.com/OpenTubeX/OpenTubeX/pull/538)</strong>`))
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('matches imported issues and merge requests by unique titles, never by equal numbers', async () => {
  const { state, client } = fixture()
  state.sources.push({ ...state.sources[0], iid: 538, title: 'Imported issue', imported: true, imported_from: 'github',
    web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/work_items/538' })
  state.mergeRequests.push({ iid: 12, title: 'Imported PR', imported_from: 'github',
    web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/merge_requests/12' })
  state.targets.push(
    { number: 900, title: 'Imported issue', user: { login: 'reporter' }, html_url: 'https://github.com/OpenTubeX/OpenTubeX/issues/900' },
    { number: 538, title: 'Imported PR', pull_request: {}, user: { login: 'maintainer' }, html_url: 'https://github.com/OpenTubeX/OpenTubeX/pull/538' })
  state.sources[0].description = 'See #538 and !12'
  await sync(client)
  const target = state.targets.find(item => item.user.login === 'github-actions[bot]')
  assert.ok(target.body.endsWith('See [Imported issue](https://gitlab.com/opentubex/OpenTubeX/-/work_items/538) ([GitHub #900](https://github.com/OpenTubeX/OpenTubeX/issues/900)) and [Imported PR](https://gitlab.com/opentubex/OpenTubeX/-/merge_requests/12) ([GitHub #538](https://github.com/OpenTubeX/OpenTubeX/pull/538))'))
  state.comments.push({ id: 20, body: 'See #900 and #538', user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith('See [Imported issue](https://github.com/OpenTubeX/OpenTubeX/issues/900) ([GitLab #538](https://gitlab.com/opentubex/OpenTubeX/-/work_items/538)) and [Imported PR](https://github.com/OpenTubeX/OpenTubeX/pull/538) ([GitLab !12](https://gitlab.com/opentubex/OpenTubeX/-/merge_requests/12))'))
})

test('GitLab project-only references resolve locally without reinterpreting GitHub or foreign prose', async () => {
  const { state, client } = fixture()
  const request = { iid: 12, title: 'Imported PR', imported_from: 'github', web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/merge_requests/12' }
  const pull = { number: 900, title: request.title, pull_request: {}, user: { login: 'maintainer' }, html_url: 'https://github.com/OpenTubeX/OpenTubeX/pull/900' }
  state.mergeRequests.push(request)
  state.targets.push(pull)
  const preserved = ['`OpenTubeX#1 OpenTubeX!12`', 'other/OpenTubeX#1 other/OpenTubeX!12', 'otherproject#1 NotOpenTubeX#1',
    'https://example.org/OpenTubeX#1', '[OpenTubeX#1](https://example.org)'].join('\n\n')
  const gitlabBody = `See OpenTubeX#1 and OpenTubeX!12.\n\n${preserved}`
  state.sources[0].description = gitlabBody
  state.notes.push({ id: 10, body: gitlabBody, author: { id: 1, username: 'reporter' } })
  await sync(client)
  const target = state.targets.find(item => item.user.login === 'github-actions[bot]')
  const expected = `See [Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url})) and [Imported PR](${request.web_url}) ([GitHub #900](${pull.html_url})).\n\n${preserved}`
  assert.ok(target.body.endsWith(expected))
  assert.ok(state.comments[0].body.endsWith(expected))
  const githubOnly = 'OpenTubeX#1 OpenTubeX!12'
  state.comments.push({ id: 20, body: `See #${target.number} and #900.\n\n${githubOnly}\n\n${preserved}`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[2].body.endsWith(`See [Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url})) and [Imported PR](${pull.html_url}) ([GitLab !12](${request.web_url})).\n\n${githubOnly}\n\n${preserved}`))
})

test('GitHub GH-number references map issues and PRs while GitLab and literal text stay intact', async () => {
  const { state, client } = fixture()
  const request = { iid: 12, title: 'Imported PR', imported_from: 'github', web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/merge_requests/12' }
  const pull = { number: 900, title: request.title, pull_request: {}, user: { login: 'maintainer' }, html_url: 'https://github.com/OpenTubeX/OpenTubeX/pull/900' }
  state.mergeRequests.push(request)
  state.targets.push(pull)
  const preserved = ['`GH-101 GH-900`', '```\nGH-101\n```', '\\GH-101', 'https://example.org/GH-101', '/search?q=GH-101', '[GH-101](https://example.org)', 'XGH-101 GH-101suffix OTHER-GH-101 GH-101@example.org'].join('\n\n')
  const gitlabBody = `See GH-101 and GH-900.\n\n${preserved}`
  state.sources[0].description = gitlabBody
  state.notes.push({ id: 10, body: gitlabBody, author: { id: 1, username: 'reporter' } })
  await sync(client)
  const target = state.targets.find(item => item.user.login === 'github-actions[bot]')
  assert.ok(target.body.endsWith(gitlabBody))
  assert.ok(state.comments[0].body.endsWith(gitlabBody))
  state.comments.push({ id: 20, body: `See GH-${target.number} and GH-900.\n\n${preserved}`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[2].body.endsWith(`See [Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url})) and [Imported PR](${pull.html_url}) ([GitLab !12](${request.web_url})).\n\n${preserved}`))
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

test('resolves forward references on the first run and repairs copies using trusted backlinks', async () => {
  const { state, client } = fixture()
  state.sources[0].description = 'See #2'
  state.sources.push({ ...state.sources[0], iid: 2, title: 'Later report', description: 'See #1', web_url: 'https://gitlab.com/issue/2' })
  const gl = client.gl
  const laterNotes = []
  client.gl = async (path, method, body) => {
    if (path.includes('/issues/2/notes')) {
      if (!method || method === 'GET') return structuredClone(laterNotes)
      const note = { id: 999, author: { id: 99 }, ...body }
      laterNotes.push(note)
      return note
    }
    return gl(path, method, body)
  }
  await sync(client)
  assert.ok(state.targets[0].body.includes(`[GitHub #${state.targets[1].number}](${state.targets[1].html_url})`))
  assert.ok(state.targets[1].body.includes(`[GitHub #${state.targets[0].number}](${state.targets[0].html_url})`))
  state.targets[1].body = 'Removed sync marker'
  await sync(client)
  assert.equal(state.targets.length, 2)
  state.writes = []
  await sync(client)
  assert.deepEqual(state.writes, [])
})

test('reference conversion preserves code, escapes, foreign references, and unrelated Markdown', async () => {
  const { state, client } = fixture()
  const preserved = [
    '`#1` and ``code ` #1``',
    '`multiline\n#1\ncode`',
    '```sh\n#1\n````',
    '> ~~~~\n> #1\n> ~~~~',
    '    #1', '\t#1', '\\#1', 'owner/project#1',
    'https://example.org/#1', '[#1](https://example.org/#1)', '![#1](https://example.org/#1)',
    '[old <span title="]"> #1](https://example.org)',
    '[ref]: /url\n  "tooltip #1"\n\n[ref]',
    '/search?issue=#1', 'mailto:reporter@example.test?subject=#1', 'urn:example:report#note=#1',
    '[ref]: https://example.org/#1',
    'Text <code title=">">#1</code>', '*<code>#1</code>*', '~~<code>**#1**</code>~~', '*<code>*#1*</code>*', 'Text <a href="https://example.org">#1</a>', '<span data-ref="#1">', '<!-- example\n#1\n-->', '<code>#1</code>', '<pre>\n#1\n</pre>',
    '<pre>\n    #1\n#1\n</pre>', '<pre>\n```\n#1\n```\n#1\n</pre>', '&#123;', '#123abc',
  ].join('\n\n')
  state.sources[0].description = preserved
  await sync(client)
  assert.equal(state.targets[0].body.split('\n\n').slice(1).join('\n\n'), preserved)
  state.comments.push({ id: 20, body: preserved, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith(preserved))
})

test('explicit local links retain comment fragments and escape title Markdown', async () => {
  const { state, client } = fixture()
  state.sources[0].title = 'A [title] *with* ~~removed~~ _format_ <tag> `code` \\ path'
  state.sources[0].description = '[old title](https://gitlab.com/opentubex/OpenTubeX/-/issues/1#note_10)\n<https://gitlab.com/opentubex/OpenTubeX/-/work_items/1/>\n(opentubex/OpenTubeX#1).\n\n[old][report]\n\n[report]: https://gitlab.com/opentubex/OpenTubeX/-/issues/1 "Tooltip"'
  await sync(client)
  const body = state.targets[0].body
  const links = fromMarkdown(body.slice(body.indexOf('\n\n') + 2)).children.flatMap(node => node.children ?? []).filter(node => node.type === 'link' && node.url.startsWith(state.sources[0].web_url))
  for (const link of links) assert.deepEqual(link.children.map(({ type, value }) => ({ type, value })), [{ type: 'text', value: state.sources[0].title }])
  assert.ok(body.includes(`${state.sources[0].web_url}#note_10)`))
  assert.equal((body.match(/GitHub #/g) ?? []).length, 4)
  assert.equal(links.length, 4)
  state.comments.push({ id: 20, body: `[old][report]\n\n[report]: ${state.targets[0].html_url}/`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.includes(`([GitLab #1](${state.sources[0].web_url}))`))
})

test('public merge-request lookups do not require additional sync token permissions', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options })
    return { ok: true, json: async () => [] }
  })
  const client = createClient('test-token')
  await client.gl('projects/opentubex%2FOpenTubeX/merge_requests?scope=all&state=all')
  await client.gl('projects/opentubex%2FOpenTubeX/issues?scope=all&state=all')
  await client.gl('user')
  assert.equal(requests[0].options.headers['PRIVATE-TOKEN'], undefined)
  assert.equal(requests[1].options.headers['PRIVATE-TOKEN'], 'test-token')
  assert.equal(requests[2].options.headers['PRIVATE-TOKEN'], 'test-token')
})

test('generated title links display named and numeric entity syntax literally', async () => {
  const { state, client } = fixture()
  state.sources[0].title = 'Show &copy; &#91; &#x5b; &amp; literally'
  state.sources[0].description = `#1\n\n[report](${state.sources[0].web_url} "Show \\&copy; \\&#91; \\&#x5b; \\&amp; literally")`
  await sync(client)
  const target = state.targets[0]
  const check = body => {
    const links = fromMarkdown(body).children.flatMap(node => node.children ?? []).filter(node => node.type === 'link')
    assert.ok(links.some(node => node.children.length === 1 && node.children[0].value === state.sources[0].title))
    assert.ok(links.some(node => node.title === state.sources[0].title))
  }
  check(target.body)
  state.comments.push({ id: 20, body: `#${target.number}\n\n[report](${target.html_url} "Show \\&copy; \\&#91; \\&#x5b; \\&amp; literally")`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  check(state.notes[1].body)
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

test('copies uploaded images from issues 1468 and 2491 to the media repository once and repairs existing copies', async () => {
  const { state, client } = fixture()
  const file = 'c2cc7b30727ac87589b6cf25afb79c3a/Screenshot_2026-09-20_20-35-28.png'
  const image = `![Screenshot](/uploads/${file}){width="900" height="507"}`
  const expected = '![Screenshot](https://github.com/OpenTubeX/media/releases/download/gitlab-uploads/c2cc7b30727ac87589b6cf25afb79c3a-Screenshot_2026-09-20_20-35-28.png)'
  state.sources[0].description = image
  state.notes.push({ id: 10, body: image, author: { id: 1, username: 'reporter' } })
  await sync(client)
  assert.ok(state.targets[0].body.endsWith(expected))
  assert.ok(state.comments[0].body.endsWith(expected))
  assert.equal(state.writes.filter(write => write.side === 'download').length, 1)
  const upload = state.writes.find(write => write.side === 'media' && write.method === 'POST' && write.type)
  assert.equal(upload.type, 'image/png')
  assert.deepEqual(upload.body, Buffer.from('image'))

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

test('keeps GitLab links for videos, deleted uploads and failed copies, and rolls over full releases', async () => {
  const { state, client } = fixture()
  const secret = 'ad58bc7f52258220477bffdbf89decab'
  state.releases.push({ id: 1, tag_name: 'gitlab-uploads', assets: Array.from({ length: 1000 }, (_, index) => ({ name: `${index}`, state: 'uploaded', browser_download_url: '' })) })
  state.downloads[`/uploads/${secret}/deleted.png`] = { status: 404, type: 'text/html', bytes: null }
  state.downloads[`/uploads/${secret}/limited.png`] = { status: 429, type: 'text/html', bytes: null }
  state.sources[0].description = ['video.mp4', 'deleted.png', 'limited.png', 'new image (1).PNG'].map(file => `![${file}](</uploads/${secret}/${file}>)`).join('\n')
  await assert.rejects(sync(client), /Failed to copy 1 images:\nGitLab upload ad58bc7f52258220477bffdbf89decab: GitLab upload download: HTTP 429/)
  const gitlab = 'https://gitlab.com/-/project/85121418/uploads/ad58bc7f52258220477bffdbf89decab'
  assert.ok(state.targets[0].body.endsWith(`[video.mp4](${gitlab}/video.mp4)
![deleted.png](${gitlab}/deleted.png)
![limited.png](${gitlab}/limited.png)
![new image (1).PNG](https://github.com/OpenTubeX/media/releases/download/gitlab-uploads-2/${secret}-new-image-1-.PNG)`))
  assert.deepEqual(state.releases.map(release => release.tag_name), ['gitlab-uploads', 'gitlab-uploads-2'])
})

test('converts upload links and image dimensions without changing unrelated links or attributes', () => {
  const url = 'https://gitlab.com/-/project/85121418/uploads/hash/image.png'
  for (const dimensions of ['{width=900 height=507}', '{width=100px}', '{height=50% width=75%}', '{width="900" height="507"}', "{width='100px'}"]) {
    assert.equal(content(`![Screenshot](/uploads/hash/image.png)${dimensions}`, true), `![Screenshot](${url})`)
    assert.equal(content(`![Screenshot](https://example.org/image.png "Title")${dimensions}`, true), '![Screenshot](https://example.org/image.png "Title")')
  }
  assert.equal(content('/uploads/hash/image.png', true), url)
  assert.equal(content('[attachment](/uploads/hash/image.png)', true), `[attachment](${url})`)
  assert.equal(fromMarkdown(content('[image]: </uploads/hash/image.png>', true)).children[0].url, url)
  assert.equal(content('<img src="/uploads/hash/image.png" width="900">', true), `<img src="${url}" width="900">`)
  assert.equal(content('Text <a href="/uploads/hash/image.png">attachment</a>', true), `Text <a href="${url}">attachment</a>`)
  assert.equal(content('<div><img src="/uploads/hash/image.png"><a href="https://example.org/uploads/other">/uploads/literal</a></div>', true), `<div><img src="${url}"><a href="https://example.org/uploads/other">/uploads/literal</a></div>`)
  assert.equal(content('<source srcset="/uploads/hash/image.png 1x, https://example.org/uploads/other.png 2x, /uploads/hash/large.png 3x">', true), `<source srcset="${url} 1x, https://example.org/uploads/other.png 2x, https://gitlab.com/-/project/85121418/uploads/hash/large.png 3x">`)
  assert.equal(fromMarkdown(content('![image](/uploads/hash/image(1).png){width=100}', true)).children[0].children[0].url, 'https://gitlab.com/-/project/85121418/uploads/hash/image(1).png')
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
      const link = fromMarkdown(content(`![Video](${target}){width=900 height=507}`, true)).children[0].children[0]
      assert.equal(link.type, 'link')
      assert.equal(link.url, fromMarkdown(`![Video](${target})`).children[0].children[0].url)
      assert.equal(link.children[0].value, 'Video')
    }
    assert.equal(fromMarkdown(content(`![](${url})`, true)).children[0].children[0].children[0].value, 'Video')
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
