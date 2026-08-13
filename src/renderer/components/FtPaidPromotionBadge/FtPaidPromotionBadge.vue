<template>
  <button
    type="button"
    class="paidPromotionBadge"
    @click.stop="openPaidPromotionHelp"
    @dblclick.stop
  >
    <ft-icon
      :icon="['fas', 'money-check-dollar']"
      class="paidPromotionIcon"
      aria-hidden="true"
    />
    <span>{{ $t('Video.Includes paid promotion') }}</span>
    <ft-icon
      :icon="['fas', 'chevron-right']"
      class="paidPromotionChevron"
      aria-hidden="true"
    />
  </button>
</template>

<script setup>
import { openExternalLink } from '../../helpers/utils'

const PAID_PROMOTION_HELP_URL = 'https://support.google.com/youtube?p=ppp&nohelpkit=1'

function openPaidPromotionHelp() {
  openExternalLink(PAID_PROMOTION_HELP_URL)
}
</script>

<style scoped>
.paidPromotionBadge {
  display: flex;
  align-items: center;
  gap: 7px;
  min-block-size: 38px;
  padding-block: 7px;
  padding-inline: 9px 7px;
  border: 0;
  border-inline-start: 4px solid #3ea6ff;
  border-radius: 3px;
  color: #fff;
  background-color: rgb(32 32 32 / 92%);
  box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  backdrop-filter: blur(4px);
}

.paidPromotionBadge:hover,
.paidPromotionBadge:focus-visible {
  background-color: rgb(48 48 48 / 96%);
}

.paidPromotionIcon {
  inline-size: 20px;
  block-size: 20px;
  font-size: 20px;
}

.paidPromotionChevron {
  inline-size: 14px;
  block-size: 14px;
  margin-inline-start: 2px;
  font-size: 14px;
}
</style>
