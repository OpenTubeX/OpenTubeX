const GAMEPAD_AXIS_THRESHOLD = 0.55
const GAMEPAD_REPEAT_DELAY = 350
const GAMEPAD_REPEAT_INTERVAL = 110
const GAMEPAD_ACTIVE_RANGE_ATTRIBUTE = 'data-gamepad-active'

const GAMEPAD_BUTTONS = {
  primary: 0,
  back: 1,
  playPause: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
}

const DIRECTION_ACTIONS = new Set(['up', 'down', 'left', 'right'])
const ACTION_ORDER = ['up', 'down', 'left', 'right', 'primary', 'back', 'playPause']
const GAMEPAD_LAYER_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '.shaka-overflow-menu:not(.shaka-hidden)',
  '.shaka-settings-menu:not(.shaka-hidden)',
  '.shaka-sub-menu:not(.shaka-hidden)',
  '.shaka-context-menu:not(.shaka-hidden)',
].join(',')
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
  '[role="tab"]',
  '.tabBar .tab[role="button"]',
].join(',')

/**
 * Enables navigation with controllers that follow the standard Gamepad mapping.
 *
 * @param {object} options
 * @param {() => void} options.onBack
 * @param {() => void} options.onNavigate
 * @param {() => void} options.onPlayPause
 * @returns {() => void}
 */
export function initializeGamepadNavigation({ onBack, onNavigate, onPlayPause }) {
  if (typeof navigator.getGamepads !== 'function') {
    return () => {}
  }

  /** @type {Map<string, number>} */
  const heldActions = new Map()
  let animationFrame = null
  let stopped = false

  function startPolling() {
    if (animationFrame === null && !stopped) {
      animationFrame = requestAnimationFrame(pollGamepads)
    }
  }

  /** @param {number} timestamp */
  function pollGamepads(timestamp) {
    animationFrame = null
    const gamepads = getConnectedGamepads()

    if (!document.hasFocus()) {
      heldActions.clear()
    } else {
      const pressedActions = getPressedActions(gamepads)

      for (const action of ACTION_ORDER) {
        if (!pressedActions.has(action)) {
          heldActions.delete(action)
          continue
        }

        const nextRepeat = heldActions.get(action)
        if (nextRepeat === undefined) {
          runAction(action)
          heldActions.set(
            action,
            DIRECTION_ACTIONS.has(action) ? timestamp + GAMEPAD_REPEAT_DELAY : Number.POSITIVE_INFINITY
          )
        } else if (timestamp >= nextRepeat) {
          runAction(action)
          heldActions.set(action, timestamp + GAMEPAD_REPEAT_INTERVAL)
        }
      }
    }

    if (gamepads.length > 0 || heldActions.size > 0) {
      startPolling()
    }
  }

  /** @param {string} action */
  function runAction(action) {
    if (DIRECTION_ACTIONS.has(action)) {
      onNavigate()
      moveGamepadFocus(action)
    } else if (action === 'primary') {
      onNavigate()
      activateGamepadFocus()
    } else if (action === 'back') {
      if (!deactivateActiveRangeInput()) {
        onBack()
      }
    } else if (action === 'playPause') {
      onPlayPause()
    }
  }

  window.addEventListener('gamepadconnected', startPolling)
  window.addEventListener('gamepaddisconnected', startPolling)
  startPolling()

  return () => {
    stopped = true
    window.removeEventListener('gamepadconnected', startPolling)
    window.removeEventListener('gamepaddisconnected', startPolling)
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
    }
  }
}

function getConnectedGamepads() {
  try {
    return Array.from(navigator.getGamepads())
      .filter(gamepad => gamepad != null && gamepad.connected !== false)
  } catch {
    return []
  }
}

/** @param {Gamepad[]} gamepads */
function getPressedActions(gamepads) {
  const actions = new Set()

  for (const gamepad of gamepads) {
    for (const [action, buttonIndex] of Object.entries(GAMEPAD_BUTTONS)) {
      const button = gamepad.buttons[buttonIndex]
      if (button?.pressed || button?.value > 0.5) {
        actions.add(action)
      }
    }

    const horizontalAxis = gamepad.axes[0] ?? 0
    const verticalAxis = gamepad.axes[1] ?? 0
    if (Math.abs(horizontalAxis) >= GAMEPAD_AXIS_THRESHOLD) {
      actions.add(horizontalAxis < 0 ? 'left' : 'right')
    }
    if (Math.abs(verticalAxis) >= GAMEPAD_AXIS_THRESHOLD) {
      actions.add(verticalAxis < 0 ? 'up' : 'down')
    }
  }

  return actions
}

