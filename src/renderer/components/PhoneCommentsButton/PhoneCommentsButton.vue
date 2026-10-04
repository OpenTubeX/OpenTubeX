<template>
  <div
    class="phonePanelButton phoneCommentsButton"
    @focusin="focused = true"
    @focusout="focused = $event.currentTarget.contains($event.relatedTarget)"
    @pointerenter="hovered = $event.pointerType === 'mouse'"
    @pointerleave="hovered = false"
  >
    <button
      type="button"
      class="phoneCommentsOpen"
      aria-haspopup="dialog"
      :aria-expanded="panelOpen"
      :aria-label="$t('Comments.Comments')"
      @click="emit('open')"
    >
      <span class="phoneCommentsHeading">
        <FtIcon
          :icon="['fas', 'comment']"
          aria-hidden="true"
        />
        <span class="phoneCommentsTitle">{{ $t('Comments.Comments') }}</span>
        <FtIcon
          :icon="['fas', 'angle-down']"
          aria-hidden="true"
        />
      </span>
      <span
        v-if="currentComment"
        class="phoneCommentPreview"
        aria-hidden="true"
      >
        <Transition name="commentPreview">
          <span
            :key="currentComment.id"
            class="phoneCommentRow"
          >
            <span class="phoneCommentAvatar">
              <FtRetryImage
                v-if="currentComment.authorThumb && (!hideCommentPhotos || currentComment.isOwner)"
                :src="currentComment.authorThumb"
                :fallback-icon="['fas', 'circle-user']"
                class="phoneCommentAvatarImage"
                alt=""
              />
              <span
                v-else
                class="phoneCommentAvatarInitial"
                dir="auto"
              >{{ currentComment.author.replace(/^@/, '').substring(0, 1) }}</span>
            </span>
            <span
              class="phoneCommentExcerpt"
              dir="auto"
            >
              <bdi class="phoneCommentAuthor">{{ currentComment.author }}</bdi>
              {{ currentComment.text }}
            </span>
          </span>
        </Transition>
      </span>
      <span
        v-if="previews.length > 1"
        class="phoneCommentDots"
        aria-hidden="true"
      >
        <span
          v-for="(comment, index) in previews"
          :key="comment.id"
          class="phoneCommentDot"
          :class="{ active: index === currentIndex }"
        />
      </span>
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import store from '../../store'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { useTabContext } from '../../tabs/TabContext'
import FtRetryImage from '../FtRetryImage.vue'

const props = defineProps({
  comments: { type: Array, default: () => [] },
  panelOpen: { type: Boolean, default: false }
})
const emit = defineEmits(['open'])
const previews = computed(() => props.comments.slice(0, 5))
const currentIndex = ref(0)
const currentComment = computed(() => previews.value[currentIndex.value])
const hideCommentPhotos = computed(() => store.getters.getHideCommentPhotos)
const focused = ref(false)
const hovered = ref(false)
const documentVisible = ref(!document.hidden)
const { isTabPresented } = useTabContext()
const systemReducedMotion = usePhoneLayout('(prefers-reduced-motion: reduce)')
const reducedMotion = computed(() => store.getters.getReducedMotion === 'on' ||
  (store.getters.getReducedMotion === 'system' && systemReducedMotion.value))

function updateDocumentVisibility() {
  documentVisible.value = !document.hidden
}
document.addEventListener('visibilitychange', updateDocumentVisibility)

const previewIds = computed(() => previews.value.map(comment => comment.id).join('\n'))
watch(previewIds, () => {
  currentIndex.value = 0
})

watch([previewIds, () => previews.value.length > 1 && !focused.value && !hovered.value &&
  !props.panelOpen && !reducedMotion.value && documentVisible.value && isTabPresented?.value !== false],
([, rotate], _, onCleanup) => {
  if (!rotate) return
  const timer = setInterval(() => {
    currentIndex.value = (currentIndex.value + 1) % previews.value.length
  }, 5000)
  onCleanup(() => clearInterval(timer))
}, { immediate: true })

onBeforeUnmount(() => document.removeEventListener('visibilitychange', updateDocumentVisibility))
</script>

<style scoped src="./PhoneCommentsButton.css" />
