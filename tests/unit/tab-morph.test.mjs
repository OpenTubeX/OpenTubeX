import assert from 'node:assert/strict'
import test from 'node:test'

process.env.IS_ELECTRON = 'true'

const matchMediaListeners = []
const documentListeners = new Map()
const appended = []
const removed = []
const animations = []

class FakeDOMRect {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x
    this.y = y
    this.width = width
    this.height = height
    this.left = x
    this.top = y
    this.right = x + width
    this.bottom = y + height
  }

  static fromRect(rect) {
    return new FakeDOMRect(rect.x, rect.y, rect.width, rect.height)
  }
}

class FakeAnimation {
  constructor(keyframes, options) {
    this.keyframes = keyframes
    this.options = options
    this.finished = Promise.resolve()
    this.playbackRate = 1
    animations.push(this)
  }

  updatePlaybackRate(rate) {
    this.playbackRate = rate
  }
}

function createFakeElement(tagName, { className = '', rect = null, children = [] } = {}) {
  const classList = {
    values: new Set(className.split(/\s+/).filter(Boolean)),
    contains(name) {
      return this.values.has(name)
    },
    add(name) {
      this.values.add(name)
    }
  }

  const style = {}
  const el = {
    tagName: tagName.toUpperCase(),
    className,
    classList,
    style,
    children: [...children],
    dataset: {},
    scrollIntoView() {},
    getBoundingClientRect() {
      return rect ?? new FakeDOMRect()
    },
    querySelector(selector) {
      const match = (node) => {
        if (selector.startsWith('.') && node.classList.contains(selector.slice(1))) {
          return node
        }
        if (selector.includes(',')) {
          return selector.split(',').map(part => part.trim()).some(part => match({
            ...node,
            matches: () => false
          }) || (part.startsWith('.') && node.classList.contains(part.slice(1))))
            ? node
            : null
        }
        return null
      }

      for (const child of el.children) {
        if (selector.startsWith('.') && child.classList.contains(selector.slice(1))) {
          return child
        }
        if (selector.includes(',')) {
          for (const part of selector.split(',').map(part => part.trim())) {
            if (part.startsWith('.') && child.classList.contains(part.slice(1))) {
              return child
            }
          }
        }
        const nested = child.querySelector?.(selector)
        if (nested) {
          return nested
        }
      }
      return null
    },
    closest(selector) {
      if (selector.split(',').some(part => {
        const trimmed = part.trim()
        return trimmed.startsWith('.') && classList.contains(trimmed.slice(1))
      })) {
        return el
      }
      return null
    },
    animate(keyframes, options) {
      return new FakeAnimation(keyframes, options)
    },
    remove() {
      removed.push(el)
    }
  }

  if (tagName === 'img') {
    el.src = ''
    el.currentSrc = ''
    el.alt = ''
    el.draggable = true
  }

  return el
}

const body = createFakeElement('body')
body.appendChild = (node) => {
  appended.push(node)
  body.children.push(node)
}

globalThis.DOMRect = FakeDOMRect
globalThis.CSS = { escape: (value) => value }
globalThis.HTMLElement = class HTMLElement {}
globalThis.HTMLImageElement = class HTMLImageElement extends globalThis.HTMLElement {}
globalThis.Element = class Element {}
globalThis.requestAnimationFrame = (cb) => {
  queueMicrotask(() => cb(0))
  return 1
}

globalThis.window = {
  matchMedia() {
    return {
      matches: false,
      addEventListener(_type, listener) {
        matchMediaListeners.push(listener)
      }
    }
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis)
}

globalThis.document = {
  documentElement: {
    dataset: {}
  },
  body,
  addEventListener(type, listener) {
    documentListeners.set(type, listener)
  },
  getAnimations() {
    return []
  },
  querySelector(selector) {
    if (selector.startsWith('.tab[data-tab-id=')) {
      const id = selector.match(/data-tab-id="([^"]+)"/)?.[1]
      return tabsById.get(id) ?? null
    }
    return null
  },
  createElement(tagName) {
    const el = createFakeElement(tagName)
    // Instances created through document.createElement need to pass instanceof checks
    Object.setPrototypeOf(el, tagName === 'img' ? globalThis.HTMLImageElement.prototype : globalThis.HTMLElement.prototype)
    return el
  }
}

const tabsById = new Map()

