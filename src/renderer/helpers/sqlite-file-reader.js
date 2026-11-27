// @ts-check
// Reads the tables of an SQLite database file in JavaScript, so imports of
// other apps' databases need neither the native nor the WebAssembly SQLite on
// any platform. It walks the table b-trees and skips indexes, so it supports
// neither WITHOUT ROWID tables nor changes still in a write-ahead log.
// https://www.sqlite.org/fileformat2.html

const MAGIC = 'SQLite format 3\0'
const TABLE_INTERIOR = 0x05
const TABLE_LEAF = 0x0D
// The value sizes of the serial types below 10
const FIXED_SIZES = [0, 1, 2, 3, 4, 6, 8, 8, 0, 0]

/**
 * @param {Uint8Array} bytes
 */
export function isSqliteDatabase(bytes) {
  return bytes.length >= 100 && new TextDecoder().decode(bytes.subarray(0, 16)) === MAGIC
}

/**
 * The names of a table's columns, in the order of its records' values
 * @param {string} sql the table's CREATE TABLE statement
 */
export function parseColumnNames(sql) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'))
  const definitions = []
  let depth = 0
  /** @type {string | null} */
  let quote = null
  let current = ''
  for (const char of body) {
    if (quote !== null) {
      if (char === quote) quote = null
    } else if (char === '"' || char === '`' || char === '\'') {
      quote = char
    } else if (char === '[') {
      quote = ']'
    } else if (char === '(') {
      depth++
    } else if (char === ')') {
      depth--
    } else if (char === ',' && depth === 0) {
      definitions.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  definitions.push(current.trim())

  const columns = []
  let index = 0
  for (; index < definitions.length; index++) {
    const match = definitions[index].match(/^(?:"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|\[([^\]]*)\]|'((?:[^']|'')*)'|(\S+))\s*(.*)$/s)
    if (match === null) continue
    const bare = match[5]
    // Table constraints follow the columns
    if (bare !== undefined && /^(?:constraint|primary|unique|check|foreign)$/i.test(bare)) break
    const name = match[1]?.replaceAll('""', '"') ?? match[2]?.replaceAll('``', '`') ?? match[3] ?? match[4]?.replaceAll('\'\'', '\'') ?? bare
    const integer = /^integer(?:\s|$)/i.test(match[6])
    // An INTEGER PRIMARY KEY column stores the row ID instead of a value
    columns.push({ name, integer, rowId: integer && /\bprimary\s+key\b(?!\s+desc)/i.test(match[6]) })
  }
  // So does an INTEGER column that a table constraint makes the only primary key column
  for (const constraint of definitions.slice(index)) {
    const key = constraint.match(/^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^,)]*)\)/i)?.[1]
      .trim().replace(/\s+(?:asc|desc)$/i, '').replaceAll(/^["`[]|["`\]]$/g, '').toLowerCase()
    const column = columns.find(({ name }) => name.toLowerCase() === key)
    if (column?.integer) column.rowId = true
  }
  return columns.map(({ name, rowId }) => ({ name, rowId }))
}

/**
 * @param {Uint8Array} bytes the whole database file
 */
export function openSqliteDatabase(bytes) {
  if (!isSqliteDatabase(bytes)) {
    throw new Error('Not an SQLite database')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pageSize = view.getUint16(16) === 1 ? 65536 : view.getUint16(16)
  const usableSize = pageSize - bytes[20]
  const pageCount = Math.floor(bytes.length / pageSize)
  const encoding = view.getUint32(56)
  const decoder = new TextDecoder(encoding === 2 ? 'utf-16le' : encoding === 3 ? 'utf-16be' : 'utf-8')
  const corrupt = () => new Error('The database file is damaged')

  /** @param {number} page */
  function pageOffset(page) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) throw corrupt()
    return (page - 1) * pageSize
  }

  /**
   * @param {Uint8Array} source
   * @param {number} offset
   * @returns {[number, number]} the value and the offset after it
   */
  function readVarint(source, offset) {
    let value = 0
    for (let i = 0; i < 9; i++) {
      const byte = source[offset + i]
      if (byte === undefined) throw corrupt()
      if (i === 8) return [value * 256 + byte, offset + 9]
      value = value * 128 + (byte & 0x7F)
      if (byte < 0x80) return [value, offset + i + 1]
    }
    throw corrupt()
  }

  /**
   * A cell's payload, joined with the overflow pages it continues on
   * @param {number} offset where the payload starts
   * @param {number} size
   */
  function readPayload(offset, size) {
    const maxLocal = usableSize - 35
    if (size <= maxLocal) {
      if (offset + size > bytes.length) throw corrupt()
      return bytes.subarray(offset, offset + size)
    }
    const minLocal = Math.floor((usableSize - 12) * 32 / 255) - 23
    const surplus = minLocal + ((size - minLocal) % (usableSize - 4))
    const local = surplus <= maxLocal ? surplus : minLocal
    const payload = new Uint8Array(size)
    payload.set(bytes.subarray(offset, offset + local))
    let written = local
    let page = view.getUint32(offset + local)
    const seen = new Set()
    while (written < size) {
      if (seen.has(page)) throw corrupt()
      seen.add(page)
      const start = pageOffset(page)
      const chunk = bytes.subarray(start + 4, start + 4 + Math.min(usableSize - 4, size - written))
      payload.set(chunk, written)
      written += chunk.length
      page = view.getUint32(start)
    }
    return payload
  }

  /** @param {Uint8Array} record */
  function decodeRecord(record) {
    const recordView = new DataView(record.buffer, record.byteOffset, record.byteLength)
    const values = []
    let [headerSize, headerOffset] = readVarint(record, 0)
    let offset = headerSize
    while (headerOffset < headerSize) {
      let type
      [type, headerOffset] = readVarint(record, headerOffset)
      const size = type < 10 ? FIXED_SIZES[type] : type >= 12 ? Math.floor((type - 12) / 2) : 0
      if (offset + size > record.length) throw corrupt()
      switch (type) {
        case 0: values.push(null); break
        case 1: values.push(recordView.getInt8(offset)); break
        case 2: values.push(recordView.getInt16(offset)); break
        case 3: values.push((recordView.getInt8(offset) * 65536) + recordView.getUint16(offset + 1)); break
        case 4: values.push(recordView.getInt32(offset)); break
        case 5: values.push((recordView.getInt16(offset) * 2 ** 32) + recordView.getUint32(offset + 2)); break
        case 6: values.push(Number(recordView.getBigInt64(offset))); break
        case 7: values.push(recordView.getFloat64(offset)); break
        case 8: values.push(0); break
        case 9: values.push(1); break
        default:
          if (type < 12) throw corrupt()
          values.push(type % 2 === 0 ? record.slice(offset, offset + size) : decoder.decode(record.subarray(offset, offset + size)))
      }
      offset += size
    }
    return values
  }

  /**
   * Every row of a table b-tree in row ID order
   * @param {number} rootPage
   * @returns {{ rowId: number, values: unknown[] }[]}
   */
  function readTableTree(rootPage) {
    const rows = []
    const stack = [rootPage]
    const seen = new Set()
    while (stack.length > 0) {
      const page = /** @type {number} */ (stack.pop())
      if (seen.has(page)) throw corrupt()
      seen.add(page)
      const start = pageOffset(page)
      const header = start + (page === 1 ? 100 : 0)
      const pageType = bytes[header]
      const cellCount = view.getUint16(header + 3)
      if (pageType === TABLE_INTERIOR) {
        const children = []
        for (let i = 0; i < cellCount; i++) {
          children.push(view.getUint32(start + view.getUint16(header + 12 + 2 * i)))
        }
        children.push(view.getUint32(header + 8))
        // Last in, first out: the leftmost child, which has the lowest row IDs, comes next
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
      } else if (pageType === TABLE_LEAF) {
        for (let i = 0; i < cellCount; i++) {
          const [payloadSize, rowIdOffset] = readVarint(bytes, start + view.getUint16(header + 8 + 2 * i))
          const [rowId, payloadOffset] = readVarint(bytes, rowIdOffset)
          rows.push({ rowId, values: decodeRecord(readPayload(payloadOffset, payloadSize)) })
        }
      } else {
        throw corrupt()
      }
    }
    return rows
  }

  /** @type {Map<string, { rootPage: number, columns: { name: string, rowId: boolean }[] }>} */
  const tables = new Map()
  for (const { values: [type, name, , rootPage, sql] } of readTableTree(1)) {
    if (type === 'table' && typeof name === 'string' && typeof rootPage === 'number' && rootPage > 0 && typeof sql === 'string') {
      tables.set(name.toLowerCase(), { rootPage, columns: parseColumnNames(sql) })
    }
  }

  return {
    /** @param {string} name */
    hasTable: name => tables.has(name.toLowerCase()),
    /**
     * The rows of a table in row ID order. Columns that were added after a
     * row was written read as null.
     * @param {string} name
     * @returns {Record<string, unknown>[]}
     */
    rows(name) {
      const table = tables.get(name.toLowerCase())
      if (table === undefined) return []
      return readTableTree(table.rootPage).map(({ rowId, values }) => Object.fromEntries(
        table.columns.map((column, index) => [column.name, column.rowId ? rowId : values[index] ?? null])
      ))
    },
  }
}
