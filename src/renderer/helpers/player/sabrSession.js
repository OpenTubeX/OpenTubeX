/**
 * @param {{
 *   activeSabrContextTypes: Set<number>,
 *   sabrContexts: Map<number, object>,
 *   nextRequestPolicy: object | undefined,
 *   playerReloadRequested: boolean,
 *   requestNumber: number
 * }} state
 */
export function resetSabrSessionState(state) {
  state.activeSabrContextTypes.clear()
  state.sabrContexts.clear()
  state.nextRequestPolicy = undefined
  state.playerReloadRequested = false
  state.requestNumber = 0
}
