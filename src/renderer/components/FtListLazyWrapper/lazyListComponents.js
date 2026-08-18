import { defineAsyncComponent } from 'vue'

// Video cards dominate most result lists. Keep that common path synchronous,
// while card types used only by particular routes stay out of the initial list
// chunk until data of that type is actually rendered.
export const FtListChannel = defineAsyncComponent(() => import('../FtListChannel/FtListChannel.vue'))
export const FtListPlaylist = defineAsyncComponent(() => import('../FtListPlaylist/FtListPlaylist.vue'))
export const FtCommunityPost = defineAsyncComponent(() => import('../FtCommunityPost/FtCommunityPost.vue'))
export const FtListHashtag = defineAsyncComponent(() => import('../FtListHashtag/FtListHashtag.vue'))
