import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * @typedef {import('../../platforms/types').Platform} Platform
 * @typedef {import('../../platforms/types').PlatformFilters} PlatformFilters
 * @typedef {import('../../platforms/types').PlatformFilterOptions} PlatformFilterOptions
 */

/**
 * @param {unknown} value a query value, which repeats for several values
 * @returns {string[]}
 */
function queryList(value) {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter(item => typeof item === 'string' && item !== ''))]
}

/**
 * The filters of a platform's list. They stay in the address, so back and
 * reload return to them, and only the values the list takes count.
 * @param {import('vue').Ref<Platform | null | undefined>} platform
 * @param {import('vue').Ref<PlatformFilterOptions | null | undefined>} options
 */
export function usePlatformFilters(platform, options) {
  const route = useRoute()
  const router = useRouter()

  /** @type {import('vue').ComputedRef<PlatformFilters>} */
  const filters = computed(() => {
    const available = options.value
    if (!available) return {}
    const { sort, type } = route.query
    return {
      sort: available.sorts.includes(/** @type {any} */ (sort)) ? /** @type {any} */ (sort) : available.defaultSort,
      ...(available.types?.includes(/** @type {any} */ (type)) ? { type: /** @type {any} */ (type) } : {}),
      languages: queryList(route.query.language).filter(language => platform.value?.filterLanguages?.includes(language)),
      tags: available.tags ? queryList(route.query.tag) : []
    }
  })
  const filtersKey = computed(() => JSON.stringify(filters.value))

  /**
   * Replaces the given query values, leaving out empty ones.
   * @param {Record<string, string | string[] | undefined>} changes
   */
  function updateQuery(changes) {
    const next = { ...route.query, ...changes }
    for (const key of Object.keys(changes)) {
      const value = next[key]
      if (!value || (Array.isArray(value) && value.length === 0)) delete next[key]
    }
    router.replace({ query: next })
  }

  return { filters, filtersKey, updateQuery }
}
