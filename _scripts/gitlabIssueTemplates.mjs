#!/usr/bin/env node

// GitLab has no issue forms, so this renders the GitHub forms as Markdown templates.
// Run it after changing .github/ISSUE_TEMPLATE; a unit test fails while the output is stale.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GITHUB_DIRECTORY = join(ROOT, '.github/ISSUE_TEMPLATE')
export const GITLAB_DIRECTORY = join(ROOT, '.gitlab/issue_templates')

function comment(lines) {
  const text = lines.filter(Boolean).map(line => line.trim()).join('\n')
  if (!text) return []
  if (text.includes('-->')) throw new Error(`Issue form text cannot contain "-->": ${text}`)
  return [text.includes('\n') ? `<!--\n${text}\n-->` : `<!-- ${text} -->`]
}

function renderField({ type, attributes, validations }) {
  if (type === 'markdown') return attributes.value.trim()

  const required = validations?.required && 'Required.'
  const lines = [`### ${attributes.label}`]
  switch (type) {
    case 'checkboxes':
      lines.push(
        ...comment([attributes.description]),
        ...attributes.options.map(option => `- [ ] ${option.label}${option.required ? ' (required)' : ''}`)
      )
      break
    case 'dropdown':
      lines.push(
        ...comment([attributes.description, attributes.multiple ? 'Check all that apply.' : 'Check one.', required]),
        ...attributes.options.map(option => `- [ ] ${option}`)
      )
      break
    case 'input':
    case 'textarea':
    case 'upload':
      lines.push(...comment([
        attributes.description,
        attributes.placeholder && `Example:\n${attributes.placeholder.trim().replace(/^e\.g\. /, '')}`,
        required
      ]))
      break
    default:
      throw new Error(`Unsupported issue form field type: ${type}`)
  }
  return lines.join('\n')
}

/** @returns {Map<string, string>} GitLab template file names mapped to their contents */
export function renderTemplates() {
  const templates = new Map()
  for (const file of readdirSync(GITHUB_DIRECTORY).sort()) {
    if (!/\.ya?ml$/.test(file) || file === 'config.yml') continue
    const form = parse(readFileSync(join(GITHUB_DIRECTORY, file), 'utf8'))
    templates.set(`${form.name}.md`, `${form.body.map(renderField).join('\n\n')}\n`)
  }
  return templates
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const templates = renderTemplates()
  mkdirSync(GITLAB_DIRECTORY, { recursive: true })
  for (const file of readdirSync(GITLAB_DIRECTORY)) {
    if (!templates.has(file)) rmSync(join(GITLAB_DIRECTORY, file))
  }
  for (const [file, content] of templates) writeFileSync(join(GITLAB_DIRECTORY, file), content)
}
