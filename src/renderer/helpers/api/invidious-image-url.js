import store from '../../store/index'
import { createInvidiousFeedParsers } from './invidious-feed-parsers'

const { youtubeImageUrlToInvidious } = createInvidiousFeedParsers(
  () => store.getters.getApiServerUrl,
  () => store.getters.getBackendPreference !== 'yattee'
)

export { youtubeImageUrlToInvidious }
