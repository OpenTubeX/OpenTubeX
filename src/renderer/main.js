import { createApp } from 'vue'
import i18n from './i18n/index'
import router from './router/index'
import store from './store/index'
import App from './App.vue'
import { showExternalPlayerUnsupportedActionToast, showToast } from './helpers/utils'
import { library } from './fontawesome-minimal'
// import the styles
import '@fortawesome/fontawesome-svg-core/styles.css'

import { register as registerSwiper } from 'swiper/element'

import { ObserveVisibility } from 'vue-observe-visibility'

// Please keep the list of constants sorted by name
// to avoid code conflict and duplicate entries
import {
  faAngleDown,
  faAngleLeft,
  faAngleUp,
  faArrowDown,
  faArrowDownShortWide,
  faArrowDownWideShort,
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faArrowUpRightFromSquare,
  faBars,
  faBarsProgress,
  faBorderAll,
  faBookmark,
  faChartLine,
  faCheck,
  faChevronRight,
  faCircleExclamation,
  faCirclePlay,
  faCircleUser,
  faClapperboard,
  faClosedCaptioning,
  faClock,
  faClockRotateLeft,
  faClone,
  faComment,
  faCopy,
  faDatabase,
  faDisplay,
  faDownload,
  faEdit,
  faEllipsisH,
  faEllipsisV,
  faEnvelope,
  faExchangeAlt,
  faExclamationCircle,
  faExpand,
  faExternalLinkAlt,
  faEye,
  faEyeSlash,
  faFileDownload,
  faFileImage,
  faFileLines,
  faFileVideo,
  faFilm,
  faFilter,
  faFilterCircleXmark,
  faFolderOpen,
  faFlask,
  faFire,
  faForward,
  faGamepad,
  faGauge,
  faGlobe,
  faGrip,
  faHashtag,
  faHeart,
  faHistory,
  faImages,
  faInfoCircle,
  faKey,
  faKeyboard,
  faLanguage,
  faLink,
  faLinkSlash,
  faList,
  faLocationDot,
  faLock,
  faMessage,
  faMoneyCheckDollar,
  faNetworkWired,
  faPalette,
  faPause,
  faPen,
  faPhotoFilm,
  faPlay,
  faPlus,
  faPodcast,
  faPowerOff,
  faQuestionCircle,
  faRandom,
  faRetweet,
  faRss,
  faSatelliteDish,
  faSave,
  faSearch,
  faServer,
  faShareAlt,
  faShield,
  faShieldHalved,
  faSlash,
  faSlidersH,
  faSortAlphaDown,
  faSortAlphaDownAlt,
  faSortDown,
  faStepBackward,
  faStepForward,
  faSync,
  faThumbsDown,
  faThumbsUp,
  faThumbtack,
  faTimes,
  faTimesCircle,
  faTowerBroadcast,
  faTrash,
  faTrophy,
  faUndo,
  faUserCheck,
  faUserLock,
  faUsers,
  faUsersSlash,
  faVideo,
  faVolumeHigh,
  faVolumeLow,
  faVolumeMute,
  faWifi,
  faXmark
} from '@fortawesome/free-solid-svg-icons'
import {
  faBookmark as farBookmark,
  faDotCircle as farDotCircle
} from '@fortawesome/free-regular-svg-icons'
import {
  faBitcoin,
  faGithub,
  faMastodon,
  faMatrix,
  faYoutube,
} from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon, FontAwesomeLayers } from '@fortawesome/vue-fontawesome'

// Please keep the list of constants sorted by name
// to avoid code conflict and duplicate entries
library.add(
  // solid icons
  faAngleDown,
  faAngleLeft,
  faAngleUp,
  faArrowDown,
  faArrowDownShortWide,
  faArrowDownWideShort,
  faArrowLeft,
  faArrowRight,
  faArrowUp,
  faArrowUpRightFromSquare,
  faBars,
  faBarsProgress,
  faBorderAll,
  faBookmark,
  faChartLine,
  faCheck,
  faChevronRight,
  faCircleExclamation,
  faCirclePlay,
  faCircleUser,
  faClapperboard,
  faClosedCaptioning,
  faClock,
  faClockRotateLeft,
  faClone,
  faComment,
  faCopy,
  faDatabase,
  faDisplay,
  faDownload,
  faEdit,
  faEllipsisH,
  faEllipsisV,
  faEnvelope,
  faExchangeAlt,
  faExclamationCircle,
  faExpand,
  faExternalLinkAlt,
  faEye,
  faEyeSlash,
  faFileDownload,
  faFileImage,
  faFileLines,
  faFileVideo,
  faFilm,
  faFilter,
  faFilterCircleXmark,
  faFolderOpen,
  faFlask,
  faFire,
  faForward,
  faGamepad,
  faGauge,
  faGlobe,
  faGrip,
  faHashtag,
  faHeart,
  faHistory,
  faImages,
  faInfoCircle,
  faKey,
  faKeyboard,
  faLanguage,
  faLink,
  faLinkSlash,
  faList,
  faLocationDot,
  faLock,
  faMessage,
  faMoneyCheckDollar,
  faNetworkWired,
  faPalette,
  faPause,
  faPen,
  faPhotoFilm,
  faPlay,
  faPlus,
  faPodcast,
  faPowerOff,
  faQuestionCircle,
  faRandom,
  faRetweet,
  faRss,
  faSatelliteDish,
  faSave,
  faSearch,
  faServer,
  faShareAlt,
  faShield,
  faShieldHalved,
  faSlash,
  faSlidersH,
  faSortAlphaDown,
  faSortAlphaDownAlt,
  faSortDown,
  faStepBackward,
  faStepForward,
  faSync,
  faThumbsDown,
  faThumbsUp,
  faThumbtack,
  faTimes,
  faTimesCircle,
  faTowerBroadcast,
  faTrash,
  faTrophy,
  faUndo,
  faUserCheck,
  faUserLock,
  faUsers,
  faUsersSlash,
  faVideo,
  faVolumeHigh,
  faVolumeLow,
  faVolumeMute,
  faWifi,
  faXmark,

  // solid icons
  farBookmark,
  farDotCircle,

  // brand icons
  faGithub,
  faBitcoin,
  faMastodon,
  faMatrix,
  faYoutube,
)

