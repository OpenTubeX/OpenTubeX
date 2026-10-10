import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marked } from 'marked'
import { content, createClient, list, sync } from '../../_scripts/gitlabIssueSync.mjs'

function fixture() {
  const state = {
    sources: [{ iid: 1, title: 'Report', description: 'Description', state: 'opened', confidential: false,
      imported: false, author: { id: 1, username: 'reporter' }, web_url: 'https://gitlab.com/opentubex/OpenTubeX/-/issues/1' }],
    targets: [], mergeRequests: [], notes: [], comments: [], writes: [],
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
  state.sources[0].description = '* [ ] #538\n* [ ] https://gitlab.com/opentubex/OpenTubeX/-/work_items/538'
  state.notes.push({ id: 10, body: 'See #538', author: { id: 1, username: 'reporter' } })
  await sync(client)
  const reference = `[Smart pull for "View All" playlists](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(`* [ ] ${reference}\n* [ ] ${reference}`))
  assert.ok(state.comments[0].body.endsWith(`See ${reference}`))
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
  state.comments.push({ id: 20, body: `See #${target.number} and #538`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith(
    `See [Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url})) and [Unrelated pull request](https://github.com/OpenTubeX/OpenTubeX/pull/538)`))
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
    '[ref]: https://example.org/#1',
    '<span data-ref="#1">', '<!-- example\n#1\n-->', '<code>#1</code>', '<pre>\n#1\n</pre>',
    '<pre>\n    #1\n#1\n</pre>', '<pre>\n```\n#1\n```\n#1\n</pre>', '&#123;', '#123abc',
  ].join('\n\n')
  state.sources[0].description = preserved
  await sync(client)
  assert.ok(state.targets[0].body.endsWith(preserved))
  state.comments.push({ id: 20, body: preserved, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith(preserved))
})

