const qqbotSeparators = [":", "\uF03A"]

function qqbotSeparatorIndex(id) {
  const indexes = qqbotSeparators.map(separator => id.indexOf(separator)).filter(index => index >= 0)
  return indexes.length ? Math.min(...indexes) : -1
}

export function normalizeQQBotId(id) {
  const text = String(id || "")
  const index = qqbotSeparatorIndex(text)
  return index >= 0 ? `${text.slice(0, index)}:${text.slice(index + 1)}` : text
}

export function qqbotId(botId, id) {
  botId = normalizeQQBotId(botId)
  id = normalizeQQBotId(id)
  if (!id || isQQBotId(id) || !botId) return id
  return `${botId}:${id}`
}

export function qqbotBotId(id) {
  return normalizeQQBotId(id).split(":")[0] || ""
}

export function qqbotInnerId(id) {
  const text = normalizeQQBotId(id)
  const index = text.indexOf(":")
  return index >= 0 ? text.slice(index + 1) : ""
}

export function isQQBotId(id) {
  return /^[^:\s]+:.+$/.test(normalizeQQBotId(id))
}

export function isQQId(id) {
  return /^\d+$/.test(String(id || ""))
}

export function mappedValue(map, key) {
  key = normalizeQQBotId(key)
  return map?.[key] || ""
}

export function findAllByValue(map, value) {
  value = String(value || "")
  return Object.entries(map || {}).filter(([, to]) => String(to) === value)
}

export function reverseMappedValue(map, value, botId = "") {
  botId = String(botId || "")
  const hits = findAllByValue(map, value).filter(([from]) => !botId || String(from).startsWith(`${botId}:`))
  return hits.length === 1 ? hits[0][0] : ""
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

  const [left, right] = parts.map(normalizeQQBotId)
  if (isQQBotId(left) && isQQId(right)) return { qqbot: left, wild: right }
  if (isQQBotId(right) && isQQId(left)) return { qqbot: right, wild: left }
  return null
}

export function findMapping(map, id) {
  id = normalizeQQBotId(String(id || "").trim())
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
