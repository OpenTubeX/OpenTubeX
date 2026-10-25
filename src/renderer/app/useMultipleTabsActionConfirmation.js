import { computed, ref } from 'vue'

import store from '../store/index'

/**
 * The prompt that confirms closing, loading or unloading several tabs at once,
 * for renderer shortcuts and for requests from the Electron main process.
 *
 * @param {{ t: (key: string, parameters?: Record<string, unknown>, plural?: number) => string }} options
 */
export function useMultipleTabsActionConfirmation({ t }) {
  const multipleTabsActionPrompt = ref(null)
  const multipleTabsActionPromptCount = ref(0)

  const MULTIPLE_TABS_ACTION_PROMPT_VALUES = ['confirm', 'cancel', 'neverAskAgain']

  /** @type {((confirmed: boolean) => void) | null} */
  let multipleTabsActionPromptResolve = null
  /** @type {Promise<boolean> | null} */
  let multipleTabsActionPromptPromise = null

  const multipleTabsActionPromptTitle = computed(() => {
    if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Title')
    if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Title')
    return t('Close Multiple Tabs Confirmation.Title')
  })
  const multipleTabsActionPromptMessage = computed(() => {
    const count = multipleTabsActionPromptCount.value
    const parameters = { count }
    if (multipleTabsActionPrompt.value === 'load') return t('Load Multiple Tabs Confirmation.Message', parameters, count)
    if (multipleTabsActionPrompt.value === 'unload') return t('Unload Multiple Tabs Confirmation.Message', parameters, count)
    return t('Close Multiple Tabs Confirmation.Message', parameters, count)
  })
  const multipleTabsActionPromptNames = computed(() => [
    multipleTabsActionPrompt.value === 'load'
      ? t(
          'Load Multiple Tabs Confirmation.Load Tabs',
          { count: multipleTabsActionPromptCount.value },
          multipleTabsActionPromptCount.value
        )
      : multipleTabsActionPrompt.value === 'unload'
        ? t(
            'Unload Multiple Tabs Confirmation.Unload Tabs',
            { count: multipleTabsActionPromptCount.value },
            multipleTabsActionPromptCount.value
          )
        : t(
            'Close Multiple Tabs Confirmation.Close Tabs',
            { count: multipleTabsActionPromptCount.value },
            multipleTabsActionPromptCount.value
          ),
    t('Cancel'),
    t('Confirmations.Never Ask Again')
  ])

  /**
   * @param {'close' | 'load' | 'unload'} action
   */
  function isMultipleTabsActionConfirmationEnabled(action) {
    if (action === 'load') return store.getters.getConfirmLoadMultipleTabs
    if (action === 'unload') return store.getters.getConfirmUnloadMultipleTabs
    return store.getters.getConfirmCloseMultipleTabs
  }

  /**
   * @param {'close' | 'load' | 'unload'} action
   */
  function disableMultipleTabsActionConfirmation(action) {
    if (action === 'load') return store.dispatch('updateConfirmLoadMultipleTabs', false)
    if (action === 'unload') return store.dispatch('updateConfirmUnloadMultipleTabs', false)
    return store.dispatch('updateConfirmCloseMultipleTabs', false)
  }

  /**
   * Ask the user to confirm an action affecting several tabs at once. Concurrent
   * requests for the same action share one prompt; a different action is rejected.
   * @param {number} count
   * @param {'close' | 'load' | 'unload'} action
   * @returns {Promise<boolean>}
   */
  function confirmMultipleTabsAction(count, action) {
    if (!isMultipleTabsActionConfirmationEnabled(action)) return Promise.resolve(true)

    if (multipleTabsActionPromptPromise) {
      if (multipleTabsActionPrompt.value !== action) return Promise.resolve(false)

      multipleTabsActionPromptCount.value = Math.max(multipleTabsActionPromptCount.value, count)
      return multipleTabsActionPromptPromise
    }

    multipleTabsActionPrompt.value = action
    multipleTabsActionPromptCount.value = count
    multipleTabsActionPromptPromise = new Promise(resolve => {
      multipleTabsActionPromptResolve = resolve
    })
    return multipleTabsActionPromptPromise
  }

  /**
   * @param {'confirm' | 'cancel' | 'neverAskAgain' | null} option
   */
  async function handleMultipleTabsActionPromptAnswer(option) {
    const action = multipleTabsActionPrompt.value
    multipleTabsActionPrompt.value = null
    multipleTabsActionPromptCount.value = 0
    const resolve = multipleTabsActionPromptResolve
    multipleTabsActionPromptResolve = null
    multipleTabsActionPromptPromise = null
    if (option === 'neverAskAgain' && action != null) {
      try {
        await disableMultipleTabsActionConfirmation(action)
      } catch (error) {
        console.error('Failed to disable the bulk tab action confirmation', error)
      }
    }
    resolve?.(option === 'confirm' || option === 'neverAskAgain')
  }

  /**
   * @param {{ requestId: string, count: number, action: 'close' | 'load' | 'unload' }} request
   */
  async function handleConfirmMultipleTabsActionRequest({ requestId, count, action }) {
    const confirmed = await confirmMultipleTabsAction(count, action)
    window.ftElectron.tabs.respondConfirmMultipleAction(requestId, confirmed)
  }

  return {
    multipleTabsActionPrompt,
    MULTIPLE_TABS_ACTION_PROMPT_VALUES,
    multipleTabsActionPromptTitle,
    multipleTabsActionPromptMessage,
    multipleTabsActionPromptNames,
    confirmMultipleTabsAction,
    handleMultipleTabsActionPromptAnswer,
    handleConfirmMultipleTabsActionRequest
  }
}
