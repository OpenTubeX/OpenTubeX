// @ts-check
import { getDataScope } from '../../datastores/handlers/dataScope.js'

/**
 * Wraps the actions of a store module whose state shows the data of the
 * active data scope, see `getDataScope`. Each action's commits only apply
 * while the scope it started in is still active, so a write that finishes
 * after a switch to another profile can't show up in that profile's data.
 * @param {Record<string, (context: any, payload?: any) => any> | undefined} actions
 * @returns {Record<string, (context: any, payload?: any) => any>}
 */
export function scopedActions(actions) {
  return Object.fromEntries(Object.entries(actions ?? {}).map(([name, action]) => [name, (context, payload) => {
    const scope = getDataScope()
    /** @param {...any} args */
    const commit = (...args) => {
      if (scope === getDataScope()) context.commit(...args)
    }
    return action({ ...context, commit }, payload)
  }]))
}
