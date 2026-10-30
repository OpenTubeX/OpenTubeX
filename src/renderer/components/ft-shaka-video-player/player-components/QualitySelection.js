import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { getCodecFamily } from '../../../helpers/player/videoCodecPreference'

/** Same order as the preferred video codec setting */
const CODEC_ORDER = ['av01', 'vp09', 'avc1', 'hvc1']
const CODEC_NAMES = { av01: 'AV1', vp09: 'VP9', avc1: 'H.264', hvc1: 'HEVC' }
/** The codecs that Shaka labels as Dolby Vision */
const DOLBY_VISION_CODECS = ['dvh1', 'dvhe', 'dvav', 'dva1', 'dav1', 'dvc1', 'dvi1']

/**
 * @param {string[] | null} a
 * @param {string[] | null} b
 */
function hasSameRoles(a, b) {
  const rolesA = a ?? []
  const rolesB = b ?? []
  return rolesA.length === rolesB.length && rolesA.every(role => rolesB.includes(role))
}

/**
 * Whether the track labels name single resolutions, like Twitch's "720p" HLS
 * renditions, rather than alternative videos with resolutions of their own.
 * @param {shaka.extern.VideoTrack[]} tracks
 */
function hasResolutionLabels(tracks) {
  const labels = new Set(tracks.map(track => track.label))
  return labels.size > 1 &&
    labels.size === new Set(tracks.map(track => track.height)).size &&
    tracks.every(track => track.height && tracks.every(other => other.label !== track.label || other.height === track.height))
}

/**
 * Shaka's resolution menu, but when a video is available in several video
 * codecs, the codecs get a switcher in the header and the tiles only list the
 * resolutions of the chosen one, instead of every codec's tiles side by side.
 * Shaka also only lists the tracks with the playing track's label, which hides
 * every other resolution when the labels name resolutions.
 */
export class QualitySelection extends shaka.ui.ResolutionSelection {
  /**
   * @param {EventTarget} events
   * @param {!HTMLElement} parent
   * @param {!shaka.ui.Controls} controls
   */
  constructor(events, parent, controls) {
    super(parent, controls)

    /** @private @type {string | null} The codec whose resolutions are listed */
    this.codec_ = null

    /** @private */
    this.codecSwitcher_ = document.createElement('div')
    this.codecSwitcher_.classList.add('ft-quality-codecs', 'ft-submenu-header-action')
    this.codecSwitcher_.role = 'group'

    this.eventManager.listen(this.codecSwitcher_, 'click', (event) => {
      // Any other click in the submenu returns to the overflow menu
      event.stopPropagation()
      const button = /** @type {Element} */ (event.target).closest('button')
      if (button && button.dataset.codec !== this.codec_) {
        this.codec_ = button.dataset.codec
        this.updateCodecTiles_()
        button.focus()
      }
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.codecSwitcher_.ariaLabel = i18n.global.t('Downloads.Video Codec')
    })
    this.codecSwitcher_.ariaLabel = i18n.global.t('Downloads.Video Codec')

    // Shaka dispatches this on the controls after rebuilding any resolution
    // menu, so it also arrives before this constructor finishes.
    this.eventManager.listen(controls, 'resolutionselectionupdated', () => {
      // The menu is rebuilt while hidden when it opens, so start on the codec
      // that is playing, but keep the user's choice while it stays open.
      if (this.menu.classList.contains('shaka-hidden')) {
        this.codec_ = null
      }
      this.updateCodecTiles_()
    })
    this.updateCodecTiles_()
  }

