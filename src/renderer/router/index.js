import { defineAsyncComponent, h, markRaw, shallowRef } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { getFixedInternalRouteTitle } from '../../internalRoutes'
import Subscriptions from '../views/Subscriptions/Subscriptions.vue'
import SubscribedChannels from '../views/SubscribedChannels/SubscribedChannels.vue'
import Trending from '../views/Trending/Trending.vue'
import Popular from '../views/Popular/Popular.vue'
import UserPlaylists from '../views/UserPlaylists/UserPlaylists.vue'
import History from '../views/History/History.vue'
import SearchPage from '../views/SearchPage/SearchPage.vue'
import Playlist from '../views/Playlist/Playlist.vue'
import Channel from '../views/Channel/Channel.vue'
import Hashtag from '../views/Hashtag/Hashtag.vue'
import Post from '../views/Post.vue'

// Loaded lazily to keep the startup bundle small, most notably the Watch view
// pulls in shaka-player and googlevideo.
// The tab system renders route components directly via `resolveRouteComponent`
// instead of `RouterView` resolving them during navigation, so they must be
// wrapped in `defineAsyncComponent` rather than passing the raw import function
// to `component`.
const AsyncRouteLoadingIndicator = {
  render: () => h('span', {
    hidden: true,
    'data-tab-loading-indicator': ''
  })
}
const Watch = defineAsyncComponent({
  loader: () => import('../views/Watch/Watch.vue'),
  loadingComponent: AsyncRouteLoadingIndicator,
  delay: 0
})

function createPreloadedRoute(name, loader) {
  const loadedComponent = shallowRef(defineAsyncComponent(loader))

  return {
    component: {
      name,
      setup: () => () => h(loadedComponent.value)
    },
    preload: () => loader().then(({ default: component }) => {
      loadedComponent.value = markRaw(component)
    }).catch((error) => {
      console.error(`Failed to preload ${name}`, error)
    })
  }
}

const settingsWindowRoute = createPreloadedRoute('SettingsWindowRoute', () => import('../views/Settings/Settings.vue'))
const aboutRoute = createPreloadedRoute('AboutRoute', () => import('../views/About/About.vue'))
const SettingsRoute = defineAsyncComponent(() => import('../views/Settings/SettingsRoute.vue'))
const About = aboutRoute.component
const Stats = defineAsyncComponent(() => import('../views/Stats/Stats.vue'))

// Keep Settings in its own chunk so its styles retain their established load
// order, but allow the app to evaluate it before the UI can be interacted with.
// Otherwise the first Settings navigation has to wait for this large chunk.
export function preloadUtilityRoutes() {
  return Promise.all([settingsWindowRoute.preload(), aboutRoute.preload()])
}

export const routes = [
  {
    path: '/',
    name: 'default',
    meta: {
      title: 'Subscriptions',
      hasResizableThumbnails: true
    },
    component: Subscriptions
  },
  {
    path: '/subscriptions',
    name: 'subscriptions',
    meta: {
      title: getFixedInternalRouteTitle('/subscriptions'),
      hasResizableThumbnails: true
    },
    component: Subscriptions
  },
  {
    path: '/subscribedchannels',
    name: 'subscribedChannels',
    meta: {
      title: getFixedInternalRouteTitle('/subscribedchannels')
    },
    component: SubscribedChannels
  },
  ...(process.env.SUPPORTS_LOCAL_API
    ? [{
        path: '/trending',
        name: 'trending',
        meta: {
          title: getFixedInternalRouteTitle('/trending'),
          hasResizableThumbnails: true
        },
        component: Trending
      }]
    : []),
  {
    path: '/popular',
    name: 'popular',
    meta: {
      title: getFixedInternalRouteTitle('/popular'),
      hasResizableThumbnails: true
    },
    component: Popular
  },
  {
    path: '/userplaylists',
    name: 'userPlaylists',
    meta: {
      title: getFixedInternalRouteTitle('/userplaylists'),
      hasResizableThumbnails: true
    },
    component: UserPlaylists
  },
  {
    path: '/history',
    name: 'history',
    meta: {
      title: getFixedInternalRouteTitle('/history'),
      hasResizableThumbnails: true
    },
    component: History
  },
  {
    path: '/stats',
    name: 'stats',
    meta: {
      title: getFixedInternalRouteTitle('/stats')
    },
    component: Stats
  },
  {
    path: '/settings',
    name: 'settings',
    meta: {
      title: getFixedInternalRouteTitle('/settings')
    },
    component: SettingsRoute
  },
  {
    path: '/about',
    name: 'about',
    meta: {
      title: getFixedInternalRouteTitle('/about')
    },
    component: About
  },
  {
    path: '/settings/profile',
    name: 'profileSettings',
    meta: {
      title: getFixedInternalRouteTitle('/settings/profile')
    },
    component: SettingsRoute
  },
  {
    path: '/search/:query',
    meta: {
      title: 'Search Results',
      hasResizableThumbnails: true
    },
    component: SearchPage
  },
  {
    path: '/playlist/:id',
    meta: {
      title: 'Playlist',
      hasDynamicTitle: true,
      hasResizableThumbnails: true
    },
    component: Playlist
  },
  {
    path: '/channel/:id/:currentTab?',
    meta: {
      title: 'Channel',
      hasResizableThumbnails: true
    },
    component: Channel
  },
  {
    path: '/watch/:id',
    meta: {
      title: 'Watch',
      hasDynamicTitle: true
    },
    component: Watch
  },
  {
    path: '/hashtag/:hashtag',
    meta: {
      title: 'Hashtag',
      hasResizableThumbnails: true
    },
    component: Hashtag
  },
  {
    path: '/post/:id',
    meta: {
      title: 'Post',
    },
    component: Post
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (process.env.IS_ELECTRON) {
      return false
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        if (savedPosition !== null) {
          resolve(savedPosition)
        } else {
          resolve({ left: 0, top: 0 })
        }
      }, 500)
    })
  }
})

export function resolveRouteComponent(resolvedRoute) {
  return resolvedRoute.matched.at(-1)?.components?.default ?? null
}

export default router
