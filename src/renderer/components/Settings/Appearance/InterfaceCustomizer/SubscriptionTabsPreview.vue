<template>
  <div
    class="subscriptionTabsPreview"
    aria-hidden="true"
    inert
  >
    <header class="previewHeader">
      <span class="previewTitle">
        <FtIcon :icon="['fas', 'subscriptions']" />
        {{ t('Subscriptions.Subscriptions') }}
      </span>
      <FtTabs class="previewTabs">
        <button
          v-for="(tab, index) in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          tabindex="-1"
          :aria-selected="index === 0"
          :data-preview-subscription-tab="tab.id"
        >
          <FtIcon :icon="tab.icon" />
          <span class="previewTabLabel">{{ tab.label }}</span>
        </button>
      </FtTabs>
    </header>
    <div class="previewGrid">
      <div
        v-for="card in 6"
        :key="card"
        class="previewCard"
      >
        <span class="previewThumbnail" />
        <span class="previewLine" />
        <span class="previewLine short" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtTabs from '../../../FtTabs/FtTabs.vue'

import { useVisibleSubscriptionTabs } from '../../../../composables/useVisibleSubscriptionTabs'
import { SUBSCRIPTION_TAB_DEFINITIONS } from '../../../../helpers/subscriptionTabs'

const { t } = useI18n()
const visibleTabs = useVisibleSubscriptionTabs()
const definitions = new Map(SUBSCRIPTION_TAB_DEFINITIONS.map(tab => [tab.id, tab]))

const tabs = computed(() => visibleTabs.value.map(id => ({
  ...definitions.get(id),
  // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
  label: t(definitions.get(id).labelKey),
})))
</script>

<style scoped>
.subscriptionTabsPreview {
  background-color: var(--card-bg-color);
  block-size: 100%;
  border: 1px solid var(--divider-color);
  border-radius: var(--shape-corner-medium);
  box-sizing: border-box;
  color: var(--primary-text-color);
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

.previewHeader {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.previewTitle {
  align-items: center;
  display: flex;
  font-size: 1.25rem;
  font-weight: 600;
  gap: 10px;
}

.previewTabs {
  flex-wrap: nowrap;
  justify-content: center;

  --material-tab-padding-inline: 12px;
}

.previewTabs [role='tab'] {
  flex-shrink: 0;
}

/* Like the page's compact tabs, label only the selected tab when space runs out. */
@container (width < 640px) {
  .previewTabs [role='tab'][aria-selected='false'] .previewTabLabel {
    display: none;
  }
}

.previewGrid {
  align-content: start;
  display: grid;
  flex: 1 1 auto;
  gap: 16px 12px;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  min-block-size: 0;
  overflow: hidden;
  padding-block: 0 16px;
  padding-inline: 16px;
}

.previewCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.previewThumbnail {
  aspect-ratio: 16 / 9;
  background-color: var(--secondary-card-bg-color);
  border-radius: var(--shape-corner-medium);
}

.previewLine {
  background-color: var(--secondary-card-bg-color);
  block-size: 10px;
  border-radius: calc(5px * var(--ui-roundness));
}

.previewLine.short {
  inline-size: 60%;
}
</style>
