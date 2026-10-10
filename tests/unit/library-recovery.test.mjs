import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import { load as loadYaml } from 'js-yaml'
import { composeLocaleMessages } from '../../src/localeComposition.js'
import { expandMultipleOnlyPluralMessages, selectPluralForm } from '../../src/renderer/i18n/plurals.js'

const main = await readFile(new URL('../../src/main/index.js', import.meta.url), 'utf8')

test('startup recovery uses translated guidance without querying failed settings', async () => {
  for (const [locale, useAITranslationCompletions] of [['de-DE', true], ['fr-FR', true], ['fr-FR', false], ['fr-FR', undefined]]) {
    let finished
    let message
    let exit
    const failure = Object.assign(new Error('Technical database diagnostic'), { code: 'LIBRARY_MISSING', locale, useAITranslationCompletions })
    const context = vm.createContext({
      path, loadYaml, composeLocaleMessages, expandMultipleOnlyPluralMessages, selectPluralForm,
      __dirname: fileURLToPath(new URL('../../src/main', import.meta.url)),
      process: { env: { NODE_ENV: 'development' } },
      asyncFs: { readFile },
      console,
      baseHandlers: {
        loadDatastores: () => ({ catch: handler => { finished = handler(failure) } }),
        settings: { _findOne: () => { throw new Error('Failed settings must not be queried') } },
      },
      app: { whenReady: async () => {}, getLocale: () => locale, getName: () => 'OpenTubeX', exit: value => { exit = value } },
      dialog: { showErrorBox: (_title, value) => { message = value } },
    })
    vm.runInContext(main.slice(main.indexOf('function getLocaleMessage('), main.indexOf('function printHelp(')), context)
    vm.runInContext(main.slice(main.indexOf('baseHandlers.loadDatastores().catch('), main.indexOf('    runApp()')), context)
    await finished
    const messageLocale = useAITranslationCompletions !== false ? locale : 'en-US'
    const messages = loadYaml(await readFile(new URL(`../../static/locales/${messageLocale === 'fr-FR' ? 'ai/' : ''}${messageLocale}.yaml`, import.meta.url), 'utf8'))
    assert.equal(message, `${messages.Library.CouldNotOpen}\n\n${messages.Library.RestoreProfile}\n\n${failure.message}`)
    assert.equal(exit, 1)
  }
})
