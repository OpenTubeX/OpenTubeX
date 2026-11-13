/**
 * Runs one retryable playlist request while keeping its loading and error
 * states paired on every control-flow path.
 * @template T
 * @param {object} options
 * @param {() => Promise<T>} options.request
 * @param {(loading: boolean) => void} options.setLoading
 * @param {(error: unknown | null) => void} options.setError
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: unknown }>}
 */
export async function runRetryablePlaylistRequest({ request, setLoading, setError }) {
  setLoading(true)
  setError(null)

  try {
    return { ok: true, value: await request() }
  } catch (error) {
    setError(error)
    return { ok: false, error }
  } finally {
    setLoading(false)
  }
}
