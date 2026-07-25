function parseScalar(value) {
  value = String(value ?? "").trim()
  if (!value || value === "{}") return {}
  if (value === "[]") return []
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    try {
      return JSON.parse(value)
    } catch {}
  }
  if (value === "true") return true
  if (value === "false") return false
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

function stripComment(line) {
  let quote = ""
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? "" : quote || char
    }
    if (!quote && char === "#") return line.slice(0, i)
  }
  return line
}

function findKeySeparator(line) {
  let quote = ""
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? "" : quote || char
    }
    if (!quote && char === ":") return i
  }
  return -1
}

export function parseSimpleYaml(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(rawLine => stripComment(rawLine).replace(/\s+$/, ""))
    .filter(line => line.trim())
    .map(line => ({
      indent: line.match(/^\s*/)[0].length,
      body: line.trim(),
    }))

  function parseBlock(start, indent) {
    const isArray = lines[start]?.body.startsWith("- ")
    const value = isArray ? [] : {}
    let index = start

    while (index < lines.length) {
      const line = lines[index]
      if (line.indent < indent) break
      if (line.indent > indent) {
        index++
        continue
      }

      if (isArray) {
        if (!line.body.startsWith("- ")) break
        const rest = line.body.slice(2).trim()
        const keyIndex = findKeySeparator(rest)

        if (!rest) {
          const [child, next] = parseChild(index, line.indent)
          value.push(child)
          index = next
        } else if (keyIndex >= 0) {
          const item = {}
          assignPair(item, rest, keyIndex, index)
          index++
          if (lines[index]?.indent > line.indent) {
            const [extra, next] = parseBlock(index, lines[index].indent)
            if (extra && typeof extra === "object" && !Array.isArray(extra)) Object.assign(item, extra)
            index = next
          }
          value.push(item)
        } else {
          value.push(parseScalar(rest))
          index++
        }
        continue
      }

      const keyIndex = findKeySeparator(line.body)
      if (keyIndex < 0) {
        index++
        continue
      }
      assignPair(value, line.body, keyIndex, index)
      index++
    }

    return [value, index]
  }

  function assignPair(target, body, keyIndex, index) {
    const key = parseScalar(body.slice(0, keyIndex))
    const rest = body.slice(keyIndex + 1).trim()
    if (rest) {
      target[key] = parseScalar(rest)
      return
    }

    if (lines[index + 1]?.indent > lines[index].indent) {
      const [child] = parseBlock(index + 1, lines[index + 1].indent)
      target[key] = child
      return
    }
    target[key] = {}
  }

  function parseChild(index, indent) {
    if (lines[index + 1]?.indent > indent) return parseBlock(index + 1, lines[index + 1].indent)
    return [{}, index + 1]
  }

  const [root] = lines.length ? parseBlock(0, lines[0].indent) : [{}]
  return root
}

export function quote(value) {
  return JSON.stringify(String(value ?? ""))
}

export function stringifyGroups(groups) {
  const entries = Object.entries(groups || {})
  if (!entries.length) return "{}"
  return `\n${entries.map(([key, value]) => `  ${quote(key)}: ${quote(value)}`).join("\n")}`
}

export function stringifyList(list) {
  return JSON.stringify((list || []).map(item => String(item)))
}

function listValues(list) {
  if (Array.isArray(list)) return list.map(item => String(item).trim()).filter(Boolean)
  if (list === undefined || list === null || list === "") return []
  return String(list)
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function stringifyCommandRules(list, withProtocol = false) {
  if (!Array.isArray(list) || !list.length) return "[]"
  const lines = [""]
  for (const item of list) {
    lines.push(`  - match: ${quote(item?.match || "starts")}`)
    if (withProtocol) lines.push(`    protocol: ${quote(item?.protocol || "")}`)
    lines.push("    texts:")
    for (const text of listValues(item?.texts)) {
      lines.push(`      - ${quote(text)}`)
    }
  }
  return lines.join("\n")
}
