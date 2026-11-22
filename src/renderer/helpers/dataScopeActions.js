// @ts-check
import { getDataScope } from '../../datastores/handlers/dataScope.js'

/** @type {Set<Promise<unknown>>} */
const running = new Set()

/**
 * Wraps the actions of a store module whose state shows the data of the
 * active data scope, see `getDataScope`. A profile switch waits for the
 * running ones, see `settleScopedActions`. Their commits only apply while the
 * scope they started in is still active, so a write that finishes after a
 * switch can't show up in the other profile's data.
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
    const result = Promise.resolve(action({ ...context, commit }, payload))
    running.add(result)
    result.finally(() => running.delete(result)).catch(() => {})
    return result
  }]))
}

/**
 * Resolves once no wrapped action runs, including ones started meanwhile.
 * @template T
 * @param {() => T} [then] Runs as soon as none runs, before another can start
 * @returns {Promise<T | undefined>}
 */
export async function settleScopedActions(then) {
  while (running.size > 0) await Promise.allSettled([...running])
  return then?.()
}
