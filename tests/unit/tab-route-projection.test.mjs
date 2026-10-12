import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/renderer/tabs/TabNavigationService.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export default .*$/gm, '')
  .replace(/^export /gm, '')
const Service = vm.runInNewContext(`${source}; TabNavigationService`, { START_LOCATION: {} })

test('route presentation markers follow the current projection and clear after failures', async () => {
  const pending = new Map()
  let projectionStarted
  const router = {
    currentRoute: { value: { fullPath: '/subscriptions' } },
    isReady: async () => {},
    resolve: route => ({ ...route, fullPath: route.path }),
    replace: route => new Promise((resolve, reject) => {
      pending.set(route.path, { resolve, reject })
      projectionStarted()
    })
  }
  const navigation = new Service(router, {})
  async function beginProjection(route, options) {
    const started = new Promise(resolve => { projectionStarted = resolve })
    const completion = navigation.projectRoute(route, options)
    await started
    return { completion }
  }
  const presentation = await beginProjection({ path: '/history' }, { tabPresentation: true })
  assert.equal(navigation.isPresentingRoute('/history'), true)
  assert.equal(navigation.isPresentingRoute('/subscriptions'), false)

  // Ordinary navigation can supersede a slow presentation's route projection.
  const normalNavigation = await beginProjection({ path: '/userplaylists' })
  assert.equal(navigation.isPresentingRoute('/userplaylists'), false)
  assert.equal(navigation.isPresentingRoute('/history'), false)

  pending.get('/history').resolve()
  await presentation.completion
  assert.equal(navigation.routeProjection.fullPath, '/userplaylists')
  pending.get('/userplaylists').resolve()
  await normalNavigation.completion
  assert.equal(navigation.routeProjection, null)

  const rejectedPresentation = await beginProjection({ path: '/history' }, { tabPresentation: true })
  assert.equal(navigation.isPresentingRoute('/history'), true)
  pending.get('/history').reject(new Error('Route projection rejected'))
  await assert.rejects(rejectedPresentation.completion, /Route projection rejected/)
  assert.equal(navigation.isPresentingRoute('/history'), false)
})