/**
 * @param {'up' | 'down' | 'left' | 'right'} direction
 * @returns {boolean}
 */
export function moveGamepadFocus(direction) {
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLInputElement &&
    activeElement.type === 'range' &&
    activeElement.hasAttribute(GAMEPAD_ACTIVE_RANGE_ATTRIBUTE)
  ) {
    if (direction === 'left' || direction === 'right') {
      adjustRangeInput(activeElement, direction)
      return true
    }
  }

  if (
    activeElement instanceof HTMLElement &&
    activeElement.getAttribute('role') === 'combobox' &&
    activeElement.getAttribute('aria-expanded') === 'true'
  ) {
    activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: `Arrow${direction[0].toUpperCase()}${direction.slice(1)}`,
      bubbles: true,
      cancelable: true,
    }))
    return true
  }

  const focusableElements = getFocusableElements()
  if (focusableElements.length === 0) {
    return false
  }

  const currentElement = activeElement instanceof HTMLElement &&
    focusableElements.includes(activeElement) &&
    isVisible(activeElement)
    ? activeElement
    : null
  const nextElement = currentElement === null
    ? focusableElements[0]
    : findSpatialCandidate(currentElement, focusableElements, direction)

  if (nextElement === null) {
    return false
  }

  nextElement.focus({ preventScroll: true, focusVisible: true })
  nextElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return true
}

export function activateGamepadFocus() {
  const activeElement = document.activeElement
  if (
    !(activeElement instanceof HTMLElement) ||
    activeElement === document.body ||
    !isVisible(activeElement)
  ) {
    return moveGamepadFocus('down')
  }

  if (
    activeElement.getAttribute('role') === 'combobox' &&
    activeElement.getAttribute('aria-expanded') === 'true'
  ) {
    activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }))
    return true
  }

  if (activeElement instanceof HTMLInputElement && activeElement.type === 'range') {
    setRangeInputActive(
      activeElement,
      !activeElement.hasAttribute(GAMEPAD_ACTIVE_RANGE_ATTRIBUTE)
    )
    return true
  }

  if (activeElement.matches(GAMEPAD_LAYER_SELECTOR)) {
    return moveGamepadFocus('down')
  }

  const activeLayer = activeElement.closest(GAMEPAD_LAYER_SELECTOR)
  const focusableElements = activeLayer === null ? [] : getFocusableElements(activeLayer)
  const activeIndex = focusableElements.indexOf(activeElement)
  activeElement.click()
  requestAnimationFrame(() => {
    if (
      !activeElement.isConnected &&
      activeLayer instanceof HTMLElement &&
      activeLayer.isConnected &&
      isVisible(activeLayer) &&
      !activeLayer.contains(document.activeElement)
    ) {
      const remainingFocusableElements = getFocusableElements(activeLayer)
      const nextElement = remainingFocusableElements[
        Math.min(Math.max(activeIndex, 0), remainingFocusableElements.length - 1)
      ]
      if (nextElement !== undefined) {
        nextElement.focus({ preventScroll: true, focusVisible: true })
        nextElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }

    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches(GAMEPAD_LAYER_SELECTOR)
    ) {
      moveGamepadFocus('down')
    }
  })
  return true
}

/** @param {Event} event */
function handleRangeInputBlur(event) {
  if (event.currentTarget instanceof HTMLInputElement) {
    setRangeInputActive(event.currentTarget, false)
  }
}

/**
 * @param {HTMLInputElement} input
 * @param {boolean} active
 */
function setRangeInputActive(input, active) {
  if (active) {
    input.setAttribute(GAMEPAD_ACTIVE_RANGE_ATTRIBUTE, 'true')
    input.addEventListener('blur', handleRangeInputBlur, { once: true })
  } else {
    input.removeAttribute(GAMEPAD_ACTIVE_RANGE_ATTRIBUTE)
    input.removeEventListener('blur', handleRangeInputBlur)
  }
}

