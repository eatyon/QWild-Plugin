export function qqbotId(botId, id) {
  id = String(id || "")
  if (!id || id.includes(":")) return id
  return `${botId}:${id}`
}

export function qqbotBotId(id) {
  return String(id || "").split(":")[0] || ""
}

export function qqbotInnerId(id) {
  const text = String(id || "")
  const index = text.indexOf(":")
  return index >= 0 ? text.slice(index + 1) : ""
}

export function isQQBotId(id) {
  return /^[^:\s]+:.+$/.test(String(id || ""))
}

export function isQQId(id) {
  return /^\d+$/.test(String(id || ""))
}

export function mappedValue(map, key) {
  key = String(key || "")
  return map?.[key] || ""
}

export function findAllByValue(map, value) {
  value = String(value || "")
  return Object.entries(map || {}).filter(([, to]) => String(to) === value)
}

export function reverseMappedValue(map, value, botId = "") {
  botId = String(botId || "")
  const hit = findAllByValue(map, value).find(([from]) => !botId || String(from).startsWith(`${botId}:`))
  return hit?.[0] || ""
}

export function hasMappedValue(map, value) {
  return findAllByValue(map, value).length > 0
}

export function parseMappingPair(text) {
  const parts = String(text || "")
    .trim()
    .split("=")
    .map(item => item.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null

  const [left, right] = parts
  if (isQQBotId(left) && isQQId(right)) return { qqbot: left, wild: right }
  if (isQQBotId(right) && isQQId(left)) return { qqbot: right, wild: left }
  return null
}

export function findMapping(map, id) {
  id = String(id || "").trim()
  if (!id) return null
  if (id.includes("=")) {
    const pair = parseMappingPair(id)
    if (!pair) return null
    return String(map?.[pair.qqbot] || "") === pair.wild ? [pair.qqbot, pair.wild] : null
  }
  if (map?.[id]) return [id, map[id]]
  if (isQQBotId(id)) return null

  const hits = findAllByValue(map, id)
  if (hits.length > 1) return { ambiguous: true, value: id }
  return hits[0] || null
}
