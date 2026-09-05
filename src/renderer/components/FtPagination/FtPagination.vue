<template>
  <div
    v-if="total > pageSize"
    class="pagination"
  >
    <FtButton
      :label="t('Video.Previous')"
      :disabled="page === 0"
      @click="page--"
    />
    <span aria-live="polite">
      {{ page * pageSize + 1 }}-{{ Math.min((page + 1) * pageSize, total) }} / {{ total }}
    </span>
    <FtButton
      :label="t('Video.Next')"
      :disabled="(page + 1) * pageSize >= total"
      @click="page++"
    />
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import FtButton from '../FtButton/FtButton.vue'

const page = defineModel('page', { type: Number, required: true })
defineProps({
  pageSize: { type: Number, required: true },
  total: { type: Number, required: true }
})
const { t } = useI18n()
</script>

<style scoped>
.pagination {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
}

.pagination :deep(.btn) {
  margin: 0;
  min-inline-size: 0;
  overflow-wrap: anywhere;
  padding-inline: 8px;
  white-space: normal;
}
</style>
