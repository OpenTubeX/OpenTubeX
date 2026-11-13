import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPluralRules,
  expandMultipleOnlyPluralMessages,
  selectPluralForm
} from '../../src/renderer/i18n/plurals.js'

test('multiple-only messages can omit unreachable plural categories', () => {
  const messages = {
    'Close Multiple Tabs Confirmation': {
      Message: 'few | many'
    },
    Global: {
      Counts: {
        'Comment Count': 'one | other'
      }
    }
  }

  expandMultipleOnlyPluralMessages('pl', messages)

  assert.equal(messages['Close Multiple Tabs Confirmation'].Message, 'few | few | many')
  assert.equal(messages.Global.Counts['Comment Count'], 'one | other')
  assert.equal(selectPluralForm('pl', messages['Close Multiple Tabs Confirmation'].Message, 2), 'few')
  assert.equal(selectPluralForm('pl', messages['Close Multiple Tabs Confirmation'].Message, 5), 'many')
})

test('multiple-only expansion respects categories reachable above one', () => {
  const englishMessages = {
    'Close Multiple Tabs Confirmation': {
      Message: 'multiple'
    }
  }
  const russianMessages = {
    'Close Multiple Tabs Confirmation': {
      Message: 'one | few | many'
    }
  }

  expandMultipleOnlyPluralMessages('en-US', englishMessages)
  expandMultipleOnlyPluralMessages('ru', russianMessages)

  assert.equal(englishMessages['Close Multiple Tabs Confirmation'].Message, 'multiple | multiple')
  assert.equal(russianMessages['Close Multiple Tabs Confirmation'].Message, 'one | few | many')
  assert.equal(selectPluralForm('ru', russianMessages['Close Multiple Tabs Confirmation'].Message, 21), 'one')
})

/** vue-i18n's built-in rule, which our rules fall back to. */
const builtInRule = (choice, choicesLength) => {
  choice = Math.abs(choice)

  return choicesLength === 2 ? (choice === 1 ? 0 : 1) : Math.min(choice, 2)
}

/**
 * @param {string} locale
 * @param {number} choicesLength
 * @param {number[]} counts
 * @returns {number[]}
 */
function selectForms(locale, choicesLength, counts) {
  const rule = createPluralRules([locale])[locale]

  return counts.map(count => rule(count, choicesLength, builtInRule))
}

test('plural rules pick the form each language groups the count under', () => {
  const counts = [1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 112]

  // 1 komentarz | 2 komentarze | 5 komentarzy, where "few" also covers 22 but not 12
  assert.deepEqual(
    selectForms('pl', 3, counts),
    [0, 1, 1, 1, 2, 2, 2, 2, 1, 2, 2]
  )

  // Russian additionally groups 21 and 101 with 1
  assert.deepEqual(
    selectForms('ru', 3, counts),
    [0, 1, 1, 1, 2, 2, 2, 0, 1, 2, 2]
  )

  // Slovenian has a dedicated form for 2
  assert.deepEqual(
    selectForms('sl', 4, counts),
    [0, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3]
  )

  // Japanese doesn't inflect for number at all
  assert.deepEqual(
    selectForms('ja', 1, counts),
    counts.map(() => 0)
  )

  // Arabic has distinct zero, singular, dual, few, many and other forms
  assert.deepEqual(
    selectForms('ar', 6, [0, 1, 2, 3, 11, 100]),
    [0, 1, 2, 3, 4, 5]
  )

  // English is unchanged: singular for 1, plural for everything else
  assert.deepEqual(
    selectForms('en-US', 2, [0, ...counts]),
    [1, 0, ...counts.slice(1).map(() => 1)]
  )
})

test('plural rules fall back when a translation does not cover every form', () => {
  const counts = [0, 1, 2, 5, 22]
  const fallback = counts.map(count => builtInRule(count, 2))

  // Polish and Arabic translations that only provide a singular and a plural
  // keep behaving the way they did before the rules were introduced.
  assert.deepEqual(selectForms('pl', 2, counts), fallback)
  assert.deepEqual(selectForms('ar', 2, counts), fallback)

  // As do messages that still use vue-i18n's "zero | singular | plural" rule.
  assert.deepEqual(
    selectForms('en-US', 3, [0, 1, 2, 5]),
    [0, 1, 2, 2]
  )
})
