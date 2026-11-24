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
 * @param {HTMLElement} button
 * @returns {{ element: HTMLElement, release: () => void }}
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
  return { element, release: () => render(null, thumb) }
}