test('explicit local links retain comment fragments and escape title Markdown', async () => {
  const { state, client } = fixture()
  state.sources[0].title = 'A [title] *with* _format_ <tag> `code` \\ path'
  state.sources[0].description = '[old title](https://gitlab.com/opentubex/OpenTubeX/-/issues/1#note_10)\n<https://gitlab.com/opentubex/OpenTubeX/-/work_items/1>\n(opentubex/OpenTubeX#1).'
  await sync(client)
  const body = state.targets[0].body
  assert.ok(body.includes('[A \\[title\\] \\*with\\* \\_format\\_ \\<tag\\> \\`code\\` \\\\ path]'))
  assert.ok(body.includes(`${state.sources[0].web_url}#note_10)`))
  assert.equal((body.match(/GitHub #/g) ?? []).length, 3)
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

test('nested tracking lists resolve references while indented list code remains intact', async () => {
  const { state, client } = fixture()
  const description = '* Parent\n    * [ ] #1\n    * Child\n      See #1\n\n          #1\n    * [ ] #1\n\nOutside\n\n    #1'
  state.sources[0].description = description
  await sync(client)
  const target = state.targets[0]
  const reference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(description.replaceAll('#1', reference).replaceAll(`          ${reference}`, '          #1').replaceAll(`    ${reference}`, '    #1')))
  state.comments.push({ id: 20, body: description, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.equal((state.notes[1].body.match(/\[GitHub #1\]/g) ?? []).length, 3)
  assert.ok(state.notes[1].body.endsWith('Outside\n\n    #1'))
})

test('Markdown link tooltips do not prevent title and counterpart conversion', async () => {
  const { state, client } = fixture()
  const url = state.sources[0].web_url
  const tooltips = [' "Tooltip"', " 'Tooltip'", ' (Tooltip)']
  state.sources[0].description = `[old label](${url} "Tooltip")\n[old label](<${url}> 'Tooltip')\n[old label](${url} (Tooltip))`
  await sync(client)
  const target = state.targets[0]
  assert.ok(target.body.endsWith(tooltips.map(tooltip => `[Report](${url}${tooltip}) ([GitHub #${target.number}](${target.html_url}))`).join('\n')))
  state.comments.push({ id: 20, body: tooltips.map(tooltip => `[old label](${target.html_url}${tooltip})`).join('\n'), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  assert.ok(state.notes[1].body.endsWith(tooltips.map(tooltip => `[Report](${target.html_url}${tooltip}) ([GitLab #1](${url}))`).join('\n')))
})

test('defined shortcut reference labels containing issue numbers stay intact', async () => {
  const { state, client } = fixture()
  const preserved = '[#1] and [REF #1] and ![#1]\n\n[#1]: https://example.org\n[ref #1]: https://example.org/other'
  state.sources[0].description = preserved + '\n\nSee #1'
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(`${preserved}\n\nSee ${gitlabReference}`))
  const githubBody = preserved.replaceAll('#1', `#${target.number}`)
  state.comments.push({ id: 20, body: `${githubBody}\n\nSee #${target.number}`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(`${githubBody}\n\nSee ${githubReference}`))
})

test('shortcut reference definitions work inside blockquotes and lists', async () => {
  for (const example of ['> [REF]\n>\n> [REF]: https://example.org', '- [REF]: https://example.org\n\n  [REF]', '- item\n    [REF]: https://example.org\n\n    [REF]']) {
    const { state, client } = fixture()
    const preserved = reference => example.replaceAll('REF', reference)
    state.sources[0].description = `${preserved('#1')}\n\nSee #1`
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(`${preserved('#1')}\n\nSee ${gitlabReference}`))
    state.comments.push({ id: 20, body: `${preserved(`#${target.number}`)}\n\nSee #${target.number}`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(`${preserved(`#${target.number}`)}\n\nSee ${githubReference}`))
  }
})

test('escaped brackets in shortcut reference labels keep their unrelated destination', async () => {
  for (const label of ['REF\\]', 'REF\\[label\\]']) {
    const { state, client } = fixture()
    const body = reference => `[${label}]: https://example.org\n\n[${label}]\n\nOutside REF`.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    assert.match(marked.parse(target.body), /href="https:\/\/example.org"/)
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
    assert.match(marked.parse(state.notes[1].body), /href="https:\/\/example.org"/)
  }
})

test('lazy blockquote continuations stay prose while blank-separated indentation stays code', async () => {
  for (const example of ['> Text\n    Outside REF', '> > Text\n    Outside REF\n>     Outside REF', '> Text\n    Outside REF\n>     Outside REF', '> Text\n\n    REF\n\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('ordered lists interrupt paragraphs only when starting at one', async () => {
  for (const example of ['Text\n2. item\n\n    REF\n\nOutside REF', 'Text\n2) item\n\n    REF\n\nOutside REF', 'Text\n1. item\n\n    Outside REF', '2. item\n\n    Outside REF', '1. item\n2. item\n\n    Outside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('nested Markdown link labels keep unrelated destinations and convert local links', async () => {
  const { state, client } = fixture()
  const preserved = reference => [`[outer [${reference}]](https://example.org)`, `![outer [${reference}]](https://example.org/image.png)`,
    `[outer [middle [${reference}]]](https://example.org)`, `[outer [${reference}]][ref]`, '[ref]: https://example.org'].join('\n\n')
  state.sources[0].description = `${preserved('#1')}\n\n[outer [#1]](${state.sources[0].web_url} "Tooltip")\nSee #1`
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = tooltip => `[Report](${state.sources[0].web_url}${tooltip}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(`${preserved('#1')}\n\n${gitlabReference(' "Tooltip"')}\nSee ${gitlabReference('')}`))
  state.comments.push({ id: 20, body: `${preserved(`#${target.number}`)}\n\n[outer [#${target.number}]](${target.html_url} "Tooltip")\nSee #${target.number}`, user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = tooltip => `[Report](${target.html_url}${tooltip}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(`${preserved(`#${target.number}`)}\n\n${githubReference(' "Tooltip"')}\nSee ${githubReference('')}`))
})

test('pipes in issue titles do not split rendered table cells', async () => {
  const { state, client } = fixture()
  state.sources[0].title = 'A | title'
  const body = reference => `| Issue | Status |\n| --- | --- |\n| ${reference} | Kept |`
  const checkTable = text => {
    const table = marked.lexer(text).find(token => token.type === 'table')
    assert.equal(table.rows[0].length, 2)
    assert.equal(table.rows[0][1].text, 'Kept')
    assert.match(marked.parse(text), />A \| title<\/a>/)
  }
  state.sources[0].description = body('#1')
  await sync(client)
  const target = state.targets[0]
  checkTable(target.body)
  state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  checkTable(state.notes[1].body)
})

test('tabs after list markers set the content column without changing literal code', async () => {
  for (const example of ['-\titem\n\n      Outside REF\n\n        REF', '1.\titem\n\n      Outside REF\n\n        REF', '- \titem\n\n      Outside REF\n\n        REF']) {
    const { state, client } = fixture()
    const body = reference => `${example}\n\nOutside REF`.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('ordered list markers allow at most nine digits', async () => {
  for (const example of ['1234567890.     Outside REF', '1234567890)     Outside REF', '123456789.     REF\n\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('mixed indentation tabs advance to the next four-column stop', async () => {
  const { state, client } = fixture()
  const body = reference => `- item\n\n  \tOutside ${reference}\n\n  \t  ${reference}\n\nOutside ${reference}`
  state.sources[0].description = body('#1')
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
  state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
})

test('inline code uses entire backtick runs as delimiters', async () => {
  for (const example of ['Text ``` Outside REF ` end', 'Text ` Outside REF ``` end', 'Text ``REF ` inside`` Outside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('list-item fences preserve literal references and resume conversion after closing', async () => {
  for (const marker of ['-', '*', '1.', '    -']) {
    const { state, client } = fixture()
    const code = reference => [marker.startsWith(' ') ? '* Parent' : '',
      `${marker} \`\`\`text`, `${' '.repeat(marker.length + 1)}${reference}`,
      `${' '.repeat(marker.length + 1)}\`\`\``, '', `See ${reference}`].filter((line, index) => index !== 0 || line).join('\n')
    state.sources[0].description = code('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(code('#1').replace('See #1', `See ${gitlabReference}`)))
    state.comments.push({ id: 20, body: code(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(code(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`)))
  }
})

test('blockquote containers preserve indented and fenced code while converting prose', async () => {
  const { state, client } = fixture()
  const quoted = reference => ['* Parent', '', `>     ${reference}`, `> >     ${reference}`, `> \t${reference}`,
    '> - ```text', `>   ${reference}`, '>   ```', `> See ${reference}`, '', `See ${reference}`].join('\n')
  state.sources[0].description = quoted('#1')
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(quoted('#1').replaceAll('See #1', `See ${gitlabReference}`)))
  state.comments.push({ id: 20, body: quoted(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(quoted(`#${target.number}`).replaceAll(`See #${target.number}`, `See ${githubReference}`)))
})

test('fences end when their blockquote container exits, preserving root fence contents', async () => {
  const examples = [
    '> ```text\n> REF\nOutside REF',
    '> ~~~\n> > REF\n> REF\n\nOutside REF',
    '> > ```\n> > REF\n> Outside REF\nOutside REF',
    '> - ```\n>   REF\nOutside REF',
    '```\n> REF\nREF\n```\nOutside REF',
  ]
  for (const example of examples) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('unterminated HTML code blocks preserve references through the end of the document', async () => {
  for (const tag of ['pre', 'code']) {
    const { state, client } = fixture()
    const body = reference => `See ${reference}\n\n<${tag}>\n${reference}\n    ${reference}\n\`\`\`text\n${reference}`
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('See #1', `See ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`)))
  }
})

test('HTML comments preserve references across code-looking lines and through EOF', async () => {
  for (const ending of ['', '\n-->\nOutside REF', '\n--!>\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => `See REF\n\n<!--\nREF\n    REF\n\`\`\`\nREF${ending}`.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('See #1', `See ${gitlabReference}`).replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('HTML regions end with their containing blockquote', async () => {
  for (const tag of ['<pre>', '<code>', '<!--']) {
    for (const quote of ['>', '> >']) {
      const { state, client } = fixture()
      const body = reference => `${quote} ${tag}\n${quote} ${reference}\n> Outside ${reference}\nOutside ${reference}`
      state.sources[0].description = body('#1')
      await sync(client)
      const target = state.targets[0]
      const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
      const expected = (reference, link) => quote === '>'
        ? body(reference).replace(`\nOutside ${reference}`, `\nOutside ${link}`)
        : body(reference).replaceAll(`Outside ${reference}`, `Outside ${link}`)
      assert.ok(target.body.endsWith(expected('#1', gitlabReference)))
      state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
      await sync(client)
      const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
      assert.ok(state.notes[1].body.endsWith(expected(`#${target.number}`, githubReference)))
    }
  }
})

test('backtick fence info strings reject backticks while tilde fences allow them', async () => {
  for (const example of ['```foo`bar\nOutside REF', '~~~foo`bar\nREF\n~~~\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('indented paragraph continuations resolve references while separate code blocks stay literal', async () => {
  for (const quote of ['', '> ']) {
    const { state, client } = fixture()
    const body = reference => ['Text', `    Continuation ${reference}`, '', `    ${reference}`, '', '# Heading', `    ${reference}`, '', `Outside ${reference}`].map(line => quote + line).join('\n')
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Continuation #1', `Continuation ${gitlabReference}`).replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Continuation #${target.number}`, `Continuation ${githubReference}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('HTML tags inside indented code do not protect later prose', async () => {
  for (const tag of ['<pre>', '<code>', '<!--']) {
    for (const quote of ['', '> ']) {
      const { state, client } = fixture()
      const body = reference => `${quote}    ${tag}\n${quote}Outside ${reference}\nOutside ${reference}`
      state.sources[0].description = body('#1')
      await sync(client)
      const target = state.targets[0]
      const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
      assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
      state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
      await sync(client)
      const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
      assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
    }
  }
})

test('five-space list padding starts literal indented code', async () => {
  for (const marker of ['-', '*', '1.', '    -']) {
    const { state, client } = fixture()
    const body = reference => `${marker.startsWith(' ') ? '* Parent\n' : ''}${marker}     ${reference}\n\n${' '.repeat(marker.length + 5)}${reference}\n\nOutside ${reference}`
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('unclosed list fences end when their list container exits', async () => {
  for (const example of ['- ```\n  REF\n\nOutside REF', '1. ~~~\n   REF\n\nOutside REF', '* Parent\n    - ```\n      REF\n\n    Outside REF\nOutside REF', '> - ```\n>   REF\n>\n> Outside REF\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('quoted fence-like content cannot close an open fence', async () => {
  for (const example of ['```\n> ```\nREF\n```\nOutside REF', '> ```\n> > ```\n> REF\n> ```\nOutside REF', '- ```\n  > ```\n  REF\n  ```\nOutside REF', '> - ```\n>   > ```\n>   REF\n>   ```\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('unclosed HTML regions end when their list container exits', async () => {
  for (const tag of ['<pre>', '<code>', '<!--']) {
    for (const example of [`- ${tag}\n  REF\n\nOutside REF`, `1. ${tag}\n   REF\n\nOutside REF`, `* Parent\n    - ${tag}\n      REF\n\n    Outside REF\nOutside REF`, `> - ${tag}\n>   REF\n>\n> Outside REF\nOutside REF`]) {
      const { state, client } = fixture()
      const body = reference => example.replaceAll('REF', reference)
      state.sources[0].description = body('#1')
      await sync(client)
      const target = state.targets[0]
      const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
      assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
      state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
      await sync(client)
      const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
      assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
    }
  }
})

test('bare local URLs retain balanced parentheses and leave unmatched punctuation outside links', async () => {
  const { state, client } = fixture()
  const body = url => `See ${url}?x=(a)\nSee (${url}#note_(a)).\nSee ${url}?x=((a))).`
  state.sources[0].description = body(state.sources[0].web_url)
  await sync(client)
  const target = state.targets[0]
  const checkLinks = (text, url, other) => {
    const links = [...marked.parse(text.slice(text.indexOf('See '))).matchAll(/<a href="([^"]+)">/g)].map(match => match[1])
    assert.deepEqual(links, [`${url}?x=(a)`, other, `${url}#note_(a)`, other, `${url}?x=((a))`, other])
    assert.ok(text.endsWith(').'))
  }
  checkLinks(target.body, state.sources[0].web_url, target.html_url)
  state.comments.push({ id: 20, body: body(target.html_url), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  checkLinks(state.notes[1].body, target.html_url, state.sources[0].web_url)
})

test('setext headings end paragraphs before indented code', async () => {
  for (const example of ['Heading\n===\n    REF', 'Heading\n-\n    REF', 'Heading\n---\n    REF', '> Heading\n> ===\n>     REF', '- Heading\n  ===\n      REF']) {
    const { state, client } = fixture()
    const body = reference => `${example}\n\nOutside REF`.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('lowercase pseudo-declarations remain prose references', async () => {
  for (const example of ['<!foo\nOutside REF', '<!foo Outside REF>\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('comparison brackets do not hide prose references while valid HTML stays literal', async () => {
  const { state, client } = fixture()
  const body = reference => `Expected x < 3 and Outside ${reference} > 0\nExpected x < 3\nand Outside ${reference} > 0\n<span data-ref="${reference}">Outside ${reference}</span>\n<https://example.org/${reference}>`
  state.sources[0].description = body('#1')
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
  state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
})

test('processing instructions declarations and CDATA preserve raw content through closing or EOF', async () => {
  for (const [opening, closing] of [['<?php', '?>'], ['<!DOCTYPE html', '>'], ['<![CDATA[', ']]>']]) {
    for (const close of [false, true]) {
      const { state, client } = fixture()
      const body = reference => `See ${reference}\n\n${opening}\n$x = "${reference}";\n\n    ${reference}\n\`\`\`\n${reference}${close ? `\n${closing}\nOutside ${reference}` : ''}`
      state.sources[0].description = body('#1')
      await sync(client)
      const target = state.targets[0]
      const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
      assert.ok(target.body.endsWith(body('#1').replace('See #1', `See ${gitlabReference}`).replace('Outside #1', `Outside ${gitlabReference}`)))
      state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
      await sync(client)
      const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
      assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
    }
  }
})

test('generic HTML blocks preserve references until a blank line or container exit', async () => {
  for (const example of ['<div>\nREF\n</div>\n\nOutside REF', '<table>\nREF\n</table>\n\nOutside REF', '<details>\nREF\n</details>\n\nOutside REF', '<DIV class="example"\nREF\n\nOutside REF', '> <div>\n> REF\nOutside REF', '- <table>\n  REF\nOutside REF', '<custom data-ref="example">\nREF\n</custom>\n\nOutside REF', '</div>\nREF\n\nOutside REF', '<div>\nREF\n\nOutside REF', 'Text\n<span>\nOutside REF']) {
    const { state, client } = fixture()
    const body = reference => example.replaceAll('REF', reference)
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('inline-code HTML openers do not swallow subsequent indented code or prose', async () => {
  for (const tag of ['<pre>', '<code>', '<script>', '<!--']) {
    const { state, client } = fixture()
    const body = reference => `\`${tag}\`\n\n    ${reference}\n\nOutside ${reference}`
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('Outside #1', `Outside ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
  }
})

test('raw-text HTML blocks preserve their contents until closing or EOF', async () => {
  for (const tag of ['script', 'style', 'textarea']) {
    for (const close of [false, true]) {
      const { state, client } = fixture()
      const body = reference => `See ${reference}\n\n<${tag}>\nconst issue = "${reference}"\n    ${reference}\n\`\`\`\n${reference}${close ? `\n</${tag}>\nOutside ${reference}` : ''}`
      state.sources[0].description = body('#1')
      await sync(client)
      const target = state.targets[0]
      const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
      assert.ok(target.body.endsWith(body('#1').replace('See #1', `See ${gitlabReference}`).replace('Outside #1', `Outside ${gitlabReference}`)))
      state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
      await sync(client)
      const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
      assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`).replace(`Outside #${target.number}`, `Outside ${githubReference}`)))
    }
  }
})

test('multiple blank lines retain list paragraphs and their indented code threshold', async () => {
  const { state, client } = fixture()
  const body = reference => `- item\n\n\n    Outside ${reference}\n\n      ${reference}\n\nOutside ${reference}`
  state.sources[0].description = body('#1')
  await sync(client)
  const target = state.targets[0]
  const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
  assert.ok(target.body.endsWith(body('#1').replaceAll('Outside #1', `Outside ${gitlabReference}`)))
  state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
  await sync(client)
  const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
  assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replaceAll(`Outside #${target.number}`, `Outside ${githubReference}`)))
})

test('thematic breaks do not turn following indented code into list prose', async () => {
  for (const rule of ['* * *', '- - -', '_ _ _', '***', '---', '___']) {
    const { state, client } = fixture()
    const body = reference => `${rule}\n\n    ${reference}\n\n> ${rule}\n>\n>     ${reference}\n\nSee ${reference}`
    state.sources[0].description = body('#1')
    await sync(client)
    const target = state.targets[0]
    const gitlabReference = `[Report](${state.sources[0].web_url}) ([GitHub #${target.number}](${target.html_url}))`
    assert.ok(target.body.endsWith(body('#1').replace('See #1', `See ${gitlabReference}`)))
    state.comments.push({ id: 20, body: body(`#${target.number}`), user: { login: 'maintainer' }, html_url: 'https://github.com/comment' })
    await sync(client)
    const githubReference = `[Report](${target.html_url}) ([GitLab #1](${state.sources[0].web_url}))`
    assert.ok(state.notes[1].body.endsWith(body(`#${target.number}`).replace(`See #${target.number}`, `See ${githubReference}`)))
  }
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
