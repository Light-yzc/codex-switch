// Keep account numbers as canonical decimal strings, including beyond 2^53.
export function isSlot(value) {
  return typeof value === 'string' && value === value.trim() && /^[1-9][0-9]*$/.test(value);
}

export function compareSlots(left, right) {
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}
