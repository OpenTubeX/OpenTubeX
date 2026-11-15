import { Comment, setTransitionHooks } from 'vue'
import { takeOverLeavingModalBackdrop, trackLeavingModalBackdrop } from './modalBackdropHandoff'

/** @type {WeakMap<Element, () => void>} */
const afterLeaveCallbacks = new WeakMap()

/**
 * Runs `callback` once the leaving modal is removed, after its exit animation.
 * Register it before the modal starts leaving, such as on before-unmount.
 * @param {Element} element
 * @param {() => void} callback
 */
export function afterModalLeave(element, callback) {
  afterLeaveCallbacks.set(element, callback)
}

/**
 * @param {Element} element
 * @param {() => void} removeElement
 */
async function leave(element, removeElement) {
  const remove = () => {
    removeElement()
    afterLeaveCallbacks.get(element)?.()
    afterLeaveCallbacks.delete(element)
  }
  // Android predictive Back already played the exit and suppresses the leave
  // animation, then restores the styles once the modal should be gone.
  if (element instanceof HTMLElement && element.style.animationName === 'none') {
    remove()
    return
  }
  const release = element instanceof HTMLElement ? trackLeavingModalBackdrop(element) : () => {}
  element.classList.add('modal-leave-active')
  // A closing modal must not take input meant for what it uncovers. Inert only
  // moves focus out on the next rendering update, but focus restoration and
  // shortcut handlers expect it to leave with the modal, as on removal.
  if (element instanceof HTMLElement) element.inert = true
  if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) {
    document.activeElement.blur()
  }
  element.setAttribute('aria-hidden', 'true')
  // Await the animations instead of their CSS duration, since the animation
  // speed setting changes their playback rate.
  const dialog = element.firstElementChild
  const animations = element.getAnimations?.({ subtree: true })
    .filter(animation => animation.effect?.target === element || animation.effect?.target === dialog) ?? []
  await Promise.allSettled(animations.map(animation => animation.finished))
  release()
  remove()
}

/**
 * The backdrop's enter keyframes start from these properties when set.
 * @param {Element} element
 */
function enter(element) {
  if (!(element instanceof HTMLElement)) return
  const from = takeOverLeavingModalBackdrop(element)
  if (!from) return
  element.style.setProperty('--modal-backdrop-enter-color', from.backgroundColor)
  element.style.setProperty('--modal-backdrop-enter-filter', from.backdropFilter)
}

/** @type {import('vue').TransitionHooks} */
const hooks = {
  mode: 'default',
  persisted: false,
  beforeEnter() {},
  enter,
  leave,
  clone: () => hooks
}

/**
 * Keeps a modal backdrop, whose first child is the dialog, in the document
 * while its `modal-leave-active` animations play, and lets a modal that opens
 * meanwhile take over its dim and blur. Unlike `<Transition>`, this
 * also runs when the component rendering the modal unmounts, which is how
 * parents close modals.
 */
export const ModalLeaveTransition = {
  name: 'ModalLeaveTransition',
  setup(_, { slots }) {
    return () => {
      const child = slots.default?.().find(vnode => vnode.type !== Comment)
      if (child) setTransitionHooks(child, hooks)
      return child
    }
  }
}
