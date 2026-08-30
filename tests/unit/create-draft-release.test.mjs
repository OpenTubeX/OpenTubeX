import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

test('uses the push token for protected-branch version bumps', async () => {
  const workflow = loadYaml(await readFile(
    '.github/workflows/create-draft-release.yml',
    'utf8'
  ))
  const checkout = workflow.jobs.create.steps.find(
    step => step.uses?.startsWith('actions/checkout@')
  )

  assert.equal(checkout.with.token, '${{ secrets.PUSH_TOKEN }}')
})
