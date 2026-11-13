// @ts-check

/** Icons that mark a toast as reporting an error or warning */
const ALERT_TOAST_ICONS = new Set(['circle-exclamation', 'triangle-exclamation'])

/**
 * Whether a toast still appears when the user only wants important
 * notifications: errors and warnings, toasts that ask for a decision through
 * buttons, and toasts marked important, such as reminders the user set up.
 * Confirmations that only offer Undo, by clicking the toast or an Undo
 * button, are routine.
 *
 * @param {object} toast
 * @param {[string, string] | null} [toast.icon]
 * @param {{ icon?: [string, string] }[] | null} [toast.buttons]
 * @param {string | null} [toast.buttonAction]
 * @param {boolean} [toast.important]
 * @returns {boolean}
 */
export function isImportantToast({ icon, buttons, buttonAction, important }) {
  return important === true ||
    (buttons ?? []).some(button => button.icon?.[1] !== 'undo') ||
    buttonAction != null ||
    ALERT_TOAST_ICONS.has(icon?.[1] ?? '')
}
