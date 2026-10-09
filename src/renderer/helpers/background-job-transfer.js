const CHUNK_SIZE = 256

/** Transfer large collections in bounded messages instead of one blocking clone. */
export async function sendJobValue(postMessage, id, value, clone = value => value) {
  let deadline = performance.now() + 4
  async function send(path, value) {
    if (typeof value === 'string' && value.length > 65_536) {
      postMessage({ type: 'value', id, path, value: '' })
      for (let offset = 0; offset < value.length; offset += 65_536) {
        postMessage({ type: 'chunk', id, path, text: value.slice(offset, offset + 65_536) })
        await yieldIfNeeded()
      }
    } else if (Array.isArray(value)) {
      postMessage({ type: 'value', id, path, value: [] })
      for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
        postMessage({ type: 'chunk', id, path, items: clone(value.slice(offset, offset + CHUNK_SIZE)) })
        await yieldIfNeeded()
      }
    } else if (value instanceof Date) {
      postMessage({ type: 'value', id, path, value: clone(value) })
    } else if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value)
      postMessage({ type: 'value', id, path, value: {} })
      if (path.length < 2 && keys.length <= CHUNK_SIZE) {
        for (const key of keys) await send([...path, key], value[key])
      } else {
        for (let offset = 0; offset < keys.length; offset += CHUNK_SIZE) {
          const entries = keys.slice(offset, offset + CHUNK_SIZE).map(key => [key, value[key]])
          postMessage({ type: 'chunk', id, path, entries: clone(entries) })
          await yieldIfNeeded()
        }
      }
    } else {
      postMessage({ type: 'value', id, path, value })
    }
    await yieldIfNeeded()
  }
  async function yieldIfNeeded() {
    if (performance.now() < deadline) return
    await new Promise(resolve => setTimeout(resolve, 0))
    deadline = performance.now() + 4
  }
  await send([], value)
}

/** Reassemble a collection without interpreting application-controlled keys. */
export function receiveJobValue(state, message) {
  if (message.type === 'chunk' && typeof message.text === 'string' && message.path.length === 0) {
    state.value += message.text
    return
  }
  if (message.path.length === 0 && message.type === 'value') {
    state.value = message.value
    return
  }
  let target = state.value
  for (const key of message.path.slice(0, -1)) target = target[key]
  if (message.type === 'value') {
    Object.defineProperty(target, message.path.at(-1), {
      value: message.value, enumerable: true, configurable: true, writable: true,
    })
    return
  }
  if (message.path.length > 0) target = target[message.path.at(-1)]
  if (typeof message.text === 'string') {
    let parent = state.value
    for (const key of message.path.slice(0, -1)) parent = parent[key]
    parent[message.path.at(-1)] += message.text
  } else if (message.items) target.push(...message.items)
  else {
    for (const [key, value] of message.entries) {
      Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
    }
  }
}
