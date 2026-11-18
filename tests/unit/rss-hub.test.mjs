import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRssHubFeedUrl,
  normalizeRssHubInstance,
  parseRssHubInstanceList,
  parseRssHubNamespaces
} from '../../src/renderer/helpers/rssHub.js'

test('reads the public instances from the documentation component', () => {
  const source = `<script setup lang="ts">
const instances = [
  {
    url: 'https://rsshub.one.example',
    location: '🇩🇪',
    maintainer: 'One',
    maintainerUrl: 'https://one.example',
  },
  {
    url: 'https://two.example/rsshub/',
    location: '🇺🇸',
  },
  { url: 'https://rsshub.one.example', location: '🇩🇪' },
  { url: 'ftp://invalid.example', location: '' },
];
const getHost = (url: string) => new URL(url).host;
</script>`
  assert.deepEqual(parseRssHubInstanceList(source), [
    { url: 'https://rsshub.one.example', location: '🇩🇪' },
    { url: 'https://two.example/rsshub', location: '🇺🇸' }
  ])
})

test('accepts instance hosts without a scheme and keeps their path', () => {
  assert.equal(normalizeRssHubInstance(' rsshub.example.com/ '), 'https://rsshub.example.com')
  assert.equal(normalizeRssHubInstance('http://192.168.1.2:1200/'), 'http://192.168.1.2:1200')
  assert.equal(normalizeRssHubInstance('https://example.com/rsshub/?a=1'), 'https://example.com/rsshub')
  assert.equal(normalizeRssHubInstance('ftp://example.com'), null)
  assert.equal(normalizeRssHubInstance('https://user:pass@example.com'), null)
  assert.equal(normalizeRssHubInstance(''), null)
})

const namespaces = {
  twitch: {
    name: 'Twitch',
    url: 'www.twitch.tv',
    routes: {
      '/live/:login': {
        name: 'Live',
        example: '/twitch/live/riotgames',
        parameters: { login: 'Twitch username' },
        features: { requireConfig: false }
      },
      '/video/:login/:filter?': {
        name: 'Channel Video',
        example: '/twitch/video/riotgames/highlights',
        parameters: {
          login: 'Twitch username',
          filter: {
            description: 'Video type',
            options: [{ value: 'archive', label: 'Archive' }, { value: 'all', label: 'All' }],
            default: 'all'
          }
        }
      }
    }
  },
  aaa: {
    name: 'Alpha',
    routes: {
      '/a/:id/:sort?/:page?': {
        name: 'List',
        parameters: { id: 'ID', sort: 'Sort order', page: 'Page' },
        features: { requireConfig: [{ name: 'KEY', optional: true }] }
      },
      '/b/:path{.+}': {
        name: 'List',
        parameters: { path: 'Path' },
        features: { requireConfig: [{ name: 'KEY' }] }
      }
    }
  },
  empty: { name: 'Empty', routes: {} }
}

test('lists the services of an instance by name', () => {
  const services = parseRssHubNamespaces(namespaces)
  assert.deepEqual(services.map(service => service.id), ['aaa', 'twitch'])

  const [alpha, twitch] = services
  assert.deepEqual(alpha.routes.map(route => [route.name, route.requiresConfig]), [
    ['List (/a/:id/:sort?/:page?)', false],
    ['List (/b/:path{.+})', true]
  ])
  assert.deepEqual(twitch.routes[1].parameters, [
    { name: 'login', description: 'Twitch username', options: [], default: '', optional: false, allowsSlashes: false, example: 'riotgames' },
    {
      name: 'filter',
      description: 'Video type',
      options: [{ value: 'archive', label: 'Archive' }, { value: 'all', label: 'All' }],
      default: 'all',
      optional: true,
      allowsSlashes: false,
      example: 'highlights'
    }
  ])
})

test('builds feed addresses from the route parameters', () => {
  const [alpha, twitch] = parseRssHubNamespaces(namespaces)
  const instance = 'https://rsshub.example/sub'

  assert.deepEqual(buildRssHubFeedUrl(instance, 'twitch', twitch.routes[1], { login: ' Some One ' }),
    { url: 'https://rsshub.example/sub/twitch/video/Some%20One', missing: [] })
  assert.deepEqual(buildRssHubFeedUrl(instance, 'twitch', twitch.routes[1], { login: 'Some One', filter: 'all' }),
    { url: 'https://rsshub.example/sub/twitch/video/Some%20One', missing: [] })
  assert.deepEqual(buildRssHubFeedUrl(instance, 'twitch', twitch.routes[1], { login: 'a/b', filter: 'archive' }),
    { url: 'https://rsshub.example/sub/twitch/video/a%2Fb/archive', missing: [] })
  assert.deepEqual(buildRssHubFeedUrl(instance, 'twitch', twitch.routes[1], { filter: 'archive' }),
    { url: null, missing: ['login'] })

  // An optional parameter before a filled one can't be left out
  assert.deepEqual(buildRssHubFeedUrl(instance, 'aaa', alpha.routes[0], { id: '1', page: '2' }),
    { url: null, missing: ['sort'] })
  assert.deepEqual(buildRssHubFeedUrl(instance, 'aaa', alpha.routes[0], { id: '1', sort: 'new', page: '2' }),
    { url: 'https://rsshub.example/sub/aaa/a/1/new/2', missing: [] })
  assert.deepEqual(buildRssHubFeedUrl(instance, 'aaa', alpha.routes[1], { path: 'x/y z' }),
    { url: 'https://rsshub.example/sub/aaa/b/x/y%20z', missing: [] })
})
