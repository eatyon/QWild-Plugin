import { AsyncLocalStorage } from "node:async_hooks"

const eventStore = new AsyncLocalStorage()
const noRouteStore = new AsyncLocalStorage()

export function getCurrentEvent() {
  return eventStore.getStore()?.event || null
}

export async function withCurrentEvent(e, fn) {
  return eventStore.run({ event: e || null }, fn)
}

export function isNoRoute() {
  return Boolean(noRouteStore.getStore()?.noRoute)
}

export async function withNoRoute(fn) {
  return noRouteStore.run({ noRoute: true }, fn)
}
