import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { BooleanSettingButton } from './BooleanSettingButton'

export class MusicVisualizerButton extends BooleanSettingButton {
  /**
   * @param {import('vue').ComputedRef<boolean>} musicVisualizer
   * @param {(value: boolean) => void} updateMusicVisualizer
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(musicVisualizer, updateMusicVisualizer, events, parent, controls) {
    super({
      value: musicVisualizer,
      updateValue: updateMusicVisualizer,
      events,
      className: 'music-visualizer-button',
      icon: PlayerIcons.INSERT_CHART_FILLED,
      getLabel: () => i18n.global.t('Settings.Player Settings.Music Visualizer'),
    }, parent, controls)
  }
}
