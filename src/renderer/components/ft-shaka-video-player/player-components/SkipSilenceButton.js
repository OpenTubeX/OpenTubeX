import { KeyboardShortcuts, PlayerIcons } from '../../../../constants'
import i18n from '../../../i18n/index'
import { addKeyboardShortcutToActionTitle } from '../../../helpers/utils'
import { BooleanSettingButton } from './BooleanSettingButton'

export class SkipSilenceButton extends BooleanSettingButton {
  /**
   * @param {import('vue').ComputedRef<boolean>} skipSilence
   * @param {(value: boolean) => void} updateSkipSilence
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(skipSilence, updateSkipSilence, events, parent, controls) {
    super({
      value: skipSilence,
      updateValue: updateSkipSilence,
      events,
      className: 'skip-silence-button',
      icon: PlayerIcons.SKIP_NEXT_FILLED,
      getLabel: () => {
        const baseLabel = i18n.global.t('Settings.Player Settings.Skip Silence')
        const shortcut = KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.TOGGLE_SKIP_SILENCE
        return shortcut
          ? addKeyboardShortcutToActionTitle(baseLabel, shortcut)
          : baseLabel
      },
    }, parent, controls)
  }
}
