import { watch } from 'vue'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { performAndroidHapticFeedback, setAndroidHapticFeedbackEnabled } from './androidUi.js'

// Store getters, passed in so that helpers using haptics do not load the store.
let getters = null

export function initializeHapticFeedback(store) {
  getters = store.getters
  watch(() => getters.getHapticFeedback, enabled => {
    setAndroidHapticFeedbackEnabled(enabled).catch(error => {
      console.warn('Could not update WebView haptic feedback', error)
    })
  }, { immediate: true })
}

export function lightHaptic() {
  if (!process.env.IS_CAPACITOR || !getters?.getHapticFeedback) return
  // iOS always applies its own system haptics setting.
  const feedback = process.env.IS_IOS
    ? Haptics.impact({ style: ImpactStyle.Light })
    : performAndroidHapticFeedback(getters.getHapticFeedbackIgnoresSystemSetting)
  feedback.catch(error => {
    console.warn('Haptic feedback failed', error)
  })
}
