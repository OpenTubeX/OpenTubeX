// @ts-check

/** Icons that mark a toast as reporting an error or warning */
const ALERT_TOAST_ICONS = new Set(['circle-exclamation', 'triangle-exclamation'])

/**
 * Whether a toast still appears when the user only wants important
 * notifications: errors and warnings, toasts that offer an action such as
 * Undo, and toasts marked important, such as reminders the user set up.
 *
 * @param {object} toast
 * @param {[string, string] | null} [toast.icon]
 * @param {Function | null} [toast.action]
 * @param {unknown[] | null} [toast.buttons]
 * @param {string | null} [toast.buttonAction]
 * @param {boolean} [toast.important]
 * @returns {boolean}
 */
export function isImportantToast({ icon, action, buttons, buttonAction, important }) {
  return important === true ||
    action != null ||
    (buttons?.length ?? 0) > 0 ||
    buttonAction != null ||
    ALERT_TOAST_ICONS.has(icon?.[1] ?? '')
}
