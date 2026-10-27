// Keep in sync with Shaka's @thumb-size, which positions its own preview.
export const THUMB_SIZE = 12
const MIN_FRAME_WIDTH = 96
const FRAMES_PER_BAR = 7
const MAX_PLAYER_HEIGHT_FRACTION = 0.25

/**
 * A strip of consecutive storyboard frames above the seek bar, scrolled so the
 * frame under the marker is the one at the previewed time.
 */
export class SeekFilmstrip {
  /**
   * @param {import('shaka-player').default.ui.SeekBar} seekBar
   */
  constructor(seekBar) {
    this.seekBar = seekBar
    this.element = document.createElement('div')
    this.element.className = 'ft-seek-filmstrip'
    this.element.setAttribute('aria-hidden', 'true')
    this.marker = document.createElement('div')
    this.marker.className = 'ft-seek-filmstrip-marker'
    this.element.append(this.marker)
    seekBar.container.append(this.element)
    /** @type {Map<number, Promise<object | null>>} */
    this.frames = new Map()
    this.generation = 0
  }

  /**
   * @param {number} time
   */
  async show(time) {
    const request = ++this.generation
    const { bar, container, controls } = this.seekBar
    const min = Number(bar.min)
    const max = Number(bar.max)
    // Like Shaka's own preview, stay inside the last storyboard frame at the end,
    // which usually ends on a whole second.
    const current = await this.getFrame(Math.max(min, Math.min(Math.floor(max) - 0.001, time)))
    if (request !== this.generation) return
    if (!isUsableFrame(current)) {
      this.hide()
      return
    }

    const width = bar.getBoundingClientRect().width
    const aspectRatio = current.width && current.height ? current.width / current.height : 16 / 9
    const playerHeight = controls.getVideoContainer().getBoundingClientRect().height
    const height = Math.min(Math.max(width / FRAMES_PER_BAR, MIN_FRAME_WIDTH) / aspectRatio, playerHeight * MAX_PLAYER_HEIGHT_FRACTION)
    const frameWidth = height * aspectRatio
    const markerX = THUMB_SIZE / 2 + (max > min ? (time - min) / (max - min) : 0) * (width - THUMB_SIZE)

    // Follow the actual frame boundaries: the last frame is often shorter.
    const count = Math.ceil(width / frameWidth) + 1
    const [before, after] = await Promise.all([this.walk(current, -1, count), this.walk(current, 1, count)])
    if (request !== this.generation) return
    const thumbnails = [...before.reverse(), current, ...after]
    const pixelsPerSecond = frameWidth / Math.max(...thumbnails.map(thumbnail => thumbnail.duration))
    const frames = thumbnails
      .map(thumbnail => ({
        thumbnail,
        left: markerX + (thumbnail.startTime - time) * pixelsPerSecond,
        width: thumbnail.duration * pixelsPerSecond,
      }))
      .filter(frame => frame.left + frame.width > 0 && frame.left < width)

    container.style.setProperty('--ft-seek-filmstrip-height', `${height}px`)
    container.classList.add('ft-seek-filmstrip-active')
    this.marker.style.left = `${markerX}px`
    const elements = [...this.element.querySelectorAll('.ft-seek-filmstrip-frame')]
    frames.forEach((frame, index) => {
      let element = elements[index]
      if (!element) {
        element = document.createElement('div')
        element.className = 'ft-seek-filmstrip-frame'
        element.append(document.createElement('div'))
        this.marker.before(element)
      }
      element.style.left = `${frame.left}px`
      element.style.width = `${frame.width}px`
      setFrameImage(element.firstElementChild, frame.thumbnail, frame.width, height)
    })
    for (const element of elements.slice(frames.length)) element.remove()
  }

  hide() {
    this.generation++
    this.frames.clear()
    this.seekBar.container.classList.remove('ft-seek-filmstrip-active')
  }

  /**
   * Collects up to `count` consecutive frames before (-1) or after (1) a frame.
   * @param {object} frame
   * @param {-1 | 1} direction
   * @param {number} count
   */
  async walk(frame, direction, count) {
    const { min, max } = this.seekBar.bar
    const frames = []
    while (frames.length < count) {
      // Shaka snaps times within 0.01% of a sprite tile's start to that tile,
      // which can swallow a fixed step back on long tiles. Earlier tiles are
      // never shorter than later ones, so aim for the previous tile's middle.
      const time = direction === 1 ? frame.startTime + frame.duration + 0.001 : frame.startTime - frame.duration / 2
      if (time < Number(min) || time > Number(max)) break
      const next = await this.getFrame(time)
      if (!isUsableFrame(next) || next.startTime === frame.startTime) break
      frames.push(next)
      frame = next
    }
    return frames
  }

  /**
   * Storyboard frames do not change during one preview, so each is looked up once.
   * @param {number} time
   */
  getFrame(time) {
    const key = Math.round(time * 1000)
    if (!this.frames.has(key)) this.frames.set(key, this.getThumbnail(time))
    return this.frames.get(key)
  }

  /**
   * @param {number} time
   */
  async getThumbnail(time) {
    const player = this.seekBar.player
    if (player.getImageTracks().length === 0) return null
    try {
      const thumbnail = await player.getThumbnails(null, time)
      const uri = thumbnail?.uris[0]
      // Embedded frames need a segment download; Shaka's single preview covers those.
      return uri && thumbnail.codecs !== 'mjpg' && !uri.startsWith('offline:') ? thumbnail : null
    } catch {
      return null
    }
  }
}

/**
 * @param {object | null} thumbnail
 */
function isUsableFrame(thumbnail) {
  return thumbnail?.duration > 0 && Number.isFinite(thumbnail.duration)
}

/**
 * @param {HTMLElement} element
 * @param {object | null} thumbnail
 * @param {number} width
 * @param {number} height
 */
function setFrameImage(element, thumbnail, width, height) {
  const url = thumbnail?.uris[0].split('#xywh=')[0]
  element.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : ''
  if (thumbnail?.width && thumbnail.height) {
    // Sprite sheets are cropped at their natural size, then scaled to the frame.
    element.style.width = `${thumbnail.width}px`
    element.style.height = `${thumbnail.height}px`
    element.style.backgroundPosition = `${-(thumbnail.positionX || 0)}px ${-(thumbnail.positionY || 0)}px`
    element.style.backgroundSize = ''
    element.style.transform = `scale(${width / thumbnail.width}, ${height / thumbnail.height})`
  } else {
    element.style.width = '100%'
    element.style.height = '100%'
    element.style.backgroundPosition = 'center'
    element.style.backgroundSize = 'cover'
    element.style.transform = ''
  }
}
