import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { GITLAB_DIRECTORY, renderTemplates } from '../../_scripts/gitlabIssueTemplates.mjs'

test('GitLab issue templates match the GitHub issue forms', () => {
  const templates = renderTemplates()
  const message = 'Run `node _scripts/gitlabIssueTemplates.mjs` to regenerate .gitlab/issue_templates'

  assert.deepEqual(readdirSync(GITLAB_DIRECTORY).sort(), [...templates.keys()].sort(), message)
  for (const [file, content] of templates) {
    assert.equal(readFileSync(join(GITLAB_DIRECTORY, file), 'utf8'), content, `${file}: ${message}`)
  }
})
