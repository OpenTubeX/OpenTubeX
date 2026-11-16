// Firefox provides promise-based APIs as `browser`, Chrome as `chrome`
const ext = globalThis.browser ?? globalThis.chrome

// Rule conditions can't match a port, so rules for localhost would apply to
// every page served from this computer. Only development installs (unpacked in
// Chrome, temporary in Firefox) apply them, for the web app's dev server.
const SCRIPT_ID = 'development'
const HOSTS = ['localhost', '127.0.0.1']
// Keeps clear of the rule IDs that the options page copies from rules.json
const RULE_ID_OFFSET = 1000

async function applyDevelopmentRules() {
  const development = (await ext.management.getSelf()).installType === 'development'
  const rules = await (await fetch(ext.runtime.getURL('rules.json'))).json()
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.map(rule => rule.id + RULE_ID_OFFSET),
    addRules: development
      ? rules.map(rule => ({
          ...rule,
          id: rule.id + RULE_ID_OFFSET,
          condition: { ...rule.condition, initiatorDomains: HOSTS }
        }))
      : []
  })

  await ext.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {})
  if (development) {
    await ext.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: HOSTS.map(host => `http://${host}/*`),
      js: ['marker.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
      persistAcrossSessions: true
    }])
  }
}

// Dynamic rules and registered scripts persist, so installs and updates,
// including reloads of unpacked extensions, are the only times to apply them.
ext.runtime.onInstalled.addListener(applyDevelopmentRules)
