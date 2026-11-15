import { defineAsyncComponent } from 'vue'

// The prompt opens only on request. Every caller shares this one chunk, so the
// prompt stays out of the startup bundle without a copy in each route chunk.
export default defineAsyncComponent(() => import('./WatchVideoDownloadPrompt.vue'))
