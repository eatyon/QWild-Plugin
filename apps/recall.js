const recalledMessages = new Map()
const patchedRecallTargets = new WeakSet()
const RECALL_TTL = 30 * 60 * 1000

export function messageIds(ret, ids = []) {
  if (!ret) return ids
  if (typeof ret === "string" || typeof ret === "number") {
    ids.push(String(ret))
    return ids
  }
  if (Array.isArray(ret)) {
    for (const item of ret) messageIds(item, ids)
    return ids
  }
  if (ret.message_id) messageIds(ret.message_id, ids)
  if (ret.data?.message_id) messageIds(ret.data.message_id, ids)
  if (ret.data?.messageId) messageIds(ret.data.messageId, ids)
  return ids
}

export function recordRoutedMessage(ret, target) {
  if (!target?.recallMsg) return ret
  const recall = target.recallMsg.bind(target)
  for (const id of new Set(messageIds(ret))) {
    recalledMessages.set(id, { recall })
    const timer = setTimeout(() => recalledMessages.delete(id), RECALL_TTL)
    timer.unref?.()
  }
  return ret
}

export async function recallRoutedMessage(messageId) {
  const id = String(messageId || "")
  const item = recalledMessages.get(id)
  if (!item?.recall) return false

  try {
    await item.recall(id)
    recalledMessages.delete(id)
    return true
  } catch (err) {
    globalThis.Bot?.makeLog?.("debug", ["[QWild] 分流消息撤回失败", err])
    return false
  }
}

function patchRecallTarget(target) {
  if (!target?.recallMsg || patchedRecallTargets.has(target)) return

  const originalRecallMsg = target.recallMsg.bind(target)
  target.recallMsg = async (messageId, ...args) => {
    if (await recallRoutedMessage(messageId)) return true
    return originalRecallMsg(messageId, ...args)
  }

  patchedRecallTargets.add(target)
}

export function patchRecall(e) {
  patchRecallTarget(e?.group)
  patchRecallTarget(e?.friend)
}
