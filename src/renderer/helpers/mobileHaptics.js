import { Haptics, ImpactStyle } from '@capacitor/haptics'

export function lightHaptic() {
  if (!process.env.IS_CAPACITOR) return
  Haptics.impact({ style: ImpactStyle.Light }).catch(error => {
    console.warn('Haptic feedback failed', error)
  })
}
