export function getTwitchChatTarget(value, isLive) {
  try {
    const url = new URL(value)
    if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(url.hostname.toLowerCase())) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'videos' && /^\d+$/.test(parts[1]) && parts.length === 2) {
      return { type: 'replay', id: parts[1] }
    }
    if (isLive && parts.length === 1 && /^[a-z\d_]{4,25}$/i.test(parts[0])) {
      return { type: 'live', id: parts[0].toLowerCase() }
    }
  } catch { /* A non-Twitch URL has no chat. */ }
  return null
}

export function parseTwitchIrcMessage(line) {
  const match = /^(?:@([^ ]+) )?:([^ ]+) PRIVMSG #[^ ]+ :(.*)$/.exec(line)
  if (!match) return null
  const tags = Object.fromEntries((match[1] ?? '').split(';').map(tag => tag.split('=', 2)))
  const name = tags['display-name'] || match[2].split('!')[0]
  return {
    id: tags.id || `${tags['tmi-sent-ts']}-${name}-${match[3]}`,
    name,
    text: match[3],
    color: /^#[\da-f]{6}$/i.test(tags.color ?? '') ? tags.color : '',
    timestamp: Number(tags['tmi-sent-ts']) || Date.now()
  }
}

export function parseTwitchReplayPage(payload) {
  const comments = payload?.data?.video?.comments
  if (!comments || !Array.isArray(comments.edges)) throw new Error('Twitch chat replay is unavailable')
  const messages = comments.edges.flatMap(({ node }) => {
    if (!node?.id || !Number.isFinite(node.contentOffsetSeconds)) return []
    return [{
      id: node.id,
      name: node.commenter?.displayName || node.commenter?.login || '',
      text: (node.message?.fragments ?? []).map(fragment => fragment.text ?? '').join(''),
      color: /^#[\da-f]{6}$/i.test(node.message?.userColor ?? '') ? node.message.userColor : '',
      offset: node.contentOffsetSeconds
    }]
  })
  return {
    messages,
    cursor: comments.pageInfo?.hasNextPage ? comments.edges.at(-1)?.cursor ?? null : null
  }
}