  /** @private */
  updateCodecTiles_() {
    const tracks = this.player.isAudioOnly() ? [] : this.getTracks_()
    const codecs = [...new Set(tracks.map(track => getCodecFamily(track.codecs)))]

    if (codecs.length < 2) {
      this.codecSwitcher_.remove()
      if (!hasResolutionLabels(tracks)) return
    }

    codecs.sort((a, b) => {
      const indexA = CODEC_ORDER.indexOf(a)
      const indexB = CODEC_ORDER.indexOf(b)
      return (indexA === -1 ? CODEC_ORDER.length : indexA) - (indexB === -1 ? CODEC_ORDER.length : indexB)
    })

    const activeTrack = tracks.find(track => track.active)
    const selectedTrack = this.player.getConfiguration().abr.enabled ? null : activeTrack
    if (!codecs.includes(this.codec_)) {
      this.codec_ = activeTrack ? getCodecFamily(activeTrack.codecs) : codecs[0]
    }

    if (codecs.length > 1) {
      this.updateCodecSwitcher_(codecs)
    }

    const focusedTile = this.menu.querySelector('.explicit-resolution:focus')
    for (const button of this.menu.querySelectorAll('.explicit-resolution')) {
      this.eventManager.unlisten(button, 'click')
      button.remove()
    }

    const autoButton = this.menu.querySelector('.shaka-enable-abr-button')
    const codecTracks = tracks.filter(track => getCodecFamily(track.codecs) === this.codec_)
    // Across all codecs, so a resolution has the same name in every one
    const showFrameRate = new Set(tracks.map(track => Math.round(track.frameRate ?? 0))).size > 1

    for (const track of codecTracks) {
      const button = document.createElement('button')
      button.classList.add('explicit-resolution')
      this.eventManager.listen(button, 'click', () => {
        this.player.configure({ abr: { enabled: false } })
        this.player.selectVideoTrack(track, this.controls.getConfig().clearBufferOnQualityChange)
      })

      const span = document.createElement('span')
      span.textContent = this.getLabel_(track, codecTracks, showFrameRate)
      button.appendChild(span)

      const mark = getQualityMark(track, this.controls.getConfig().qualityMarks)
      if (mark !== '') {
        const markElement = document.createElement('sup')
        markElement.classList.add('shaka-quality-mark')
        markElement.textContent = mark
        button.appendChild(markElement)
      }

      if (track === selectedTrack) {
        button.ariaSelected = 'true'
        span.classList.add('shaka-chosen-item')
        const checkmark = new shaka.ui.Icon(null, PlayerIcons.DONE_FILLED).getSvgElement()
        checkmark.classList.add('shaka-chosen-item')
        checkmark.ariaHidden = 'true'
        button.appendChild(checkmark)
      }

      this.menu.insertBefore(button, autoButton)
    }

    if (selectedTrack) {
      // Shaka's status names the codec, which the switcher shows instead
      const status = this.getLabel_(
        selectedTrack,
        tracks.filter(track => getCodecFamily(track.codecs) === getCodecFamily(selectedTrack.codecs)),
        showFrameRate
      )
      this.currentSelection.textContent = status
      this.button.setAttribute('shaka-status', status)
    }

    // Shaka focuses its chosen tile after rebuilding the menu
    if (focusedTile) {
      /** @type {HTMLElement} */ (this.menu.querySelector('[aria-selected="true"]') ?? this.codecSwitcher_.querySelector('[aria-pressed="true"]'))?.focus()
    }
  }

  /**
   * @private
   * @param {string[]} codecs
   */
  updateCodecSwitcher_(codecs) {
    const buttons = [...this.codecSwitcher_.children]
    if (buttons.length !== codecs.length || buttons.some((button, index) => button.dataset.codec !== codecs[index])) {
      this.codecSwitcher_.replaceChildren(...codecs.map(codec => {
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.codec = codec
        button.textContent = CODEC_NAMES[codec] ?? codec.toUpperCase()
        return button
      }))
    }

    for (const button of this.codecSwitcher_.children) {
      button.ariaPressed = button.dataset.codec === this.codec_ ? 'true' : 'false'
    }

    // Shaka empties the menu on every rebuild except for its header
    if (this.codecSwitcher_.previousElementSibling !== this.backButton) {
      this.backButton.after(this.codecSwitcher_)
    }
  }