const {
  setReducedMotionPreference
} = await import('../../src/renderer/helpers/reducedMotion.js')

const {
  captureTabMorphSnapshot,
  morphThumbnailIntoTab
} = await import('../../src/renderer/helpers/tabMorph.js')

function makeThumbnail({ x = 40, y = 80, width = 320, height = 180 } = {}) {
  const thumbnail = createFakeElement('img', {
    className: 'thumbnailImage',
    rect: new FakeDOMRect(x, y, width, height)
  })
  Object.setPrototypeOf(thumbnail, globalThis.HTMLImageElement.prototype)
  thumbnail.src = 'https://example.com/thumb.jpg'
  thumbnail.currentSrc = thumbnail.src
  thumbnail.style.borderRadius = '8px'

  const link = createFakeElement('a', {
    className: 'thumbnailLink',
    children: [thumbnail]
  })
  Object.setPrototypeOf(link, globalThis.HTMLElement.prototype)
  thumbnail.closest = (selector) => {
    if (selector.includes('ft-list-video') || selector.includes('ft-list-item')) {
      return createFakeElement('div', { className: 'ft-list-video', children: [link] })
    }
    return null
  }

  // getComputedStyle for the thumbnail
  return { link, thumbnail }
}

globalThis.getComputedStyle = (el) => ({
  borderRadius: el.style?.borderRadius || '0px',
  direction: 'ltr',
  paddingInlineStart: '10px'
})

test('captureTabMorphSnapshot reads the thumbnail geometry from a watch link', () => {
  setReducedMotionPreference('off')
  const { link, thumbnail } = makeThumbnail()

  const snapshot = captureTabMorphSnapshot(link)

  assert.deepEqual(snapshot, {
    src: thumbnail.src,
    from: new FakeDOMRect(40, 80, 320, 180),
    fromBorderRadius: '8px'
  })
})

test('captureTabMorphSnapshot is a no-op when reduced motion is enabled', () => {
  setReducedMotionPreference('on')
  const { link } = makeThumbnail()

  assert.equal(captureTabMorphSnapshot(link), null)

  setReducedMotionPreference('off')
})

test('morphThumbnailIntoTab animates a clone into the tab icon slot', async () => {
  setReducedMotionPreference('off')
  appended.length = 0
  removed.length = 0
  animations.length = 0

  const tabTitle = createFakeElement('span', {
    className: 'tabTitle',
    rect: new FakeDOMRect(900, 10, 120, 16)
  })
  Object.setPrototypeOf(tabTitle, globalThis.HTMLElement.prototype)
  const loadingDot = createFakeElement('span', { className: 'loadingDot' })
  Object.setPrototypeOf(loadingDot, globalThis.HTMLElement.prototype)
  tabTitle.children.push(loadingDot)

  const tab = createFakeElement('div', {
    className: 'tab',
    children: [tabTitle]
  })
  Object.setPrototypeOf(tab, globalThis.HTMLElement.prototype)
  tab.dataset.tabId = 'tab-1'
  tabsById.set('tab-1', tab)

  const snapshot = {
    src: 'https://example.com/thumb.jpg',
    from: new FakeDOMRect(40, 80, 320, 180),
    fromBorderRadius: '8px'
  }

  await morphThumbnailIntoTab(snapshot, 'tab-1')

  assert.equal(appended.length, 1)
  assert.equal(appended[0].className, 'tabThumbnailMorph')
  assert.equal(appended[0].src, snapshot.src)
  assert.equal(animations.length, 1)
  assert.equal(animations[0].options.duration, 320)
  assert.deepEqual(animations[0].keyframes[0], {
    left: '40px',
    top: '80px',
    width: '320px',
    height: '180px',
    borderRadius: '8px',
    opacity: 1
  })
  assert.deepEqual(animations[0].keyframes[1], {
    left: '900px',
    top: '10px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    opacity: 1
  })
  assert.equal(removed.length, 1)
  assert.equal(loadingDot.style.visibility, '')
})

test('morphThumbnailIntoTab skips work without a snapshot or tab id', async () => {
  appended.length = 0
  await morphThumbnailIntoTab(null, 'tab-1')
  await morphThumbnailIntoTab({
    src: 'https://example.com/thumb.jpg',
    from: new FakeDOMRect(0, 0, 10, 10),
    fromBorderRadius: '0px'
  }, '')
  assert.equal(appended.length, 0)
})
