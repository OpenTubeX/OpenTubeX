import { clampOverlayScrollLeft } from '../../../helpers/overlayScrollbars'

/**
 * OpenTubeX's control bar decoration and adaptive layout: groups the volume and time controls,
 * adds the glass backgrounds, and applies compact modes in priority order while the bar overflows.
 *
 * @param {{
 *   container: import('vue').Ref<HTMLElement | null>,
 *   events: EventTarget,
 *   isActiveTab: import('vue').Ref<boolean>,
 *   scrollMiniPlayerActive: import('vue').Ref<boolean>,
 *   scrollMiniPlayerAnimating: import('vue').Ref<boolean>,
 *   scrollMiniPlayerDragStyle: import('vue').Ref<object | null>
 * }} options
 */
export function useAdaptiveControlPanelLayout({
  container,
  events,
  isActiveTab,
  scrollMiniPlayerActive,
  scrollMiniPlayerAnimating,
  scrollMiniPlayerDragStyle,
}) {
  /** @type {ResizeObserver|null} */
  let controlPanelResizeObserver = null

  /** @type {MutationObserver|null} */
  let controlPanelMutationObserver = null

  /** @type {AbortController|null} */
  let volumePointerListeners = null

  /** @type {number|null} */
  let controlPanelLayoutFrame = null

  // Whether the scheduled layout must measure again, rather than only check
  // that the panel's new size still fits the current compact modes.
  let controlPanelMeasurementPending = false

  // The panel's width at the last measurement, where every less compact
  // layout overflowed.
  let measuredControlPanelWidth = 0

  const controlPanelCompactClasses = [
    'ft-controls-hide-highlight-label',
    'ft-controls-compact-chapters',
    'ft-controls-stack-times',
    'ft-controls-overflow-pip',
    'ft-controls-overflow-captions'
  ]

  /**
   * @param {HTMLElement} controlPanel
   * @returns {boolean}
   */
  function controlPanelOverflows(controlPanel) {
    let contentWidth = 0
    let crossesPanelEdge = false
    const controlPanelBounds = controlPanel.getBoundingClientRect()
    // Full-window transitions scale the player container. Keep margins in
    // the same visual coordinate space as the bounding rectangles so a
    // measurement during the animation does not leave the compact layout
    // enabled after the transition.
    const inlineScale = controlPanel.clientWidth > 0
      ? controlPanelBounds.width / controlPanel.clientWidth
      : 1

    for (const child of controlPanel.children) {
      if (!(child instanceof HTMLElement)) {
        continue
      }

      const style = window.getComputedStyle(child)
      if (style.display === 'none' || style.position === 'absolute') {
        continue
      }

      const childBounds = child.getBoundingClientRect()
      crossesPanelEdge ||= childBounds.left < controlPanelBounds.left - 1 ||
        childBounds.right > controlPanelBounds.right + 1

      contentWidth += childBounds.width +
        ((Number.parseFloat(style.marginLeft) || 0) * inlineScale) +
        ((Number.parseFloat(style.marginRight) || 0) * inlineScale)
    }

    return crossesPanelEdge ||
      contentWidth > controlPanelBounds.width + inlineScale
  }

  /**
   * Whether a resized panel keeps its compact modes: they still fit, and none
   * can be dropped, either because none is applied or because the panel is no
   * wider than when the less compact layouts last overflowed. Dragging the
   * fullscreen dock's edge resizes the panel every frame, and measuring a copy
   * each time restyles the whole control bar.
   * @param {HTMLElement} controlPanel
   */
  function controlPanelLayoutStillFits(controlPanel) {
    const compact = controlPanelCompactClasses.some(compactClass => controlPanel.classList.contains(compactClass))
    return (!compact || controlPanel.clientWidth <= measuredControlPanelWidth) &&
      !controlPanelOverflows(controlPanel)
  }

  /**
   * Apply space-saving modes in priority order, only when the next mode is needed.
   * @param {HTMLElement} controlPanel
   * @param {boolean} [measure] whether to measure even if the current modes still fit
   */
  function updateControlPanelLayout(controlPanel, measure = true) {
    if (!controlPanel.isConnected) {
      return
    }

    if (measure || !controlPanelLayoutStillFits(controlPanel)) {
      measureControlPanelLayout(controlPanel)
    }

    const quickRateBar = controlPanel.querySelector('.ft-quick-playback-rate-bar')
    if (quickRateBar) {
      clampOverlayScrollLeft(quickRateBar)
    }

    // Pill ends must follow the visible controls, including buttons hidden
    // by the adaptive layout rather than by Shaka's own visibility class.
    for (const button of controlPanel.querySelectorAll(':scope > .shaka-spacer ~ button')) {
      button.toggleAttribute('data-ft-control-hidden', window.getComputedStyle(button).display === 'none')
    }

    updateRightControlGlass(controlPanel)
  }

  /** @param {HTMLElement} controlPanel */
  function measureControlPanelLayout(controlPanel) {
    measuredControlPanelWidth = controlPanel.clientWidth

    // Measure a hidden copy so intermediate compact states do not interrupt
    // chapter transitions or change the preset strip's scroll position.
    const measurementPanel = /** @type {HTMLElement} */ (controlPanel.cloneNode(true))
    measurementPanel.classList.add('ft-controls-measuring')
    measurementPanel.classList.remove(...controlPanelCompactClasses)
    measurementPanel.ariaHidden = 'true'
    measurementPanel.inert = true
    measurementPanel.style.position = 'absolute'
    measurementPanel.style.visibility = 'hidden'
    measurementPanel.style.width = window.getComputedStyle(controlPanel).width

    // A clone does not inherit the real volume group's hover/focus state.
    const volumeGroup = controlPanel.querySelector('.ft-volume-control-group')
    const measurementVolumeGroup = measurementPanel.querySelector('.ft-volume-control-group')
    if (volumeGroup && measurementVolumeGroup instanceof HTMLElement) {
      measurementVolumeGroup.style.width = window.getComputedStyle(volumeGroup).width
    }
    controlPanel.after(measurementPanel)

    for (const compactClass of controlPanelCompactClasses) {
      if (!controlPanelOverflows(measurementPanel)) {
        break
      }

      measurementPanel.classList.add(compactClass)
    }

    for (const compactClass of controlPanelCompactClasses) {
      controlPanel.classList.toggle(compactClass, measurementPanel.classList.contains(compactClass))
    }
    measurementPanel.remove()
  }

  /** @param {HTMLElement} controlPanel */
  function updateRightControlGlass(controlPanel) {
    const rightGlass = controlPanel.querySelector(':scope > .ft-right-control-glass')
    if (rightGlass instanceof HTMLElement) {
      const rightButtons = [...controlPanel.querySelectorAll(':scope > .shaka-spacer ~ button:not(.shaka-hidden)')]
        .filter(button => button.getClientRects().length > 0)
      rightGlass.hidden = rightButtons.length === 0

      if (rightButtons.length > 0) {
        const panelBounds = controlPanel.getBoundingClientRect()
        const firstBounds = rightButtons[0].getBoundingClientRect()
        const lastBounds = rightButtons[rightButtons.length - 1].getBoundingClientRect()
        const scale = controlPanel.clientWidth > 0 ? panelBounds.width / controlPanel.clientWidth : 1
        rightGlass.style.left = `${(firstBounds.left - panelBounds.left) / scale}px`
        rightGlass.style.width = `${(lastBounds.right - firstBounds.left) / scale}px`
      }
    }
  }

  /**
   * @param {HTMLElement} controlPanel
   * @param {boolean} [panelResized] whether only the panel's own size changed
   */
  function scheduleControlPanelLayout(controlPanel, panelResized = false) {
    // Background tabs remain mounted but are hidden with display:none. Do not
    // let their zero-size control bars enter a resize/mutation feedback loop.
    // The active-tab watcher schedules a fresh measurement when presented.
    if (!isActiveTab.value || scrollMiniPlayerActive.value || scrollMiniPlayerAnimating.value || scrollMiniPlayerDragStyle.value) {
      return
    }

    if (!panelResized) {
      controlPanelMeasurementPending = true
    }

    if (controlPanelLayoutFrame !== null) {
      cancelAnimationFrame(controlPanelLayoutFrame)
    }

    controlPanelLayoutFrame = requestAnimationFrame(() => {
      controlPanelLayoutFrame = null
      // Native picture-in-picture hides the controls. Measuring a copy of the
      // hidden panel would only force style recalculations while the window
      // enters picture-in-picture; showing the panel again resizes it, which
      // measures then.
      if (controlPanel.getClientRects().length === 0) {
        controlPanelMeasurementPending = true
        return
      }
      if (!scrollMiniPlayerActive.value && !scrollMiniPlayerAnimating.value && !scrollMiniPlayerDragStyle.value) {
        const measure = controlPanelMeasurementPending
        controlPanelMeasurementPending = false
        updateControlPanelLayout(controlPanel, measure)
      }
    })
  }

  function setupAdaptiveControlPanelLayout() {
    controlPanelResizeObserver?.disconnect()
    controlPanelMutationObserver?.disconnect()
    volumePointerListeners?.abort()
    volumePointerListeners = null

    const controlPanel = container.value?.querySelector('.shaka-controls-button-panel')
    if (!(controlPanel instanceof HTMLElement)) {
      return
    }

    const muteButton = controlPanel.querySelector(':scope > .shaka-mute-button')
    const volumeBar = controlPanel.querySelector(':scope > .shaka-volume-bar-container')

    if (muteButton instanceof HTMLElement && volumeBar instanceof HTMLElement) {
      const volumeGroup = document.createElement('div')
      volumeGroup.classList.add('ft-volume-control-group')
      muteButton.before(volumeGroup)
      volumeGroup.append(muteButton, volumeBar)

      let focusedByPointer = false
      const blurPointerFocus = () => {
        if (!focusedByPointer) return
        if (volumeGroup.contains(document.activeElement)) {
          document.activeElement.blur()
        }
        focusedByPointer = false
      }
      volumeGroup.addEventListener('pointerdown', () => {
        focusedByPointer = true
        volumePointerListeners?.abort()
        volumePointerListeners = new AbortController()
        window.addEventListener('pointerup', (event) => {
          const bounds = volumeGroup.getBoundingClientRect()
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
              event.clientY < bounds.top || event.clientY > bounds.bottom) {
            blurPointerFocus()
          }
          volumePointerListeners?.abort()
          volumePointerListeners = null
        }, { signal: volumePointerListeners.signal })
        window.addEventListener('pointercancel', () => {
          blurPointerFocus()
          volumePointerListeners?.abort()
          volumePointerListeners = null
        }, { signal: volumePointerListeners.signal })
      })
      volumeGroup.addEventListener('pointerleave', (event) => {
        if (event.buttons === 0) blurPointerFocus()
      })
      volumeGroup.addEventListener('keydown', () => { focusedByPointer = false })
    }

    const regularTime = controlPanel.querySelector(':scope > .shaka-current-time:not(.ft-playback-adjusted-time)')
    const adjustedTime = controlPanel.querySelector(':scope > .ft-playback-adjusted-time')

    if (regularTime instanceof HTMLElement && adjustedTime instanceof HTMLElement) {
      const timeDisplayGroup = document.createElement('div')
      timeDisplayGroup.classList.add('ft-time-display-group')
      regularTime.before(timeDisplayGroup)
      timeDisplayGroup.append(regularTime, adjustedTime)
      timeDisplayGroup.addEventListener('click', (event) => {
        if (event.target !== regularTime) {
          regularTime.click()
          return
        }

        events.dispatchEvent(new CustomEvent('timeDisplayToggled'))
      })
    }

    for (const control of controlPanel.querySelectorAll(':scope > button, :scope > .ft-volume-control-group, :scope > .ft-time-display-group')) {
      if (control.querySelector(':scope > .ft-control-glass')) {
        continue
      }
      const glass = document.createElement('span')
      glass.classList.add('ft-control-glass')
      glass.setAttribute('aria-hidden', 'true')
      control.append(glass)
    }

    const spacer = controlPanel.querySelector(':scope > .shaka-spacer')
    if (spacer instanceof HTMLElement && !controlPanel.querySelector(':scope > .ft-right-control-glass')) {
      const rightGlass = document.createElement('span')
      rightGlass.classList.add('ft-right-control-glass')
      rightGlass.setAttribute('aria-hidden', 'true')
      rightGlass.hidden = true
      spacer.after(rightGlass)
    }

    const timeDisplayGroup = controlPanel.querySelector('.ft-time-display-group')
    controlPanelResizeObserver = new ResizeObserver(entries => {
      if (entries.some(entry => entry.target === timeDisplayGroup)) {
        scheduleControlPanelLayout(controlPanel)
      } else if (entries.some(entry => entry.target === controlPanel)) {
        scheduleControlPanelLayout(controlPanel, true)
      }
      // A control that resized on its own, such as the volume slider closing
      // after hover, changes what fits, so the panel's next resize measures
      // again instead of keeping its compact modes. The preset strip only
      // shrinks along with the panel.
      if (entries.some(({ target }) => target !== controlPanel && target !== timeDisplayGroup &&
        !target.classList.contains('ft-quick-playback-rate-bar'))) {
        measuredControlPanelWidth = 0
      }
      // Button visibility and volume/preset sizes can move the right controls
      // without resizing the panel. Keep their glass aligned with the buttons.
      updateRightControlGlass(controlPanel)
    })
    controlPanelResizeObserver.observe(controlPanel)
    for (const control of controlPanel.querySelectorAll(':scope > button, :scope > .ft-volume-control-group, :scope > .ft-quick-playback-rate-bar')) {
      controlPanelResizeObserver.observe(control)
    }
    if (timeDisplayGroup) {
      // Tabular timestamps usually change text without changing width.
      // Measure only when the rendered group actually changes size.
      controlPanelResizeObserver.observe(timeDisplayGroup)
    }

    controlPanelMutationObserver = new MutationObserver(mutations => {
      if (mutations.some(mutation => {
        const target = mutation.target
        if (target === controlPanel || target instanceof SVGElement ||
          (mutation.type !== 'attributes' && timeDisplayGroup?.contains(target))) {
          return false
        }
        // Shaka replaces icon paths and reapplies classes on media events.
        // Neither an icon update nor an unchanged class affects geometry.
        return mutation.type !== 'attributes' || mutation.oldValue !== target.getAttribute('class')
      })) {
        scheduleControlPanelLayout(controlPanel)
      }
    })
    controlPanelMutationObserver.observe(controlPanel, {
      attributeFilter: ['class'],
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      childList: true,
      subtree: true
    })

    scheduleControlPanelLayout(controlPanel)
  }

  function cancelControlPanelLayout() {
    if (controlPanelLayoutFrame !== null) {
      cancelAnimationFrame(controlPanelLayoutFrame)
      controlPanelLayoutFrame = null
    }
  }

  function destroyAdaptiveControlPanelLayout() {
    if (controlPanelResizeObserver) {
      controlPanelResizeObserver.disconnect()
      controlPanelResizeObserver = null
    }

    if (controlPanelMutationObserver) {
      controlPanelMutationObserver.disconnect()
      controlPanelMutationObserver = null
    }

    volumePointerListeners?.abort()
    volumePointerListeners = null

    cancelControlPanelLayout()
  }

  return {
    cancelControlPanelLayout,
    destroyAdaptiveControlPanelLayout,
    scheduleControlPanelLayout,
    setupAdaptiveControlPanelLayout,
  }
}
