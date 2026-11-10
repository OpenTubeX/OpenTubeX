import { onScopeDispose, ref } from 'vue'

/** Whether the system currently prefers a dark color scheme, updated while the calling scope lives. */
export function useSystemDarkMode() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const dark = ref(query.matches)
  const update = event => { dark.value = event.matches }
  query.addEventListener('change', update)
  onScopeDispose(() => query.removeEventListener('change', update))
  return dark
}