function deactivateActiveRangeInput() {
  const activeElement = document.activeElement
  if (
    !(activeElement instanceof HTMLInputElement) ||
    activeElement.type !== 'range' ||
    !activeElement.hasAttribute(GAMEPAD_ACTIVE_RANGE_ATTRIBUTE)
  ) {
    return false
  }

  setRangeInputActive(activeElement, false)
  return true
}

/** @param {HTMLElement | null} [navigationRootOverride] */
function getFocusableElements(navigationRootOverride = null) {
  const visibleLayers = Array.from(document.querySelectorAll(GAMEPAD_LAYER_SELECTOR))
    .filter(element => element instanceof HTMLElement && isVisible(element))
  const activeLayer = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest(GAMEPAD_LAYER_SELECTOR)
    : null
  const navigationRoot = navigationRootOverride ?? activeLayer ?? visibleLayers.at(-1) ?? document

  return Array.from(navigationRoot.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
    if (!(element instanceof HTMLElement) || !isVisible(element)) {
      return false
    }
    if (element.matches(':disabled, [aria-disabled="true"]')) {
      return false
    }
    if (element.closest('[inert], [aria-hidden="true"]')) {
      return false
    }

    return element.tabIndex >= 0 ||
      element.getAttribute('role') === 'tab' ||
      element.matches('.tabBar .tab[role="button"]')
  })
}

export function hasVisibleGamepadLayer() {
  return Array.from(document.querySelectorAll(
    `${GAMEPAD_LAYER_SELECTOR}, [aria-expanded="true"][aria-haspopup]`
  )).some(element => element instanceof HTMLElement && isVisible(element))
}

/**
 * @param {HTMLElement} currentElement
 * @param {HTMLElement[]} candidates
 * @param {'up' | 'down' | 'left' | 'right'} direction
 * @returns {HTMLElement | null}
 */
function findSpatialCandidate(currentElement, candidates, direction) {
  const currentRect = currentElement.getBoundingClientRect()
  const currentCenter = getRectCenter(currentRect)
  let closestElement = null
  let closestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    if (candidate === currentElement || currentElement.contains(candidate)) {
      continue
    }

    const candidateRect = candidate.getBoundingClientRect()
    const candidateCenter = getRectCenter(candidateRect)
    const horizontalDistance = candidateCenter.x - currentCenter.x
    const verticalDistance = candidateCenter.y - currentCenter.y
    const isHorizontal = direction === 'left' || direction === 'right'
    const primaryDistance = isHorizontal ? horizontalDistance : verticalDistance
    const pointsInDirection = direction === 'left' || direction === 'up'
      ? primaryDistance < -1
      : primaryDistance > 1

    if (!pointsInDirection) {
      continue
    }

    const crossDistance = Math.abs(isHorizontal ? verticalDistance : horizontalDistance)
    const aligned = isHorizontal
      ? rangesOverlap(currentRect.top, currentRect.bottom, candidateRect.top, candidateRect.bottom)
      : rangesOverlap(currentRect.left, currentRect.right, candidateRect.left, candidateRect.right)
    const score = Math.abs(primaryDistance) + crossDistance * (aligned ? 0.2 : 2) + (aligned ? 0 : 100)

    if (score < closestScore) {
      closestElement = candidate
      closestScore = score
    }
  }

  return closestElement
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

function rangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && secondStart < firstEnd
}

/**
 * @param {HTMLInputElement} input
 * @param {'up' | 'down' | 'left' | 'right'} direction
 */
function adjustRangeInput(input, direction) {
  const minimum = Number(input.min || 0)
  const maximum = Number(input.max || 100)
  const configuredStep = Number(input.step)
  const step = Number.isFinite(configuredStep) && configuredStep > 0
    ? configuredStep
    : (maximum - minimum) / 100
  const increase = direction === 'right' || direction === 'up'
  const currentValue = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : minimum
  const nextValue = Math.min(maximum, Math.max(minimum, currentValue + (increase ? step : -step)))

  input.valueAsNumber = nextValue
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

/** @param {HTMLElement} element */
function isVisible(element) {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse'
}
