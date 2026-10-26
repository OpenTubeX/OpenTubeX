import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SeekFilmstrip } from '../../src/renderer/components/ft-shaka-video-player/player-components/SeekFilmstrip.js'

class FakeElement {
  constructor() {
    this.children = []
    this.parent = null
    this.className = ''
    this.attributes = {}
    const properties = new Map()
    this.style = { setProperty: (name, value) => properties.set(name, value), getPropertyValue: name => properties.get(name) }
    const classes = new Set()
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) }
  }

  get firstElementChild() { return this.children[0] }
  setAttribute(name, value) { this.attributes[name] = value }
  append(...children) {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
  }

  before(child) {
    child.parent = this.parent
    this.parent.children.splice(this.parent.children.indexOf(this), 0, child)
  }

  remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1) }
  querySelectorAll(selector) { return this.children.filter(child => `.${child.className}` === selector) }
}

globalThis.document = { createElement: () => new FakeElement() }

const COLUMNS = 10
const tile = (index, extra = {}) => ({
  uris: ['https://example.test/sprite.jpg#xywh=0,0,160,90'],
  startTime: index,
  duration: 1,
  width: 160,
  height: 90,
  positionX: index % COLUMNS * 160,
  positionY: Math.floor(index / COLUMNS) * 90,
  ...extra,
})

function fixture(getThumbnails = async (_, time) => tile(Math.floor(time))) {
  const seekBar = {
    container: new FakeElement(),
    bar: { min: '0', max: '30', getBoundingClientRect: () => ({ width: 700 }) },
    controls: { getVideoContainer: () => ({ getBoundingClientRect: () => ({ height: 400 }) }) },
    player: { getImageTracks: () => [{}], getThumbnails },
  }
  const filmstrip = new SeekFilmstrip(seekBar)
  const frames = () => filmstrip.element.querySelectorAll('.ft-seek-filmstrip-frame')
  return { seekBar, filmstrip, frames }
}

test('frames scroll so the storyboard tile for the time sits under the marker', async () => {
  const { seekBar, filmstrip, frames } = fixture()
  await filmstrip.show(10.5)
  assert.equal(seekBar.container.classList.contains('ft-seek-filmstrip-active'), true)
  // Seven frames span the bar: each second is 100px wide and 56.25px high.
  assert.equal(seekBar.container.style.getPropertyValue('--ft-seek-filmstrip-height'), '56.25px')
  const markerX = 6 + 10.5 / 30 * 688
  assert.equal(filmstrip.marker.style.left, `${markerX}px`)

  const lefts = frames().map(frame => parseFloat(frame.style.left))
  assert.deepEqual(lefts.toSorted((a, b) => a - b), [8, 9, 10, 11, 12, 13, 14, 15].map(second => markerX + (second - 10.5) * 100))
  const current = frames().find(frame => parseFloat(frame.style.left) <= markerX && markerX < parseFloat(frame.style.left) + 100)
  const image = current.firstElementChild
  assert.equal(image.style.backgroundImage, 'url("https://example.test/sprite.jpg")')
  assert.equal(image.style.backgroundPosition, '0px -90px')
  assert.equal(image.style.width, '160px')
  assert.equal(image.style.transform, `scale(${100 / 160}, ${56.25 / 90})`)

  await filmstrip.show(1)
  const startMarkerX = 6 + 1 / 30 * 688
  assert.deepEqual(frames().map(frame => parseFloat(frame.style.left)).toSorted((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7].map(second => startMarkerX + (second - 1) * 100), 'Frames before the start are dropped')
  filmstrip.hide()
  assert.equal(seekBar.container.classList.contains('ft-seek-filmstrip-active'), false)
})

test('late thumbnails cannot replace a newer preview', async () => {
  let delay = 20
  const { filmstrip, frames } = fixture((_, time) => {
    const wait = delay
    return new Promise(resolve => setTimeout(() => resolve(tile(Math.floor(time))), wait))
  })
  const older = filmstrip.show(5)
  delay = 0
  const newer = filmstrip.show(20)
  await Promise.all([older, newer])
  assert.equal(parseFloat(filmstrip.marker.style.left), 6 + 20 / 30 * 688)
  assert.ok(frames().some(frame => frame.firstElementChild.style.backgroundPosition === '0px -180px'), 'The 20 second tile is shown')
  assert.ok(!frames().some(frame => frame.firstElementChild.style.backgroundPosition === '-500px 0px'), 'The 5 second tile is not')
})

test('the end of the video keeps the last storyboard frame', async () => {
  // Like most storyboards, nothing covers the exact end of the seek range.
  const { seekBar, filmstrip, frames } = fixture(async (_, time) => time < 30 ? tile(Math.floor(time)) : null)
  await filmstrip.show(30)
  assert.equal(seekBar.container.classList.contains('ft-seek-filmstrip-active'), true)
  const markerX = 6 + 688
  const last = frames().find(frame => parseFloat(frame.style.left) <= markerX && markerX <= parseFloat(frame.style.left) + 100)
  assert.equal(last.firstElementChild.style.backgroundPosition, '-1440px -180px')
})

test('a shorter last frame does not repeat its neighbours', async () => {
  // Ten-second frames, with the last one cut short at the 32 second end.
  const tenSeconds = time => {
    const index = Math.floor(Math.min(time, 31.999) / 10)
    return tile(index, { startTime: index * 10, duration: index === 3 ? 2 : 10, positionX: index * 160, positionY: 0 })
  }
  const { seekBar, filmstrip, frames } = fixture(async (_, time) => time < 32 ? tenSeconds(time) : null)
  seekBar.bar.max = '32'
  await filmstrip.show(31)
  const positions = frames().map(frame => frame.firstElementChild.style.backgroundPosition)
  assert.deepEqual(positions.toSorted(), ['-160px 0px', '-320px 0px', '-480px 0px', '0px 0px'])
  const widths = Object.fromEntries(frames().map(frame => [frame.firstElementChild.style.backgroundPosition, parseFloat(frame.style.width)]))
  assert.equal(widths['-480px 0px'], widths['0px 0px'] / 5, 'The two second frame is a fifth as wide')
})

test('individual frame images cover their frame without a sprite crop', async () => {
  const { frames, filmstrip } = fixture(async (_, time) => tile(Math.floor(time), { width: 0, height: 0, uris: ['https://example.test/frame.jpg'] }))
  await filmstrip.show(10)
  const image = frames()[0].firstElementChild
  assert.equal(image.style.backgroundSize, 'cover')
  assert.equal(image.style.width, '100%')
  assert.equal(image.style.transform, '')
})

for (const [name, thumbnail] of [
  ['missing', null],
  ['embedded MJPEG', tile(0, { codecs: 'mjpg' })],
  ['offline', tile(0, { uris: ['offline:frame'] })],
]) {
  test(`${name} storyboards leave the single Shaka preview in place`, async () => {
    const { seekBar, filmstrip } = fixture(async () => thumbnail)
    await filmstrip.show(10)
    assert.equal(seekBar.container.classList.contains('ft-seek-filmstrip-active'), false)
  })
}
