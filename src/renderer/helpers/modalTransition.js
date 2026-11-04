import { Comment, setTransitionHooks } from 'vue'

/**
 * @param {Element} element
 * @param {() => void} remove
 */
async function leave(element, remove) {
  // Android predictive Back already played the exit and suppresses the leave
  // animation, then restores the styles once the modal should be gone.
  if (element instanceof HTMLElement && element.style.animationName === 'none') {
    remove()
    return
  }
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
  remove()
}

/** @type {import('vue').TransitionHooks} */
const hooks = {
  mode: 'default',
  persisted: false,
  beforeEnter() {},
  enter() {},
  leave,
  clone: () => hooks
}

/**
 * Keeps a modal backdrop, whose first child is the dialog, in the document
 * while its `modal-leave-active` animations play. Unlike `<Transition>`, this
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
