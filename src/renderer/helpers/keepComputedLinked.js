import { effect, effectScope } from 'vue'

const linked = new WeakSet()
const scope = effectScope(true)

/**
 * Keeps a shared computed subscribed to its dependencies between the pages
 * that read it.
 *
 * When the last subscriber of a computed unmounts, Vue unlinks the computed
 * from each of its dependencies, and the next mount links them all again. For
 * a computed over a large store, such as one that reads a field of every
 * cached entry, that costs phones over 100 ms on each page switch. A
 * subscriber that never reruns keeps them linked, and the computed still
 * recomputes only when read after a change.
 *
 * @param {import('vue').ComputedRef<unknown>} source a computed that outlives the pages
 */
export function keepComputedLinked(source) {
  if (linked.has(source)) return
  linked.add(source)
  scope.run(() => effect(() => source.value, { scheduler() {} }))
}
