import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldReply,
  validateDecision
} from '../../_scripts/issueTriage.mjs'
import { eligibleAuthor } from '../../_scripts/issueTriageCommon.mjs'

test('triage excludes D3SOX and bot issue authors', () => {
  assert.equal(eligibleAuthor({ login: 'D3SOX', __typename: 'User' }), false)
  assert.equal(eligibleAuthor({ login: 'd3sox', __typename: 'User' }), false)
  assert.equal(eligibleAuthor({ login: 'app', __typename: 'Bot' }), false)
  assert.equal(eligibleAuthor({ login: 'app[bot]', __typename: 'User' }), false)
  assert.equal(eligibleAuthor({ login: 'reporter', __typename: 'User' }), true)
  assert.equal(eligibleAuthor(null), false)
})

test('model decisions cannot publish arbitrary labels or replies', () => {
  assert.deepEqual(validateDecision({ labels: ['bug'], reply: 'none' }), {
    labels: ['bug'], reply: 'none'
  })
  assert.throws(() => validateDecision({ labels: ['wontfix'], reply: 'none' }))
  assert.throws(() => validateDecision({ labels: ['bug', 'bug'], reply: 'none' }))
  assert.throws(() => validateDecision({ labels: [], reply: 'Close this issue' }))
})

test('triage avoids repeated or intrusive replies', () => {
  const reply = 'Which OpenTubeX version are you using?'
  assert.equal(shouldReply([], reply), true)
  assert.equal(shouldReply([{ body: reply, author: { login: 'other' } }], reply), false)
  assert.equal(shouldReply([{
    body: 'Looking into it',
    authorAssociation: 'COLLABORATOR',
    author: { login: 'maintainer' }
  }], reply), false)
  assert.equal(shouldReply([{
    body: 'Automated response',
    author: { login: 'actions[bot]', __typename: 'Bot' }
  }], reply), false)
})
