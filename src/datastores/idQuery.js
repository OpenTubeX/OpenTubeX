/**
 * NeDB's $in matcher compares every candidate with every selected ID, even
 * when an index supplied the candidates. Keep indexed lookups for small
 * selections; large selections use one linear scan with constant-time checks.
 * Only use this for scalar ID fields, including entries matched by $pull.
 *
 * @param {string} field
 * @param {string[]} values
 */
export function createIdQuery(field, values) {
  if (values.length <= 250) return { [field]: { $in: values } }
  const ids = new Set(values)
  return {
    $where() {
      return ids.has(this[field])
    }
  }
}