registerSwiper()

const app = createApp(App)

app.config.performance = process.env.NODE_ENV === 'development'

app
  .component('FontAwesomeIcon', FontAwesomeIcon)
  .component('FontAwesomeLayers', FontAwesomeLayers)
  .directive('observe-visibility', ObserveVisibility)

  .use(router)
  .use(store)
  .use(i18n)

const TAB_ROUTE_LOADING_MIN_MS = 450
const TAB_ROUTE_LOADING_SOURCE = 'route'
const TAB_LOADER_LOADING_SOURCE = 'loader'
const TAB_LOADER_SELECTOR = '[data-tab-loading-indicator]'
const tabLoadingSources = new Set()
let tabRouteLoadingStartedAt = 0
let tabRouteLoadingToken = 0
let tabRouteLoadingTimeoutId = null
let tabLoaderMutationObserver = null

if (process.env.IS_ELECTRON) {
  registerTabRouteLoadingIndicator()
}

router.isReady().then(() => {
  app.mount('#app')
})

// to avoid accessing electron api from web app build
if (process.env.IS_ELECTRON) {
  window.ftElectron.handleChangeView((route) => {
    router.push(route)
  })

  window.ftElectron.handleOpenInExternalPlayerResult(
    (externalPlayer, unsupportedActions, isPlaylist) => {
      for (const action of unsupportedActions) {
        showExternalPlayerUnsupportedActionToast(externalPlayer, action)
      }

      const videoOrPlaylist = isPlaylist
        ? i18n.global.t('Video.External Player.playlist')
        : i18n.global.t('Video.External Player.video')

      showToast(i18n.global.t('Video.External Player.OpeningTemplate', { videoOrPlaylist, externalPlayer }))
    }
  )
}

function registerTabRouteLoadingIndicator() {
  observeTabLoaderIndicators()

  router.beforeEach((to, from) => {
    if (to.fullPath === from.fullPath) {
      return
    }

    startTabRouteLoading()
  })

  router.afterEach((to, from, failure) => {
    if (to.fullPath === from.fullPath && !failure) {
      return
    }

    finishTabRouteLoading()
  })

  router.onError(() => {
    finishTabRouteLoading({ immediate: true })
  })
}

function startTabRouteLoading() {
  tabRouteLoadingToken++
  tabRouteLoadingStartedAt = Date.now()

  if (tabRouteLoadingTimeoutId != null) {
    clearTimeout(tabRouteLoadingTimeoutId)
    tabRouteLoadingTimeoutId = null
  }

  setTabLoadingSource(TAB_ROUTE_LOADING_SOURCE, true)
}

/**
 * @param {{ immediate?: boolean }} [options]
 */
function finishTabRouteLoading(options = {}) {
  const token = tabRouteLoadingToken
  const elapsed = Date.now() - tabRouteLoadingStartedAt
  const delay = options.immediate
    ? 0
    : Math.max(0, TAB_ROUTE_LOADING_MIN_MS - elapsed)

  if (tabRouteLoadingTimeoutId != null) {
    clearTimeout(tabRouteLoadingTimeoutId)
  }

  tabRouteLoadingTimeoutId = window.setTimeout(() => {
    tabRouteLoadingTimeoutId = null
    if (token === tabRouteLoadingToken) {
      setTabLoadingSource(TAB_ROUTE_LOADING_SOURCE, false)
    }
  }, delay)
}

function observeTabLoaderIndicators() {
  if (typeof MutationObserver !== 'function') {
    return
  }

  const startObserver = () => {
    if (!document.body || tabLoaderMutationObserver != null) {
      return
    }

    tabLoaderMutationObserver = new MutationObserver(updateTabLoaderLoading)
    tabLoaderMutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    })
    updateTabLoaderLoading()
  }

  if (document.body) {
    startObserver()
  } else {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true })
  }
}

function updateTabLoaderLoading() {
  setTabLoadingSource(
    TAB_LOADER_LOADING_SOURCE,
    document.querySelector(TAB_LOADER_SELECTOR) != null
  )
}

function setTabLoadingSource(source, isLoading) {
  if (isLoading) {
    tabLoadingSources.add(source)
  } else {
    tabLoadingSources.delete(source)
  }

  setCurrentTabLoading(tabLoadingSources.size > 0)
}

function setCurrentTabLoading(isLoading) {
  if (typeof window.ftElectron?.tabs?.setLoading !== 'function') {
    return
  }

  window.ftElectron.tabs.setLoading(isLoading)
}
