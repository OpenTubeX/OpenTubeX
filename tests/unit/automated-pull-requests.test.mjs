import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import { validatePullRequest } from '../../_scripts/releaseNotes.mjs'

test('automated pull requests opt out of release notes', () => {
  const steps = readdirSync('.github/workflows')
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) => Object.values(loadYaml(readFileSync(`.github/workflows/${file}`, 'utf8')).jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('peter-evans/create-pull-request@'))
      .map((step) => ({ file, body: step.with.body })))

  assert.ok(steps.length >= 3)

  for (const { file, body } of steps) {
    assert.doesNotThrow(() => validatePullRequest(body, []), file)
  }
})
