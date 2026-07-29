import { createApp } from 'vue'
import i18n from './i18n/index'
import router from './router/index'
import store from './store/index'
import App from './App.vue'
import { initializeTabNavigationService } from './tabs/TabNavigationService'
import { showExternalPlayerUnsupportedActionToast, showToast } from './helpers/utils'
import { installViewTransitions } from './helpers/viewTransitions'
import { library } from './fontawesome-minimal'
import {
  facHorizontalTabs,
  facPlaylistAdd,
  facPlaylistCheck,
  facVerticalTabs
} from './customIcons'
import { initializeAppScrollbars, overlayScrollbarsDirective } from './helpers/overlayScrollbars'
// import the styles
import '@fortawesome/fontawesome-svg-core/styles.css'
import 'overlayscrollbars/styles/overlayscrollbars.css'

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
  faBullhorn,
  faCalendarDays,
  faChartLine,
  faCheck,
  faChevronRight,
  faCircle,
  faCircleExclamation,
  faCirclePlay,
  faCircleUser,
  faClapperboard,
  faClosedCaptioning,
  faClock,
  faClockRotateLeft,
  faClone,
  faComment,
  faCompress,
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
  faForwardFast,
  faGamepad,
  faGauge,
  faGaugeHigh,
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
  faPaste,
  faPen,
  faPhotoFilm,
  faPlay,
  faPlus,
  faPodcast,
  faPowerOff,
  faQuestionCircle,
  faRandom,
  faRectangleAd,
  faRectangleXmark,
  faRetweet,
  faRightFromBracket,
  faRightToBracket,
  faRss,
  faSatelliteDish,
  faSave,
  faScissors,
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
  faThumbtackSlash,
  faTicket,
  faTimes,
  faTimesCircle,
  faTowerBroadcast,
  faTrash,
  faTriangleExclamation,
  faTrophy,
  faUndo,
  faUserCheck,
  faUserLock,
  faUserPlus,
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
  faBullhorn,
  faCalendarDays,
  faChartLine,
  faCheck,
  faChevronRight,
  faCircle,
  faCircleExclamation,
  faCirclePlay,
  faCircleUser,
  faClapperboard,
  faClosedCaptioning,
  faClock,
  faClockRotateLeft,
  faClone,
  faComment,
  faCompress,
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
  faForwardFast,
  faGamepad,
  faGauge,
  faGaugeHigh,
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
  faPaste,
  faPen,
  faPhotoFilm,
  faPlay,
  faPlus,
  faPodcast,
  faPowerOff,
  faQuestionCircle,
  faRandom,
  faRectangleAd,
  faRectangleXmark,
  faRetweet,
  faRightFromBracket,
  faRightToBracket,
  faRss,
  faSatelliteDish,
  faSave,
  faScissors,
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
  faThumbtackSlash,
  faTicket,
  faTimes,
  faTimesCircle,
  faTowerBroadcast,
  faTrash,
  faTriangleExclamation,
  faTrophy,
  faUndo,
  faUserCheck,
  faUserLock,
  faUserPlus,
  faUsers,
  faUsersSlash,
  faVideo,
  faVolumeHigh,
  faVolumeLow,
  faVolumeMute,
  faWifi,
  faXmark,

  // regular icons
  farBookmark,
  farDotCircle,

  // brand icons
  faGithub,
  faBitcoin,
  faMastodon,
  faMatrix,
  faYoutube,

  // custom icons
  facHorizontalTabs,
  facPlaylistAdd,
  facPlaylistCheck,
  facVerticalTabs,
)

registerSwiper()

const app = createApp(App)

app.config.performance = process.env.NODE_ENV === 'development'

app
  .component('FontAwesomeIcon', FontAwesomeIcon)
  .component('FontAwesomeLayers', FontAwesomeLayers)
  .directive('observe-visibility', ObserveVisibility)
  .directive('overlay-scrollbars', overlayScrollbarsDirective)

  .use(router)
  .use(store)
  .use(i18n)

installViewTransitions(router)

const tabNavigation = initializeTabNavigationService(router, store)

router.isReady().then(() => {
  app.mount('#app')
  initializeAppScrollbars()
})

// to avoid accessing electron api from web app build
if (process.env.IS_ELECTRON) {
  window.ftElectron.handleChangeView((route, tabId) => {
    const targetTabId = tabId ?? store.getters.getActiveTabId
    if (route && targetTabId) {
      tabNavigation.push(targetTabId, route)
    }
  })

  window.ftElectron.tabs.onGoHistory(({ tabId, offset }) => {
    tabNavigation.go(tabId, offset)
  })

  window.ftElectron.handleOpenInExternalPlayerResult(
    (externalPlayer, unsupportedActions, isPlaylist) => {
      for (const action of unsupportedActions) {
        showExternalPlayerUnsupportedActionToast(externalPlayer, action)
      }

      const videoOrPlaylist = isPlaylist
        ? i18n.global.t('Video.External Player.playlist')
        : i18n.global.t('Video.External Player.video')

      showToast({
        message: i18n.global.t('Video.External Player.OpeningTemplate', { videoOrPlaylist, externalPlayer }),
        icon: ['fas', 'external-link-alt'],
      })
    }
  )

  window.ftElectron.handleYtDlpDownloadStatus((download) => {
    store.commit('upsertYtDlpDownload', download)

    if (download.status === 'completed') {
      showToast({
        message: i18n.global.t('Downloads.Download Complete Template', { title: download.title }),
        icon: ['fas', 'download'],
      })
    } else if (download.status === 'failed') {
      showToast({
        message: download.errorMessage === 'ENOENT'
          ? i18n.global.t('Downloads.yt-dlp Not Found')
          : i18n.global.t('Downloads.Download Failed Template', { title: download.title }),
        icon: ['fas', 'circle-exclamation'],
      })
    }
  })
}
