import shaka from 'shaka-player'

import { copyToClipboard } from '../../../helpers/utils'

/**
 * @typedef {object} CopyVideoUrlContext
 * @property {(backend: 'youtube' | 'invidious', includeTimestamp: boolean) => string} getVideoUrl
 * @property {(backend: 'youtube' | 'invidious', includeTimestamp: boolean) => string} getLabel
 * @property {(backend: 'youtube' | 'invidious', includeTimestamp: boolean) => string} getSuccessMessage
 */

/**
 * Shaka's element registry is global to the renderer and shared by every player
 * instance. With the single-renderer multi-tab model there can be several
 * players alive at once, so a factory that closes over one instance's state
 * would make every player's copy button use the last-registered player's video.
 * Instead we resolve the owning instance at click time via its `Controls`
 * object, which shaka keeps stable across reconfigures and hands to every
 * element it builds for that player.
 * @type {WeakMap<shaka.ui.Controls, CopyVideoUrlContext>}
 */
const copyVideoUrlContexts = new WeakMap()

/**
 * Associate a player's `Controls` with the copy-url context of that specific
 * instance.
 * @param {shaka.ui.Controls} controls
 * @param {CopyVideoUrlContext} context
 * @returns {() => void} a cleanup function that removes the association
 */
export function setCopyVideoUrlContext(controls, context) {
  copyVideoUrlContexts.set(controls, context)

  return () => {
    if (copyVideoUrlContexts.get(controls) === context) {
      copyVideoUrlContexts.delete(controls)
    }
  }
}

export class CopyVideoUrlButton extends shaka.ui.Element {
  /**
   * @param {'youtube' | 'invidious'} backend
   * @param {boolean} includeTimestamp
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(backend, includeTimestamp, parent, controls) {
    super(parent, controls)

    /** @private */
    this.backend_ = backend

    /** @private */
    this.includeTimestamp_ = includeTimestamp

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('copy-video-url-button', 'shaka-no-propagation')

    // eslint-disable-next-line no-new
    new shaka.ui.Icon(this.button_, shaka.ui.Enums.MaterialDesignSVGIcons.COPY)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    this.button_.appendChild(label)
    this.parent.appendChild(this.button_)

    this.eventManager.listen(this.button_, 'click', () => {
      const context = copyVideoUrlContexts.get(this.controls)
      if (!context) {
        return
      }

      copyToClipboard(context.getVideoUrl(this.backend_, this.includeTimestamp_), {
        messageOnSuccess: context.getSuccessMessage(this.backend_, this.includeTimestamp_)
      })

      this.parent.classList.add('shaka-hidden')
    })

    this.eventManager.listen(this.controls, 'contextmenu', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.controls, 'submenuopen', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_CHANGED, () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.localization, shaka.ui.Localization.LOCALE_UPDATED, () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = copyVideoUrlContexts.get(this.controls)?.getLabel(this.backend_, this.includeTimestamp_) ?? ''
    this.nameSpan_.textContent = label
    this.button_.ariaLabel = label
  }
}
