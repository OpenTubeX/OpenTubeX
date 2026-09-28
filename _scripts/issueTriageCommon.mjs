import { execFileSync } from 'node:child_process'

export function eligibleAuthor(author) {
  const login = author?.login?.toLowerCase()
  return Boolean(login) && login !== 'd3sox' &&
    author.type !== 'Bot' && author.__typename !== 'Bot' &&
    !login.endsWith('[bot]')
}

export function github(endpoint, method, body) {
  const args = ['api', endpoint]
  if (method) args.push('-X', method)
  if (body) args.push('--input', '-')
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8',
    input: body && JSON.stringify(body)
  }))
}
