<template>
  <FtPrompt
    :label="t('Stats.Replace old device')"
    fixed-layout
    autosize
    :busy="busy"
    card-class="statsDeviceRepairCard"
    @click="!busy && emit('close')"
  >
    <div class="deviceRepair">
      <p>{{ t('Stats.Replacement explanation', { device: source.deviceName || source.deviceId }) }}</p>
      <div class="repairTotals">
        <div>
          <span>{{ source.deviceName || source.deviceId }}</span>
          <strong>{{ formatDuration(total(sourceDays)) }}</strong>
        </div>
        <div>
          <span>{{ currentDeviceName }}</span>
          <small>{{ t('Settings.Sync Settings.Current Device') }}</small>
          <strong>{{ formatDuration(total(currentDays)) }}</strong>
        </div>
      </div>
      <p>{{ t('Stats.Overlapping days', { count: overlapDays }) }}</p>
      <fieldset class="overlapChoices">
        <legend>{{ t('Stats.Overlapping watch time') }}</legend>
        <label>
          <input
            v-model="overlap"
            type="radio"
            :value="'max'"
          >
          <span>
            <strong>{{ t('Stats.Keep larger daily total') }}</strong>
            <span>{{ t('Stats.Larger total explanation') }}</span>
          </span>
        </label>
        <label>
          <input
            v-model="overlap"
            type="radio"
            :value="'sum'"
          >
          <span>
            <strong>{{ t('Stats.Add daily totals') }}</strong>
            <span>{{ t('Stats.Add totals explanation') }}</span>
          </span>
        </label>
      </fieldset>
      <p>{{ t('Stats.Replacement preservation') }}</p>
      <div
        class="repairResult"
        aria-live="polite"
      >
        <span>{{ t('Stats.Combined watch time') }}</span>
        <strong>{{ overlap ? formatDuration(total(resultDays)) : emptyPreview }}</strong>
      </div>
      <p
        v-if="error"
        class="repairError"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
    <template #footer>
      <div class="repairActions">
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          variant="tonal"
          :disabled="busy"
          @click="!busy && emit('close')"
        />
        <FtButton
          :label="busy ? t('Settings.Sync Settings.Syncing statistics') : t('Stats.Replace old device')"
          :icon="['fas', 'check']"
          :disabled="!overlap"
          @click="apply"
        />
      </div>
    </template>
  </FtPrompt>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FtPrompt from '../../components/FtPrompt/FtPrompt.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import store from '../../store'
import { combineWatchStatsDays, containsWatchStatsDevice, watchStatsDeviceDays } from '../../helpers/sync-watch-stats'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  source: { type: Object, required: true },
  formatDuration: { type: Function, required: true },
})
const emit = defineEmits(['close', 'replaced'])
const { t } = useI18n()
const busy = ref(false)
const error = ref('')
const overlap = ref('')
const emptyPreview = '—'
// Freeze the histories shown in the preview. The save rejects changed data.
const source = JSON.parse(JSON.stringify(props.source))
const preview = computed(() => ({
  currentDeviceId: store.getters.getSyncServerDeviceId,
  currentDeviceName: store.getters.getSyncServerDeviceName || t('Settings.Sync Settings.This Device'),
  localDays: store.getters.getWatchSecondsByDate,
  devices: store.getters.getSyncedWatchStats,
  localReset: store.getters.getSyncServerWatchStatsReset,
}))
const { currentDeviceId, currentDeviceName, localDays, devices, localReset } = JSON.parse(JSON.stringify(preview.value))
const target = devices.find(device => containsWatchStatsDevice(device, currentDeviceId))
const replacedDevices = target?.replacedDevices ?? []
const currentDays = target
  ? watchStatsDeviceDays(target, currentDeviceId, localDays, localReset)
  : localDays
const sourceDays = watchStatsDeviceDays(source)
const overlapDays = Object.keys(sourceDays).filter(date => sourceDays[date] > 0 && currentDays[date] > 0).length
const resultDays = computed(() => overlap.value ? combineWatchStatsDays(currentDays, sourceDays, overlap.value) : {})
const total = days => Object.values(days).reduce((sum, seconds) => sum + seconds, 0)

async function apply() {
  if (busy.value || !overlap.value) return
  busy.value = true
  error.value = ''
  try {
    await store.dispatch('replaceSyncWatchStatsDevice', { source, overlap: overlap.value, localDays, currentDays, replacedDevices, localReset })
    showToast({ message: t('Stats.Replacement success'), icon: ['fas', 'check'] })
    emit('replaced')
  } catch (failure) {
    error.value = t('Settings.Sync Settings.Sync failed', { error: failure.message })
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
:global(.promptCard.statsDeviceRepairCard) {
  inline-size: min(560px, 100%);
}

.deviceRepair {
  inline-size: 100%;
}

.deviceRepair p {
  line-height: 1.5;
}

.repairTotals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.repairTotals > div,
.repairResult {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: calc(12px * var(--ui-roundness));
  background: var(--secondary-card-bg-color);
  overflow-wrap: anywhere;
}

.repairTotals strong,
.repairResult strong {
  font-size: 1.3rem;
}

.overlapChoices {
  display: grid;
  gap: 12px;
  border: 0;
  padding: 0;
  margin: 20px 0;
}

.overlapChoices legend {
  margin-block-end: 12px;
  font-weight: bold;
}

.overlapChoices label {
  display: flex;
  align-items: start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--primary-text-color);
  border-radius: calc(10px * var(--ui-roundness));
  cursor: pointer;
}

.overlapChoices label:has(:checked) {
  border-color: var(--primary-color);
  background: var(--secondary-card-bg-color);
}

.overlapChoices input {
  flex-shrink: 0;
  accent-color: var(--primary-color);
}

.overlapChoices label > span {
  display: grid;
  gap: 6px;
  line-height: 1.5;
}

.repairActions {
  display: flex;
  flex-wrap: wrap;
  justify-content: end;
  gap: 12px;
}

.repairError {
  color: var(--destructive-color);
}
</style>
