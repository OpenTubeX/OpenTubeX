/**
 * Parses line-delimited JSON without applying record validation or deduplication.
 *
 * @param {string} source
 * @returns {{ records: unknown[], errors: { rowNumber: number, message: string }[] }}
 */
export function parseLineDelimitedJson(source) {
  const records = []
  const errors = []

  source.split(/\r?\n/).forEach((row, index) => {
    const trimmedRow = row.trim()
    if (trimmedRow === '') {
      return
    }

    try {
      records.push(JSON.parse(trimmedRow))
    } catch (error) {
      errors.push({
        rowNumber: index + 1,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })

  return { records, errors }
}
