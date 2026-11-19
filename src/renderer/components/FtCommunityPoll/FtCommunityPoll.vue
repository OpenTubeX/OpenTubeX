<template>
  <div class="poll">
    <div
      class="vote-count"
    >
      {{ $t('Channel.Posts.votes', {votes: formattedVotes}, totalVotes) }}
    </div>
    <div
      v-for="(choice, index) in choices"
      :key="index"
    >
      <component
        :is="isChoosable ? 'button' : 'div'"
        class="option"
        :class="{
          votableOption: isChoosable,
          'correct-option': isQuiz && showAnswers && choice.isCorrect,
          'wrong-option': isQuiz && vote === index && !choice.isCorrect,
          resultOption: getShare(index) !== null,
          votedOption: !isQuiz && vote === index
        }"
        :style="getShare(index) === null ? null : { '--poll-share': `${getShare(index) * 100}%` }"
        :type="isChoosable ? 'button' : undefined"
        :aria-pressed="isChoosable ? vote === index : undefined"
        @click="choose(index)"
      >
        <span class="empty-circle">
          <span
            v-if="vote === index || (isQuiz && showAnswers && choice.isCorrect)"
            class="filled-circle"
          />
        </span>
        <FtRetryImage
          v-if="choice.image"
          class="pollImage"
          :src="choice.image.url"
          :style="{ inlineSize: `${125 * (choice.image.width / choice.image.height || 1)}px` }"
          :fallback-icon="['fas', 'file-image']"
          alt=""
        />
        <div
          class="option-text"
          dir="auto"
        >
          {{ choice.text }}
        </div>
        <span
          v-if="getShare(index) !== null"
          class="optionShare"
        >{{ formatNumber(getShare(index), { style: 'percent' }) }}</span>
      </component>
    </div>
    <!-- Announced when it appears after answering -->
    <div
      v-if="isQuiz"
      aria-live="polite"
    >
      <template v-if="showAnswers && (answeredChoice || explanation)">
        <p
          v-if="answeredChoice"
          class="quizResult"
          :class="answeredChoice.isCorrect ? 'quizResultCorrect' : 'quizResultWrong'"
        >
          <FtIcon
            class="quizResultIcon"
            :icon="['fas', answeredChoice.isCorrect ? 'check' : 'xmark']"
            aria-hidden="true"
          />
          {{ answeredChoice.isCorrect ? $t('Channel.Posts.Correct') : $t('Channel.Posts.Incorrect') }}
        </p>
        <p
          v-if="explanation"
          class="quizExplanation"
          dir="auto"
        >
          {{ explanation }}
        </p>
      </template>
    </div>
    <div
      v-if="isQuiz && vote === null"
      class="reveal-answer option"
      tabindex="0"
      role="button"
      @click="revealAnswer = !revealAnswer"
      @keydown.enter.space.prevent="revealAnswer = !revealAnswer"
    >
      <div
        v-if="!revealAnswer"
        class="option-text"
      >
        <FtIcon :icon="['fas', 'eye']" /> {{ $t('Channel.Posts.Reveal Answers') }}
      </div>
      <div
        v-else
        class="option-text"
      >
        <FtIcon :icon="['fas', 'eye-slash']" /> {{ $t('Channel.Posts.Hide Answers') }}
      </div>
    </div>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { computed, ref } from 'vue'
import { FtIcon } from '@opentubex/icons'

import store from '../../store/index'
import { answerQuiz, getPollResults, getPollVote, togglePollVote } from '../../helpers/postInteractions'
import { formatNumber } from '../../helpers/utils'
import { isRoundedNumber } from '../../helpers/viewCounts'
import { isSignedInToYouTube } from '../../helpers/youtube-account-state'

const props = defineProps({
  data: {
    type: Object,
    required: true
  },
  postId: {
    type: String,
    default: ''
  },
  // The post's channel, which voting needs.
  authorId: {
    type: String,
    default: ''
  }
})

const isQuiz = computed(() => props.data.type === 'quiz')

// The signed-in YouTube account can vote in polls and answer quizzes.
const canVote = computed(() => props.postId !== '' && props.authorId !== '' && isSignedInToYouTube(store.getters))
const vote = computed(() => canVote.value ? getPollVote(props.postId) : null)
// Votes can move, but answers are final, like on YouTube.
const isChoosable = computed(() => canVote.value && (!isQuiz.value || vote.value === null))

const totalVotes = computed(() => (props.data.totalVotes ?? 0) + (vote.value === null ? 0 : 1))

const formattedVotes = computed(() => {
  const votes = totalVotes.value
  return formatNumber(votes, isRoundedNumber(props.data.totalVotes ?? 0) ? { notation: 'compact' } : undefined)
})

const revealAnswer = ref(false)
const showAnswers = computed(() => revealAnswer.value || vote.value !== null)

const results = computed(() => {
  if (isQuiz.value || vote.value === null) return null
  const loaded = getPollResults(props.postId)
  return loaded?.length === props.data.content.length ? loaded : null
})

/**
 * The share of the votes a choice has with the account's vote, shown once it voted, like on YouTube.
 * @param {number} index
 */
function getShare(index) {
  const result = results.value?.[index]
  if (!result) return null
  return index === vote.value ? result.selected.ratio : result.unselected.ratio
}

const answeredChoice = computed(() => isQuiz.value && vote.value !== null ? props.data.content[vote.value] ?? null : null)
// The answer's explanation, or the correct answer's when revealed.
const explanation = computed(() => (answeredChoice.value ?? props.data.content.find(choice => choice.isCorrect))?.explanation ?? null)

/** @param {number} index */
function choose(index) {
  if (!isChoosable.value) return
  if (isQuiz.value) {
    answerQuiz(props.postId, props.authorId, index, !!props.data.content[index].isCorrect)
  } else {
    togglePollVote(props.postId, props.authorId, index)
  }
}

const choices = computed(() => props.data.content.map(choice => ({
  ...choice,
  image: choice.image ? findSmallestPollImage(choice.image) : null
})))

/**
 * Use smallest as it's resized to 125px anyways and they're usually all larger than that
 * @param {{ height: number, width: number, url: string }[]} images
 */
function findSmallestPollImage(images) {
  return images.reduce((prev, img) => (img.height < prev.height) ? img : prev, images[0])
}
</script>

<style scoped src="./FtCommunityPoll.css" />
