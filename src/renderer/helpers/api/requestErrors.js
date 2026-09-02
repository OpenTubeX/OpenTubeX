export function createAbortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}
