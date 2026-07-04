<template>
  <FtCard
    class="card"
  >
    <h3>{{ $t("Settings.Password Dialog.Enter Password To Unlock") }}</h3>

    <FtInput
      ref="password"
      :placeholder="$t('Settings.Password Dialog.Password')"
      :show-action-button="false"
      input-type="password"
      class="passwordInput"
      @click="handlePasswordInput"
    />
  </FtCard>
</template>

<script setup>
import { computed, onMounted, useTemplateRef } from 'vue'

import FtCard from '../ft-card/ft-card.vue'
import FtInput from '../FtInput/FtInput.vue'

import store from '../../store/index'
import { isHashedPassword, verifyPassword } from '../../helpers/passwords'

const emit = defineEmits(['unlocked'])

const password = useTemplateRef('password')

onMounted(() => {
  password.value.focus()
})

const settingsPassword = computed(() => {
  return store.getters.getSettingsPassword
})

async function handlePasswordInput(input) {
  if (await verifyPassword(input, settingsPassword.value)) {
    if (!isHashedPassword(settingsPassword.value)) {
      store.dispatch('updateSettingsPassword', input)
    }

    emit('unlocked')
  }
}
</script>

<style scoped src="./PasswordDialog.css" />
