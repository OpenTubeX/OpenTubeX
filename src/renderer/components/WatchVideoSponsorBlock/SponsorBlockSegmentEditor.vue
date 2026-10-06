<template>
  <div
    class="sponsorBlockEditActions"
    :class="{ centerWrappedCancel }"
  >
    <FtSelect
      v-if="choosingCategory"
      class="sponsorBlockCategorySelect"
      variant="outlined"
      :placeholder="$t('Video.Player.SponsorBlock.CategoryLabel')"
      :value="categoryVoteValue"
      :select-values="categoryOptions"
      :select-names="categoryNames"
      :show-icon="false"
      :disabled="pending"
      @change="categoryVoteValue = $event"
    />
    <div class="sponsorBlockPrimaryActions">
      <FtButton
        v-if="choosingCategory"
        type="button"
        size="extra-small"
        :icon="['fas', 'check']"
        :label="$t('Video.Player.SponsorBlock.SubmitCategoryVote')"
        :disabled="pending || categoryVoteValue === segment.category"
        @click="$emit('category-vote', segment.uuid, categoryVoteValue)"
      />
      <FtButton
        v-else-if="categoryOptions.length > 1"
        type="button"
        size="extra-small"
        :icon="['fas', 'list']"
        :label="$t('Video.Player.SponsorBlock.ChangeCategory')"
        :disabled="pending"
        @click="openCategoryVote"
      />
      <FtButton
        type="button"
        size="extra-small"
        :icon="['fas', 'copy']"
        :label="$t('Video.Player.SponsorBlock.CopyAndDownvote')"
        :disabled="pending"
        @click="$emit('copy-and-downvote', segment.uuid)"
      />
    </div>
    <FtButton
      v-if="choosingCategory"
      class="sponsorBlockCancelButton"
      type="button"
      variant="outlined"
      size="extra-small"
      :icon="['fas', 'xmark']"
      :label="$t('Cancel')"
      :disabled="pending"
      @click="choosingCategory = false"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import { getSponsorBlockCategoryVoteOptions } from '../../helpers/player/sponsorBlockCategories'
import { translateSponsorBlockCategory } from '../../helpers/player/utils'

const props = defineProps({
  segment: { type: Object, required: true },
  pending: Boolean,
  centerWrappedCancel: Boolean
})
const emit = defineEmits(['category-vote', 'copy-and-downvote', 'resize'])
const choosingCategory = ref(false)
const categoryVoteValue = ref(props.segment.category)
const categoryOptions = computed(() => getSponsorBlockCategoryVoteOptions(props.segment.actionType))
const categoryNames = computed(() => categoryOptions.value.map(category => translateSponsorBlockCategory(category, { short: false })))

watch(choosingCategory, () => emit('resize'))

function openCategoryVote() {
  categoryVoteValue.value = props.segment.category
  choosingCategory.value = true
}
</script>

<style scoped>
.sponsorBlockEditActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-block: 4px;
  padding-inline: 8px;
}

.sponsorBlockCategorySelect {
  flex: 1 1 100%;
  min-inline-size: 0;
  margin-block: 4px 0;
}

.sponsorBlockPrimaryActions {
  display: contents;
}

.centerWrappedCancel .sponsorBlockPrimaryActions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 8px;
  min-inline-size: 0;
  max-inline-size: 100%;
}

.sponsorBlockEditActions :deep(.btn) {
  max-inline-size: 100%;
  margin: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

.sponsorBlockEditActions :deep(.sponsorBlockCancelButton) {
  margin-inline-start: auto;
}

.centerWrappedCancel :deep(.sponsorBlockCancelButton) {
  margin-inline: auto;
}
</style>
