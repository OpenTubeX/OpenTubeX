<template>
  <!-- The role is what makes the label reach assistive technology: on a plain
       span it would be dropped, leaving the compact badge with no text at all -->
  <span
    v-if="impact"
    class="performanceImpact"
    :class="[impact.level, { compact }]"
    role="img"
    :title="title"
    :aria-label="fullText"
  >
    <FtIcon :icon="['fas', impact.level === 'high' ? 'gauge-high' : 'gauge']" />
    <span
      v-if="!compact"
      class="performanceImpactLabel"
    >{{ label }}</span>
  </span>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { getSettingPerformanceImpact } from '../../helpers/settingsPerformanceImpact'
import store from '../../store/index'

const props = defineProps({
  settingKey: {
    type: String,
    default: ''
  },
  /**
   * Drops the level text and keeps only the icon, for labels that have no room
   * to grow, such as the absolutely positioned label of a select.
   */
  compact: {
    type: Boolean,
    default: false
  }
})

const { locale, t } = useI18n()

const impact = computed(() => store.getters.getShowPerformanceImpactIndicators
  ? getSettingPerformanceImpact(props.settingKey)
  : null)

const label = computed(() => impact.value?.level === 'high'
  ? t('Settings.Performance Impact.High')
  : t('Settings.Performance Impact.Moderate'))

/**
 * Spelled out instead of interpolating the key, as the linter rightly rejects
 * dynamic translation keys.
 * @param {import('../../helpers/settingsPerformanceImpact').PerformanceImpactResource} resource
 */
function resourceLabel(resource) {
  switch (resource) {
    case 'CPU':
      return t('Settings.Performance Impact.Resources.CPU')
    case 'GPU':
      return t('Settings.Performance Impact.Resources.GPU')
    case 'Memory':
      return t('Settings.Performance Impact.Resources.Memory')
    case 'Network':
      return t('Settings.Performance Impact.Resources.Network')
    case 'Disk':
      return t('Settings.Performance Impact.Resources.Disk')
  }
}

const description = computed(() => {
  if (impact.value == null) { return '' }

  const resources = new Intl.ListFormat(locale.value, { style: 'long', type: 'conjunction' })
    .format(impact.value.resources.map(resourceLabel))

  return t('Settings.Performance Impact.Description', { resources })
})

const fullText = computed(() => `${label.value}: ${description.value}`)

// The level is only repeated in the hover text when the badge doesn't show it
const title = computed(() => props.compact ? fullText.value : description.value)
</script>

<style scoped>
.performanceImpact {
  align-items: center;
  background-color: color-mix(in srgb, var(--impact-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--impact-color) 35%, transparent);
  border-radius: calc(10px * var(--ui-roundness));
  color: color-mix(in srgb, var(--impact-color) 70%, var(--primary-text-color));
  cursor: help;
  display: inline-flex;
  font-size: 0.7em;
  font-weight: 600;
  gap: 4px;
  /* Symmetric, as the badge sits between the label and the tooltip or sync icons */
  margin-inline: 6px;
  padding-block: 1px;
  padding-inline: 6px;
  text-transform: uppercase;
  vertical-align: middle;
  white-space: nowrap;
}

.compact {
  background-color: transparent;
  border: 0;
  color: var(--impact-color);
  font-size: 0.85em;
  margin-inline: 4px;
  padding: 0;
}

.moderate {
  --impact-color: #d98e00;
}

.high {
  --impact-color: var(--destructive-color);
}
</style>
