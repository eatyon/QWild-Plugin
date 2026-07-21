let currentEvent = null

export function setCurrentEvent(e) {
  currentEvent = e || null
}

export function getCurrentEvent() {
  return currentEvent
}

export async function withCurrentEvent(e, fn) {
  const prev = currentEvent
  currentEvent = e || null
  try {
    return await fn()
  } finally {
    currentEvent = prev
  }
}