  /**
   * The video tracks that Shaka lists, in the same order.
   * @private
   * @returns {shaka.extern.VideoTrack[]}
   */
  getTracks_() {
    const tracks = this.player.getVideoTracks()
    const selectedTrack = tracks.find(track => track.active)

    return tracks
      .filter((track, index) => {
        if (selectedTrack && !hasSameRoles(selectedTrack.roles, track.roles)) {
          return false
        }
        return index === tracks.findIndex(other => {
          return other.height === track.height &&
            other.bandwidth === track.bandwidth &&
            other.frameRate === track.frameRate &&
            other.hdr === track.hdr &&
            other.videoLayout === track.videoLayout &&
            hasSameRoles(other.roles, track.roles) &&
            getCodecFamily(other.codecs) === getCodecFamily(track.codecs)
        })
      })
      .sort((a, b) => {
        if (a.height === b.height || a.height == null || b.height == null) {
          return b.bandwidth - a.bandwidth
        }
        return b.height - a.height
      })
  }

  /**
   * Shaka's resolution label, but only telling the tracks of one codec apart.
   * @private
   * @param {shaka.extern.VideoTrack} track
   * @param {shaka.extern.VideoTrack[]} tracks
   * @param {boolean} showFrameRate
   * @returns {string}
   */
  getLabel_(track, tracks, showFrameRate) {
    if (!track.height || !track.width) {
      return track.bandwidth ? formatBandwidth(track.bandwidth) : 'Unknown'
    }

    // Only video with square pixels is portrait when it's taller than wide
    const [width, height] = track.height > track.width && hasSquarePixels(track)
      ? [track.height, track.width]
      : [track.width, track.height]
    let label = `${width / height > 16 / 9 ? Math.round(width * 9 / 16) : height}p`

    const frameRate = Math.round(track.frameRate ?? 0)
    if (showFrameRate && frameRate > 30) {
      label += frameRate
    }
    if (DOLBY_VISION_CODECS.includes(getCodecFamily(track.codecs))) {
      label += ' Dolby Vision'
    } else if (track.hdr === 'PQ' || track.hdr === 'HLG') {
      label += ' HDR'
    }
    if (getCodecFamily(track.codecs) === 'lvc1') {
      label += ' LCEVC'
    }
    if (track.videoLayout?.includes('CH-STEREO')) {
      label += ' 3D'
    }

    const isSameResolution = (other) => other !== track &&
      other.height === track.height &&
      other.hdr === track.hdr &&
      Math.round(other.frameRate ?? 0) === frameRate
    if (tracks.some(isSameResolution) && !tracks.some(other => isSameResolution(other) && other.bandwidth === track.bandwidth)) {
      label += ` (${formatBandwidth(track.bandwidth)})`
    }

    return label
  }
}

/**
 * @param {shaka.extern.VideoTrack} track
 * @returns {boolean}
 */
function hasSquarePixels({ pixelAspectRatio }) {
  if (!pixelAspectRatio) {
    return true
  }
  const [x, y = 1] = pixelAspectRatio.split(':').map(Number)
  return x === y
}

/**
 * @param {number} bandwidth
 * @returns {string}
 */
function formatBandwidth(bandwidth) {
  return bandwidth >= 1e6
    ? `${(bandwidth / 1e6).toFixed(1).replace('.0', '')} Mbps`
    : `${Math.floor(bandwidth / 1e3)} Kbps`
}

/**
 * Shaka's HD and 4K marks. Not a method, as the debug build of Shaka calls its
 * own private `getQualityMark_` with different arguments.
 * @param {shaka.extern.VideoTrack} track
 * @param {Record<string, string>} qualityMarks
 * @returns {string}
 */
function getQualityMark({ width, height }, qualityMarks) {
  if (!width || !height) {
    return ''
  }
  let [longSide, shortSide] = height > width ? [height, width] : [width, height]
  if (longSide / shortSide > 16 / 9) {
    shortSide = Math.round(longSide * 9 / 16)
  }
  if (shortSide >= 8640) return `${shortSide}p`
  for (const threshold of [4320, 2160, 1440, 1080, 720]) {
    if (shortSide >= threshold) return qualityMarks[threshold]
  }
  return ''
}
