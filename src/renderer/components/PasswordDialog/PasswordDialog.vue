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
      :class="{ invalid: invalidPassword }"
      :value="passwordValue"
      @input="handlePasswordChange"
      @keydown.enter="handlePasswordInput"
    />
    <p
      v-if="invalidPassword"
      class="passwordError"
      role="alert"
    >
      {{ $t('Settings.Password Dialog.Incorrect Password') }}
    </p>
    <FtButton
      class="unlockButton"
      :icon="['fas', 'lock']"
      :label="verifying
        ? $t('Settings.Password Dialog.Unlocking')
        : $t('Settings.Password Dialog.Unlock')"
      :disabled="passwordValue === '' || verifying"
      @click="handlePasswordInput"
    />
  </FtCard>
</template>

<script setup>
import { computed, onMounted, ref, useTemplateRef } from 'vue'

import FtCard from '../ft-card/ft-card.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtButton from '../FtButton/FtButton.vue'

import store from '../../store/index'
import { isHashedPassword, verifyPassword } from '../../helpers/passwords'

const emit = defineEmits(['unlocked'])

const password = useTemplateRef('password')
const passwordValue = ref('')
const invalidPassword = ref(false)
const verifying = ref(false)

onMounted(() => {
  password.value.focus()
})

const settingsPassword = computed(() => {
  return store.getters.getSettingsPassword
})

async function handlePasswordInput() {
  if (verifying.value || passwordValue.value === '') return
  invalidPassword.value = false
  verifying.value = true

  try {
    if (await verifyPassword(passwordValue.value, settingsPassword.value)) {
      if (!isHashedPassword(settingsPassword.value)) {
        store.dispatch('updateSettingsPassword', passwordValue.value)
      }

      emit('unlocked')
    } else {
      invalidPassword.value = true
      password.value.select()
    }
  } finally {
    verifying.value = false
  }
}

function handlePasswordChange(value) {
  passwordValue.value = value
  invalidPassword.value = false
}
</script>

<style scoped src="./PasswordDialog.css" />
