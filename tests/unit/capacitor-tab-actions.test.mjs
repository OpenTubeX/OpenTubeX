import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, ref, watch } from 'vue'

const source = (await readFile(new URL('../../src/renderer/components/TabBar/useCapacitorTabActions.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace('export function', 'function')

function setup(t) {
  const tabs = ref([
    { id: 'pinned', isPinned: true },
    { id: 'first' },
    { id: 'middle' },
    { id: 'last' },
  ])
  const calls = []
  const service = {
    async createTab() {
      calls.push(['create'])
      tabs.value = [...tabs.value, { id: 'landing' }]
      return 'landing'
    },
    async closeTab(id) {
      calls.push(['close', id])
      tabs.value = tabs.value.filter(tab => tab.id !== id)
      return true
    },
    async activateTab(id) { calls.push(['activate', id]) },
  }
  const context = vm.createContext({
    computed, ref, watch,
    useI18n: () => ({ t: key => key }),
    getCapacitorTabService: () => service,
  })
  vm.runInContext(source, context)
  const scope = effectScope()
  t.after(() => scope.stop())
  const actions = scope.run(() => context.useCapacitorTabActions({
    tabs,
    requestExit: () => calls.push(['exit']),
    afterClose: () => calls.push(['afterClose']),
  }))
  return { tabs, calls, actions, service }
}

test('selecting the context tab reveals selection and tapping toggles without activating', async t => {
  const { actions, calls } = setup(t)
  actions.openTabActions('middle')
  actions.selectActionTab()
  assert.equal(actions.selecting.value, true)
  assert.equal(actions.actionTab.value, null)
  assert.deepEqual([...actions.selectedTabIds.value], ['middle'])
  await actions.activateTab('first')
  await actions.activateTab('middle')
  assert.deepEqual([...actions.selectedTabIds.value], ['first'])
  assert.deepEqual(calls, [])
  actions.clearSelection()
  assert.equal(actions.selecting.value, false)
  await actions.activateTab('last')
  assert.deepEqual(calls, [['activate', 'last']])
})

for (const [position, expected] of [
  ['before', ['first']],
  ['after', ['last']],
  ['other', ['first', 'last']],
]) {
  test(`close ${position} preserves pinned and context tabs`, async t => {
    const { actions, tabs, calls } = setup(t)
    actions.openTabActions('middle')
    await actions.closeRelatedTabs(position)
    assert.deepEqual(calls.filter(call => call[0] === 'close').map(call => call[1]), expected)
    assert.ok(tabs.value.some(tab => tab.id === 'pinned'))
    assert.ok(tabs.value.some(tab => tab.id === 'middle'))
    assert.equal(actions.actionTab.value, null)
  })
}

test('relative actions follow current order and disable empty ranges', async t => {
  const { actions, tabs } = setup(t)
  tabs.value = [tabs.value[0], tabs.value[3], tabs.value[2], tabs.value[1]]
  actions.openTabActions('last')
  assert.deepEqual([...actions.relatedTabIds.value.before], [])
  assert.deepEqual([...actions.relatedTabIds.value.after], ['middle', 'first'])
  actions.openTabActions('missing')
  assert.deepEqual([...actions.relatedTabIds.value.other], [])
})

test('close selection closes exactly the selected tabs and clears selection', async t => {
  const { actions, tabs, calls } = setup(t)
  actions.openTabActions('first')
  actions.selectActionTab()
  actions.toggleTabSelection('last')
  await actions.closeSelectedTabs()
  assert.deepEqual(tabs.value.map(tab => tab.id), ['pinned', 'middle'])
  assert.deepEqual(calls, [['close', 'first'], ['close', 'last'], ['afterClose']])
  assert.equal(actions.selecting.value, false)
})

test('closing every selected tab leaves a fresh landing tab instead of exiting', async t => {
  const { actions, tabs, calls } = setup(t)
  tabs.value.forEach(tab => actions.toggleTabSelection(tab.id))
  await actions.closeSelectedTabs()
  assert.deepEqual(calls, [
    ['create'], ['close', 'pinned'], ['close', 'first'],
    ['close', 'middle'], ['close', 'last'], ['afterClose'],
  ])
  assert.deepEqual(tabs.value.map(tab => tab.id), ['landing'])
})

test('removed tabs are pruned from selection', async t => {
  const { actions, tabs } = setup(t)
  actions.toggleTabSelection('first')
  tabs.value = tabs.value.filter(tab => tab.id !== 'first')
  await nextTick()
  assert.equal(actions.selectedTabIds.value.size, 0)
})

test('a refused close keeps the remaining selection available for retry', async t => {
  const { actions, service, tabs, calls } = setup(t)
  actions.openTabActions('first')
  actions.selectActionTab()
  actions.toggleTabSelection('middle')
  const close = service.closeTab
  service.closeTab = async id => id === 'middle' ? false : close(id)
  await actions.closeSelectedTabs()
  await nextTick()
  assert.deepEqual(tabs.value.map(tab => tab.id), ['pinned', 'middle', 'last'])
  assert.equal(actions.selecting.value, true)
  assert.deepEqual([...actions.selectedTabIds.value], ['middle'])
  assert.equal(actions.closingTabs.value, false)
  assert.deepEqual(calls, [['close', 'first']])
})

test('failed closure stops the batch and always releases the busy state', async t => {
  const { actions, service } = setup(t)
  service.closeTab = async () => { throw new Error('navigation failed') }
  actions.openTabActions('middle')
  await assert.rejects(actions.closeRelatedTabs('other'), /navigation failed/)
  assert.equal(actions.closingTabs.value, false)
})


test('tablet selection arrows move focus without toggling or activating tabs', async () => {
  const component = await readFile(new URL('../../src/renderer/components/TabBar/CapacitorTabletTabBar.vue', import.meta.url), 'utf8')
  const start = component.indexOf('function handleTabListKeydown(')
  const method = component.slice(start, component.indexOf('async function focusActiveTab', start))
  const focused = []
  const targets = ['first', 'middle', 'last'].map(id => ({
    dataset: { tabId: id },
    focus() { focused.push(id) },
  }))
  const context = vm.createContext({
    selecting: { value: true },
    tabs: { value: targets.map(target => ({ id: target.dataset.tabId })) },
    activeTabId: { value: 'first' },
    tabsViewportRef: { value: { querySelectorAll: () => targets } },
    activateTab() { throw new Error('Arrow keys must not toggle selection') },
  })
  vm.runInContext(method, context)
  for (const [key, current, expected] of [
    ['ArrowRight', 0, 'middle'], ['ArrowRight', 1, 'last'],
    ['Home', 2, 'first'], ['End', 0, 'last'],
  ]) {
    context.handleTabListKeydown({
      key,
      target: { closest: () => ({ querySelector: () => targets[current] }) },
      preventDefault() {},
    })
    assert.equal(focused.at(-1), expected)
  }
})

test('an unavailable close submenu keeps keyboard focus on its Back button', async () => {
  const component = await readFile(new URL('../../src/renderer/components/TabBar/CapacitorTabActionsMenu.vue', import.meta.url), 'utf8')
  const start = component.indexOf('async function setCloseMenu(')
  const method = component.slice(start, component.indexOf('watch(() => props.tab', start))
  let focused = false
  const context = vm.createContext({
    showCloseMenu: { value: false },
    mainScrollTop: 0,
    actionList: { value: { scrollTop: 24, querySelector: () => null } },
    actionContent: { value: {} },
    closeMenuTrigger: { value: null },
    submenuBack: { value: { focus() { focused = true } } },
    nextTick: async () => {},
    restoreOverlayScrollTop() {},
    clampOverlayScrollTop() {},
  })
  vm.runInContext(method, context)
  await context.setCloseMenu(true)
  assert.equal(focused, true)
})
