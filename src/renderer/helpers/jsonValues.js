export function areJsonValuesEqual(left, right) {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false
  }

  const leftIsArray = Array.isArray(left)
  if (leftIsArray !== Array.isArray(right)) return false

  if (leftIsArray) {
    return left.length === right.length && left.every((value, index) => (
      areJsonValuesEqual(value, right[index])
    ))
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => (
    Object.prototype.hasOwnProperty.call(right, key) &&
    areJsonValuesEqual(left[key], right[key])
  ))
}
