/**
 * Provided by the app root: `{ confirm(count, action): Promise<boolean>, open: Ref<boolean> }`.
 * Mobile tab surfaces share the desktop prompt for actions affecting several tabs.
 * @type {import('vue').InjectionKey<{ confirm: (count: number, action: 'close' | 'load' | 'unload') => Promise<boolean>, open: import('vue').Ref<boolean> }>}
 */
export const multipleTabsActionConfirmationKey = Symbol('multipleTabsActionConfirmation')
