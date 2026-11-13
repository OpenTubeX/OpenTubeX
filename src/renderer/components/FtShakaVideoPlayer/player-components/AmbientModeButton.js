import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { BooleanSettingButton } from './BooleanSettingButton'

export class AmbientModeButton extends BooleanSettingButton {
  /**
   * @param {import('vue').ComputedRef<boolean>} ambientMode
   * @param {(value: boolean) => void} updateAmbientMode
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(ambientMode, updateAmbientMode, events, parent, controls) {
    super({
      value: ambientMode,
      updateValue: updateAmbientMode,
      events,
      className: 'ambient-mode-button',
      icon: PlayerIcons.LIGHT_MODE_FILLED,
      getLabel: () => i18n.global.t('Global.Ambient Mode'),
    }, parent, controls)
  }
}
