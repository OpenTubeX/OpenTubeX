<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="lightsOffOverlay"
      aria-hidden="true"
    >
      <div :style="holeStyle" />
    </div>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

const props = defineProps({
  player: { type: Object, default: null }
})

const holeStyle = ref({})
const overlay = useTemplateRef('overlay')
const animations = new Set()
let animationFrame = 0
let mounted = false
let resizeObserver
let mutationObserver

function scheduleUpdate() {
  if (mounted && !animationFrame) animationFrame = requestAnimationFrame(updateHole)
}

function trackAnimation(event) {
  const target = event.target
  const player = props.player
  if (!(target instanceof Element) || !player ||
    !(target === player || target.contains(player) || target.matches('.topNav, .tabBar, .sideNav'))) return

  collectAnimations(target)
  scheduleUpdate()
}

function collectAnimations(target) {
  for (const animation of target.getAnimations()) {
    if (animation.playState !== 'running' || animations.has(animation) || !Number.isFinite(animation.effect?.getComputedTiming().endTime)) continue
    animations.add(animation)
    const finish = () => {
      animations.delete(animation)
      scheduleUpdate()
    }
    animation.finished.then(finish, finish)
  }
}

// Track rendered geometry, including mini-player animations and fractional UI
// scales. A body-level shadow dims every stacking context without intercepting
// clicks or changing the player's own layout or stacking order.
function updateHole() {
  animationFrame = 0
  const player = props.player
  if (player?.isConnected) {
    // Layout changes also start WAAPI motion, which emits no CSS animation
    // events. Capture those animations on the scheduled layout measurement.
    collectAnimations(player)
    const rect = player.getBoundingClientRect()
    let { left, top, right, bottom } = rect
    for (let parent = player.parentElement; parent; parent = parent.parentElement) {
      collectAnimations(parent)
      const style = getComputedStyle(parent)
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const clip = parent.getBoundingClientRect()
        if (style.overflowX !== 'visible') {
          left = Math.max(left, clip.left)
          right = Math.min(right, clip.right)
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, clip.top)
          bottom = Math.min(bottom, clip.bottom)
        }
      }
    }
    // Keep the shadow anchored to the viewport when the player scrolls fully
    // off screen with the scroll mini player disabled.
    left = Math.max(0, Math.min(innerWidth, left))
    right = Math.max(0, Math.min(innerWidth, right))
    top = Math.max(0, Math.min(innerHeight, top))
    bottom = Math.max(0, Math.min(innerHeight, bottom))
    // Sticky navigation can cover the normal player. Hit-test the overlap so
    // mini/full-window players that render above that chrome remain bright.
    for (const chrome of document.querySelectorAll('.topNav, .tabBar, .sideNav')) {
      collectAnimations(chrome)
      const bounds = chrome.getBoundingClientRect()
      const overlapLeft = Math.max(left, bounds.left)
      const overlapRight = Math.min(right, bounds.right)
      const overlapTop = Math.max(top, bounds.top)
      const overlapBottom = Math.min(bottom, bounds.bottom)
      if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) continue
      const foreground = document.elementFromPoint(
        (overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2
      )
      if (!chrome.contains(foreground)) continue
      if (bounds.width >= bounds.height) {
        if (bounds.top < innerHeight - bounds.bottom) top = Math.max(top, bounds.bottom)
        else bottom = Math.min(bottom, bounds.top)
      } else {
        if (bounds.left < innerWidth - bounds.right) left = Math.max(left, bounds.right)
        else right = Math.min(right, bounds.left)
      }
    }
    const nextStyle = {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.max(0, right - left)}px`,
      height: `${Math.max(0, bottom - top)}px`,
    }
    if (Object.keys(nextStyle).some(key => nextStyle[key] !== holeStyle.value[key])) {
      holeStyle.value = nextStyle
    }
  }
  if (animations.size > 0) scheduleUpdate()
}

onMounted(() => {
  mounted = true
  resizeObserver = new ResizeObserver(scheduleUpdate)
  for (let element = props.player; element; element = element.parentElement) {
    resizeObserver.observe(element)
  }
  for (const chrome of document.querySelectorAll('.topNav, .tabBar, .sideNav')) {
    resizeObserver.observe(chrome)
  }
  // Changes outside the player can move it without changing its own size.
  // Ignore the dimmer itself and playback UI updates inside the player.
  mutationObserver = new MutationObserver(records => {
    if (records.some(({ target }) => !overlay.value?.contains(target) &&
      (target === props.player || !props.player?.contains(target)))) scheduleUpdate()
  })
  mutationObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })
  window.addEventListener('scroll', scheduleUpdate, true)
  window.addEventListener('resize', scheduleUpdate)
  document.addEventListener('transitionrun', trackAnimation, true)
  document.addEventListener('animationstart', trackAnimation, true)
  scheduleUpdate()
})
onBeforeUnmount(() => {
  mounted = false
  cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  animations.clear()
  window.removeEventListener('scroll', scheduleUpdate, true)
  window.removeEventListener('resize', scheduleUpdate)
  document.removeEventListener('transitionrun', trackAnimation, true)
  document.removeEventListener('animationstart', trackAnimation, true)
})
</script>

<style scoped src="./LightsOffOverlay.css" />
