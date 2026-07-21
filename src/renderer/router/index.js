import { defineAsyncComponent } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
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
const Watch = defineAsyncComponent(() => import('../views/Watch/Watch.vue'))
const Settings = defineAsyncComponent(() => import('../views/Settings/Settings.vue'))
const ProfileSettings = defineAsyncComponent(() => import('../views/ProfileSettings/ProfileSettings.vue'))
const About = defineAsyncComponent(() => import('../views/About/About.vue'))
const Stats = defineAsyncComponent(() => import('../views/Stats/Stats.vue'))

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
      title: 'Subscriptions',
      hasResizableThumbnails: true
    },
    component: Subscriptions
  },
  {
    path: '/subscribedchannels',
    name: 'subscribedChannels',
    meta: {
      title: 'Channels'
    },
    component: SubscribedChannels
  },
  ...(process.env.SUPPORTS_LOCAL_API
    ? [{
        path: '/trending',
        name: 'trending',
        meta: {
          title: 'Trending',
          hasResizableThumbnails: true
        },
        component: Trending
      }]
    : []),
  {
    path: '/popular',
    name: 'popular',
    meta: {
      title: 'Most Popular',
      hasResizableThumbnails: true
    },
    component: Popular
  },
  {
    path: '/userplaylists',
    name: 'userPlaylists',
    meta: {
      title: 'Your Playlists',
      hasResizableThumbnails: true
    },
    component: UserPlaylists
  },
  {
    path: '/history',
    name: 'history',
    meta: {
      title: 'History',
      hasResizableThumbnails: true
    },
    component: History
  },
  {
    path: '/stats',
    name: 'stats',
    meta: {
      title: 'Stats'
    },
    component: Stats
  },
  {
    path: '/settings',
    name: 'settings',
    meta: {
      title: 'Settings'
    },
    component: Settings
  },
  {
    path: '/about',
    name: 'about',
    meta: {
      title: 'About'
    },
    component: About
  },
  {
    path: '/settings/profile',
    name: 'profileSettings',
    meta: {
      title: 'Profile Settings'
    },
    component: ProfileSettings
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
      title: 'Watch'
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
