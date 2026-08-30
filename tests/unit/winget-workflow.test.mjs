import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

test('uses the ref lookup status when creating a version branch', async () => {
  const workflow = loadYaml(await readFile(
    '.github/workflows/winget.yml',
    'utf8'
  ))
  const createCommit = workflow.jobs.submit.steps.find(
    step => step.name === 'Create the signed version commit'
  )

  assert.match(
    createCommit.run,
    /if remote_sha="\$\(gh api .* --jq \.object\.sha 2>\/dev\/null\)"; then/
  )
})
