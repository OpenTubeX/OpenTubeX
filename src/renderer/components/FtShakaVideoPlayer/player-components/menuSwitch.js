import { defineComponent, h, render } from 'vue'
import { Icon } from '@iconify/vue/offline'
import { resolveIconifyId } from '../../../icons/resolveIconifyId'

/** The thumb icons of the app's switches (`FtToggleSwitch`), in the current icon pack. */
const MenuSwitchIcons = defineComponent({
  render: () => [
    h(Icon, { class: 'ft-menu-switch-on-icon', icon: resolveIconifyId(['fas', 'check']) }),
    h(Icon, { class: 'ft-menu-switch-off-icon', icon: resolveIconifyId(['fas', 'minus']) }),
  ],
})

/**
 * Adds the switch that the player menu's list shows for a toggle, after its
 * label. It follows the state the button reports through `aria-pressed` or
 * `ft-active`, and the tiles and the control bar hide it.
 *
 * The button carries `ft-menu-switch-shown` while the switch shows, so the
 * menu can hide the On and Off text without a `:has()`, which would restyle
 * every entry's label whenever any entry changes.
 * @param {HTMLElement} button
 * @returns {{ element: HTMLElement, setShown: (shown: boolean) => void, release: () => void }}
 */
export function appendMenuSwitch(button) {
  const element = document.createElement('span')
  element.classList.add('ft-menu-switch')
  element.ariaHidden = 'true'

  const thumb = document.createElement('span')
  thumb.classList.add('ft-menu-switch-thumb')
  element.appendChild(thumb)
  render(h(MenuSwitchIcons), thumb)

  button.appendChild(element)
  button.classList.add('ft-menu-switch-shown')
  return {
    element,
    setShown: shown => {
      element.hidden = !shown
      button.classList.toggle('ft-menu-switch-shown', shown)
    },
    release: () => render(null, thumb),
  }
}
