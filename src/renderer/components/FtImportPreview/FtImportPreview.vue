<template>
  <section
    v-if="rows.length"
    class="importPreview"
    :aria-label="t('Settings.Data Settings.Import Preview.Title')"
  >
    <h3>{{ t('Settings.Data Settings.Import Preview.Title') }}</h3>
    <div class="previewGrid">
      <article
        v-for="row in rows"
        :key="row.unit ?? row.category"
        class="previewCategory"
        :data-category="row.category"
      >
        <h4>{{ row.unit ? t('Subscriptions.Subscriptions') : labels[row.category] }}</h4>
        <p class="previewCounts">
          <span>{{ t('Settings.Data Settings.Import Preview.New', { count: row.added }) }}</span>
          <span>{{ t('Settings.Data Settings.Import Preview.Existing', { count: row.existing }) }}</span>
          <span v-if="row.skipped">{{ t('Settings.Data Settings.Import Preview.Skipped', { count: row.skipped }) }}</span>
        </p>
        <p>{{ effects[row.effect] }}</p>
        <p v-if="row.failedFiles">
          {{ t('Settings.Data Settings.Import Preview.Unreadable files', { count: row.failedFiles }) }}
        </p>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const effects = computed(() => ({
  'Settings effect': t('Settings.Data Settings.Import Preview.Settings effect'),
  'Details effect': t('Settings.Data Settings.Import Preview.Details effect'),
  'Merge effect': t('Settings.Data Settings.Import Preview.Merge effect'),
  'Subscriptions effect': t('Settings.Data Settings.Import Preview.Subscriptions effect'),
  'History replace effect': t('Settings.Data Settings.Import Preview.History replace effect'),
}))
defineProps({
  rows: { type: Array, required: true },
  labels: { type: Object, required: true },
})
</script>

<style scoped>
.importPreview {
  inline-size: 100%;
  text-align: center;
}

h3 {
  margin-block: 0 1em;
}

.previewGrid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1em;
}

.previewCategory {
  flex: 1 1 18rem;
  min-inline-size: 0;
  box-sizing: border-box;
  padding: 1em;
  border: 1px solid var(--divider-color);
  border-radius: calc(8px * var(--ui-roundness));
  background: var(--secondary-card-bg-color);
}

h4 {
  margin-block: 0 0.5em;
}

p {
  margin-block: 0.5em 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
  color: var(--secondary-text-color);
  font-size: 0.9em;
}

.previewCounts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25em 1em;
  color: var(--primary-text-color);
  font-size: 1em;
  font-weight: bold;
}
</style>
