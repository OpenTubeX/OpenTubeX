import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { createI18n } from 'vue-i18n'
import { getKeyboardShortcutLabelMappings } from '../../src/renderer/helpers/keyboardShortcutLabels.js'

for (const locale of ['en-US', 'de-DE']) {
  test(`shared shortcut labels preserve action names and alternate bindings in ${locale}`, async () => {
    const messages = YAML.parse(await readFile(new URL(`../../static/locales/${locale}.yaml`, import.meta.url), 'utf8'))
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages } })
    const translate = key => {
      assert.ok(i18n.global.te(key), key)
      return i18n.global.t(key)
    }
    const labels = new Map(getKeyboardShortcutLabelMappings(translate).flatMap(([label, codes]) => codes.map(code => [code, label])))
    for (const [code, key] of [
      ['RESTORE_CLOSED_TAB', 'KeyboardShortcutPrompt.Reopen Closed Tab'],
      ['PREV_TAB', 'KeyboardShortcutPrompt.Previous Tab'],
      ['NAVIGATE_TO_SETTINGS', 'KeyboardShortcutPrompt.Navigate to Settings'],
      ['PICTURE_IN_PICTURE', 'KeyboardShortcutPrompt.Picture in Picture'],
      ['SET_AB_REPEAT_START', 'KeyboardShortcutPrompt.Set A-B Repeat Point A'],
      ['TOGGLE_SKIP_SILENCE', 'KeyboardShortcutPrompt.Toggle Skip Silence'],
      ['FULLWINDOW', 'KeyboardShortcutPrompt.Full Window'],
    ]) assert.equal(labels.get(code), translate(key))
    assert.equal(labels.get('RELOAD_TAB'), labels.get('RELOAD_TAB_ALT'))
    assert.equal(getKeyboardShortcutLabelMappings(translate, true).some(([, codes]) => codes.includes('FULLWINDOW')), false)
  })
}
