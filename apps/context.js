import { AsyncLocalStorage } from "node:async_hooks"

let currentEvent = null
const noRouteStore = new AsyncLocalStorage()

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

export function isNoRoute() {
  return Boolean(noRouteStore.getStore()?.noRoute)
}

export async function withNoRoute(fn) {
  return noRouteStore.run({ noRoute: true }, fn)
}
