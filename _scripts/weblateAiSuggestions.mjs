#!/usr/bin/env node

// Offers AI translations from static/locales/ai as suggestions on Weblate for
// strings nobody has translated yet. Dry run by default; --apply submits them.
// The ledger lists every suggestion ever submitted, so suggestions that
// reviewers reject are never offered again, even after they leave Git.

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { load as loadYaml } from 'js-yaml'

const WEBLATE_URL = new URL(process.env.WEBLATE_URL ?? 'https://hosted.weblate.org')
const PROJECT = 'opentubex'
const COMPONENT = 'application'
const LOCALES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../static/locales')
const HUMAN_ONLY_LOCALES = new Set(['en-US', 'de-DE'])
const FINGERPRINT_LENGTH = 16
const MAX_RATE_LIMIT_WAIT_SECONDS = 15 * 60

const { values: options } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    ledger: { type: 'string' }
  }
})
const token = process.env.WEBLATE_TOKEN
if (!token) throw new Error('WEBLATE_TOKEN is required')
if (options.apply && !options.ledger) throw new Error('--apply requires --ledger')
if (options.apply && !existsSync(options.ledger)) {
  throw new Error(`Ledger ${options.ledger} is missing; refusing to resubmit rejected suggestions`)
}

// Weblate uses the nested YAML keys joined with "->" as unit contexts.
function flattenStrings(value, path = [], output = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenStrings(child, [...path, key], output)
  } else if (typeof value === 'string') {
    output.set(path.join('->'), value)
  }
  return output
}

function readStrings(name) {
  const path = join(LOCALES_DIR, name)
  return existsSync(path) ? flattenStrings(loadYaml(readFileSync(path, 'utf8'))) : new Map()
}

// Matches Python's json.dumps(..., ensure_ascii=False), which the ledger was first built with.
function fingerprint(locale, context, source, target) {
  const json = `[${[locale, context, source, target].map(value => JSON.stringify(value)).join(', ')}]`
  return createHash('sha256').update(json).digest('hex').slice(0, FINGERPRINT_LENGTH)
}

async function api(pathOrUrl, { method = 'GET', body } = {}) {
  const url = new URL(pathOrUrl, WEBLATE_URL)
  if (url.origin !== WEBLATE_URL.origin) throw new Error(`Refusing to send the token to ${url.origin}`)

  for (;;) {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        // Keeps error messages in English, which isDuplicateSuggestion matches.
        'Accept-Language': 'en',
        Authorization: `Token ${token}`,
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000)
    })
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after')) || 60
      if (seconds > MAX_RATE_LIMIT_WAIT_SECONDS) throw new Error(`Rate limited for ${seconds} seconds`)
      console.warn(`Rate limited; retrying in ${seconds} seconds`)
      await new Promise(resolve => setTimeout(resolve, seconds * 1000))
      continue
    }
    if (!response.ok) {
      const text = await response.text()
      const error = new Error(`${method} ${url.pathname}${url.search}: ${response.status} ${text}`)
      try {
        error.body = JSON.parse(text)
      } catch {}
      throw error
    }
    return response.json()
  }
}

// Weblate rejects a suggestion identical to one the unit already has, for
// example from a run that timed out after Weblate stored it, or from a translator.
function isDuplicateSuggestion(error) {
  return error.body?.errors?.some(item => item.attr === 'target' && item.detail === 'Your suggestion already exists!')
}

async function list(path) {
  const results = []
  for (let page = await api(path); ; page = await api(page.next)) {
    results.push(...page.results)
    if (!page.next) return results
  }
}

const component = await api(`/api/components/${PROJECT}/${COMPONENT}/`)
if (component.file_format !== 'yaml') throw new Error('Expected a YAML component')
if (!component.enable_suggestions || component.suggestion_autoaccept) {
  throw new Error('Suggestions must be enabled with automatic acceptance disabled')
}

const unitsUrls = new Map(
  (await list(`/api/components/${PROJECT}/${COMPONENT}/translations/?page_size=1000`))
    .map(translation => [translation.filename, translation.units_list_url])
)
const source = readStrings('en-US.yaml')
const locales = JSON.parse(readFileSync(join(LOCALES_DIR, 'activeLocales.json'), 'utf8'))
const ledger = new Set(
  options.ledger && existsSync(options.ledger)
    ? readFileSync(options.ledger, 'utf8').split('\n').filter(Boolean).map(line => line.slice(0, FINGERPRINT_LENGTH))
    : []
)
const totals = {}

try {
  for (const locale of locales) {
    if (HUMAN_ONLY_LOCALES.has(locale)) continue
    const ai = readStrings(`ai/${locale}.yaml`)
    if (ai.size === 0) continue

    const counts = {}
    const count = reason => {
      counts[reason] = (counts[reason] ?? 0) + 1
      totals[reason] = (totals[reason] ?? 0) + 1
    }
    const unitsUrl = unitsUrls.get(`static/locales/${locale}.yaml`)
    if (!unitsUrl) {
      count('missing-language')
      continue
    }

    const human = readStrings(`${locale}.yaml`)
    const untranslated = new Map(
      (await list(`${unitsUrl}?q=state:empty&page_size=1000`))
        .map(unit => [unit.context, unit])
    )

    for (const [context, target] of ai) {
      if (!target || !source.has(context)) {
        count(target ? 'missing-source' : 'empty')
        continue
      }
      const unit = untranslated.get(context)
      const key = fingerprint(locale, context, source.get(context), target)
      // Read-only and translated strings are not in the untranslated list.
      if (human.get(context)) count('human')
      else if (!unit) count('translated-or-missing')
      else if (unit.source.length !== 1 || unit.source[0] !== source.get(context)) count('source-mismatch')
      else if (ledger.has(key)) count('previously-submitted')
      else if (!options.apply) count('would-submit')
      else {
        let result = 'submitted'
        try {
          await api(`/api/units/${unit.id}/suggestions/`, { method: 'POST', body: { target: [target] } })
        } catch (error) {
          if (!isDuplicateSuggestion(error)) throw error
          result = 'already-suggested'
        }
        ledger.add(key)
        // Record it right away, so a cancelled run never offers it again.
        appendFileSync(options.ledger, `${key}\n`)
        count(result)
      }
    }
    console.log(JSON.stringify({ locale, counts }))
  }
} finally {
  if (options.apply) writeFileSync(options.ledger, [...ledger].sort().join('\n') + '\n')
}

console.log(JSON.stringify({ apply: options.apply, counts: totals }))
