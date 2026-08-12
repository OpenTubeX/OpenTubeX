import shaka from 'shaka-player'
import { watch } from 'vue'

import i18n from '../../../i18n/index'
import { PlayerIcons, ZOOM_IN_ICON_VIEWBOX } from '../../../../constants'
import {
  DEFAULT_VIDEO_ZOOM,
  formatVideoZoom,
  VIDEO_ZOOM_LEVELS,
} from '../../../helpers/player/videoZoom'

export class VideoZoomSelection extends shaka.ui.SettingsMenu {
  /**
   * @param {import('vue').ComputedRef<number>} videoZoom
   * @param {(value: number) => void} updateVideoZoom
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(videoZoom, updateVideoZoom, events, parent, controls) {
    super(parent, controls, {
      path: PlayerIcons.ZOOM_IN_ROUNDED,
      viewBox: ZOOM_IN_ICON_VIEWBOX,
    })

    this.button.classList.add('video-zoom-button', 'shaka-tooltip-status')
    this.menu.classList.add('video-zoom-menu')

    /** @private */
    this.videoZoom_ = videoZoom

    /** @type {SVGElement} */
    const checkmarkIcon = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
    checkmarkIcon.classList.add('shaka-chosen-item')
    checkmarkIcon.ariaHidden = 'true'

    /** @private */
    this.checkmarkIcon_ = checkmarkIcon

    /** @private @type {Map<number, HTMLButtonElement>} */
    this.zoomButtons_ = new Map()

    for (const zoom of VIDEO_ZOOM_LEVELS) {
      const button = document.createElement('button')
      button.appendChild(document.createElement('span'))
      this.menu.appendChild(button)

      this.eventManager.listen(button, 'click', () => {
        updateVideoZoom(zoom)
      })

      this.zoomButtons_.set(zoom, button)
    }

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    if (this.isSubMenu) {
      this.eventManager.listen(this.controls, 'submenuopen', () => {
        this.button.classList.add('shaka-hidden')
      })
      this.eventManager.listen(this.controls, 'submenuclose', () => {
        this.button.classList.remove('shaka-hidden')
      })
    }

    /** @private */
    this.stopVideoZoomWatch_ = watch(this.videoZoom_, () => {
      this.updateState_()
    })

    this.updateLocalisedStrings_()
    this.updateState_()
  }

  release() {
    this.stopVideoZoomWatch_()
    super.release()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Zoom.Zoom')

    this.button.ariaLabel = label
    this.nameSpan.textContent = label
    this.backSpan.textContent = label
    this.backButton.ariaLabel = this.localization.resolve('BACK')

    for (const [zoom, button] of this.zoomButtons_) {
      button.querySelector('span').textContent = zoom === DEFAULT_VIDEO_ZOOM
        ? i18n.global.t('Video.Player.Zoom.Off')
        : formatVideoZoom(zoom)
    }

    this.updateState_()
  }

  /** @private */
  updateState_() {
    const currentZoom = this.videoZoom_.value

    for (const [zoom, button] of this.zoomButtons_) {
      const isSelected = zoom === currentZoom

      button.querySelector('span').classList.toggle('shaka-chosen-item', isSelected)
      button.ariaSelected = isSelected ? 'true' : 'false'

      if (isSelected) {
        button.appendChild(this.checkmarkIcon_)
      }
    }

    const status = currentZoom === DEFAULT_VIDEO_ZOOM
      ? i18n.global.t('Video.Player.Zoom.Off')
      : formatVideoZoom(currentZoom)

    this.currentSelection.textContent = status
    this.button.setAttribute('shaka-status', status)
  }
}
