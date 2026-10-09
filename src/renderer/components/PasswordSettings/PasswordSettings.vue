<template>
  <FtSettingsSection
    :title="$t('Settings.Password Settings.Password Settings')"
  >
    <FtFlexBox
      v-if="hasStoredPassword"
      class="settingsFlexStart460px"
    >
      <FtButton
        :label="$t('Settings.Password Settings.Remove Password')"
        :icon="['fas', 'trash']"
        @click="handleRemovePassword"
      />
    </FtFlexBox>
    <FtFlexBox
      v-else
      class="passwordForm"
    >
      <FtInput
        :icon="['fas', 'lock']"
        :label="$t('Settings.Password Dialog.Password')"
        :placeholder="$t('Form Inputs.Choose Password Hint')"
        :supporting-text="$t('Settings.Password Settings.Set Password To Prevent Access')"
        :show-action-button="false"
        show-label
        input-type="password"
        :value="password"
        @input="e => password = e"
        @keydown.enter="confirmationInput?.focus()"
      />
      <FtInput
        ref="confirmationInput"
        class="passwordConfirmation"
        :class="{ invalid: passwordMismatch }"
        :icon="['fas', 'lock']"
        :label="$t('Settings.Password Settings.Confirm Password')"
        :placeholder="$t('Form Inputs.Confirm Password Hint')"
        :supporting-text="passwordMismatch ? $t('Settings.Password Settings.Passwords Do Not Match') : ''"
        :show-action-button="false"
        show-label
        input-type="password"
        :value="confirmedPassword"
        @input="e => confirmedPassword = e"
        @keydown.enter="handleSetPassword"
      />
      <FtButton
        class="centerButton"
        theme="primary"
        :label="$t('Settings.Password Settings.Set Password')"
        :icon="['fas', 'key']"
        :disabled="!canSetPassword"
        @click="handleSetPassword"
      />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref, useTemplateRef } from 'vue'

import FtInput from '../FtInput/FtInput.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'

import store from '../../store/index'

const settingsPassword = computed(() => {
  return store.getters.getSettingsPassword
})

const hasStoredPassword = computed(() => {
  return settingsPassword.value !== ''
})

const password = ref('')
const confirmedPassword = ref('')
const confirmationInput = useTemplateRef('confirmationInput')
const canSetPassword = computed(() => password.value !== '' && password.value === confirmedPassword.value)
const passwordMismatch = computed(() => confirmedPassword.value !== '' && password.value !== confirmedPassword.value)

function handleSetPassword() {
  if (!canSetPassword.value) return
  store.dispatch('updateSettingsPassword', password.value)
  password.value = ''
  confirmedPassword.value = ''
}

function handleRemovePassword() {
  store.dispatch('updateSettingsPassword', '')
  password.value = ''
  confirmedPassword.value = ''
}
</script>

<style scoped src="./PasswordSettings.css" />
