// Firefox provides promise-based APIs as `browser`, Chrome as `chrome`
const ext = globalThis.browser ?? globalThis.chrome

const SCRIPT_ID = 'custom-origins'

const form = document.getElementById('add-form')
const input = document.getElementById('origin')
const errorText = document.getElementById('error')
const list = document.getElementById('origins')
const removeButton = document.getElementById('remove-button')

/**
 * Fills in the text of the elements with a `data-i18n` message name.
 * @param {ParentNode} root
 */
function localize(root) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = ext.i18n.getMessage(element.dataset.i18n)
  }
}

// Follows the translation shown, which can be a fallback from the browser language
document.documentElement.lang = ext.i18n.getMessage('language')
document.documentElement.dir = ext.i18n.getMessage('direction')
localize(document)
localize(removeButton.content)

/** @returns {Promise<string[]>} the added origins, such as `https://tube.example.com` or `http://localhost` */
async function getOrigins() {
  const [script] = await ext.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  return script?.matches.map(pattern => pattern.slice(0, -'/*'.length)) ?? []
}

/**
 * Applies the built-in rules and app marker to the given origins as well.
 * @param {string[]} origins
 */
async function setOrigins(origins) {
  const rules = await (await fetch(ext.runtime.getURL('rules.json'))).json()
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.map(rule => rule.id),
    addRules: origins.length === 0
      ? []
      : rules.map(rule => ({
          ...rule,
          condition: { ...rule.condition, initiatorDomains: origins.map(origin => new URL(origin).hostname) }
        }))
  })

  await ext.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {})
  if (origins.length > 0) {
    await ext.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: origins.map(origin => `${origin}/*`),
      js: ['marker.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true
    }])
  }
}

/**
 * Changes the list in one step, even across several open options pages.
 * @param {(origins: string[]) => string[]} change
 */
function updateOrigins(change) {
  return navigator.locks.request(SCRIPT_ID, async () => {
    const origins = await getOrigins()
    const changed = change(origins)
    if (changed !== origins) await setOrigins(changed)
  })
}

async function render() {
  list.replaceChildren(...(await getOrigins()).map((origin, index) => {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.id = `origin-${index}`
    name.textContent = origin
    const remove = removeButton.content.firstElementChild.cloneNode(true)
    // Tells screen reader users which server each Remove button removes
    remove.setAttribute('aria-describedby', name.id)
    remove.addEventListener('click', async () => {
      await updateOrigins(origins => origins.filter(other => other !== origin))
      // Built-in origins, such as opentubex.org, keep their required permission
      await ext.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {})
      await render()
    })
    item.append(name, remove)
    return item
  }))
}

form.addEventListener('submit', event => {
  event.preventDefault()
  errorText.textContent = ''

  let origin
  try {
    const url = new URL(input.value.trim())
    // Browsers treat these as secure, so self-hosted servers on this computer don't need HTTPS
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !local) throw new Error()
    origin = `${url.protocol}//${url.hostname}`
  } catch {
    errorText.textContent = ext.i18n.getMessage('invalidAddressError')
    return
  }

  // Browsers only show the permission prompt in direct response to the click
  ext.permissions.request({ origins: [`${origin}/*`] }).then(async granted => {
    if (!granted) {
      errorText.textContent = ext.i18n.getMessage('permissionDeniedError')
      return
    }
    await updateOrigins(origins => origins.includes(origin) ? origins : [...origins, origin])
    input.value = ''
    await render()
  }).catch(error => {
    errorText.textContent = String(error?.message ?? error)
  })
})

render()
