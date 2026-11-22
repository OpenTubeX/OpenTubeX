// Opens an issue in OpenTubeX/OpenTubeX for each secret that expires soon or no longer works,
// and closes it once the secret has been renewed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const inbox = 'OpenTubeX/OpenTubeX'
const bot = 'opentubex-token-check[bot]'
const warnDays = 30
const day = 24 * 60 * 60 * 1000

const run = (command, args, env = {}) => execFileSync(command, args, {
  encoding: 'utf8',
  env: { ...process.env, ...env },
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 60_000,
})

async function json(url, headers) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

// Each check returns { expires: Date | null }, { problem: string } when the secret no longer works,
// or { unknown: string } when its expiry cannot be read.
export const checks = {
  async github(token) {
    try {
      const headers = run('gh', ['api', '--include', 'rate_limit'], { GH_TOKEN: token })
      const expires = headers.match(/^github-authentication-token-expiration: (.+)$/mi)?.[1]
      return { expires: expires ? new Date(expires.trim().replace(' UTC', 'Z').replace(' ', 'T')) : null }
    } catch (error) {
      return { problem: `GitHub rejects it (${error.stderr?.match(/HTTP \d{3}/)?.[0] ?? 'request failed'})` }
    }
  },
  async gitlab(token) {
    const { status, body } = await json('https://gitlab.com/api/v4/personal_access_tokens/self', { 'PRIVATE-TOKEN': token })
    // Tokens without an API scope may not read their own details.
    if (status === 403) return { unknown: 'its scopes cannot read its expiry' }
    if (status !== 200) return { problem: `GitLab rejects it (HTTP ${status})` }
    // GitLab tokens stop working at the start of their expiry date.
    return { expires: body.expires_at ? new Date(`${body.expires_at}T00:00:00Z`) : null }
  },
  async cloudflare(token) {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID
    const headers = { authorization: `Bearer ${token}` }
    let { body } = await json('https://api.cloudflare.com/client/v4/user/tokens/verify', headers)
    // Account-owned tokens verify through the account instead.
    if (!body.success && account) {
      ({ body } = await json(`https://api.cloudflare.com/client/v4/accounts/${account}/tokens/verify`, headers))
    }
    if (!body.success || body.result?.status !== 'active') return { problem: 'Cloudflare rejects it' }
    return { expires: body.result.expires_on ? new Date(body.result.expires_on) : null }
  },
  async snap(credentials) {
    run('sudo', ['snap', 'install', 'snapcraft', '--classic'])
    try {
      const expires = run('snapcraft', ['whoami'], { SNAPCRAFT_STORE_CREDENTIALS: credentials }).match(/^expires:\s*(.+)$/m)?.[1]
      return { expires: expires ? new Date(expires.trim()) : null }
    } catch {
      return { problem: 'The Snap Store rejects it' }
    }
  },
  async gpg(key) {
    const home = mkdtempSync(join(tmpdir(), 'gpg-'))
    try {
      writeFileSync(join(home, 'key'), key)
      run('gpg', ['--batch', '--homedir', home, '--import', join(home, 'key')])
      const rows = run('gpg', ['--batch', '--homedir', home, '--with-colons', '--list-secret-keys']).split('\n').map(row => row.split(':'))
      const until = row => row[6] ? Number(row[6]) * 1000 : Infinity
      const primary = rows.find(row => row[0] === 'sec')
      const signers = rows.filter(row => ['sec', 'ssb'].includes(row[0]) && row[11]?.includes('s'))
      if (!primary || !signers.length) return { problem: 'It contains no signing key' }
      // Signatures need a valid signing key, and no key outlives the primary key.
      const last = Math.min(until(primary), Math.max(...signers.map(until)))
      return { expires: last === Infinity ? null : new Date(last) }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  },
}

// Secrets in OpenTubeX repositories that expire.
const kinds = {
  GITLAB_SYNC_BOT_TOKEN: 'gitlab',
  GITLAB_MIRROR_TOKEN: 'gitlab',
  PUSH_TOKEN: 'github',
  PACKAGE_SUBMISSION_TOKEN: 'github',
  SCORECARD_TOKEN: 'github',
  UPSTREAM_SYNC_TOKEN: 'github',
  CLOUDFLARE_API_TOKEN: 'cloudflare',
  SNAPCRAFT_STORE_CREDENTIALS: 'snap',
  APT_GPG_PRIVATE_KEY: 'gpg',
  ARCH_GPG_PRIVATE_KEY: 'gpg',
  RPM_GPG_PRIVATE_KEY: 'gpg',
}

const renewal = {
  github: 'Create a new fine-grained token with the same repository access and permissions, and replace the secret.',
  gitlab: 'Rotate the token in the GitLab account that owns it, or create a new one with the same scopes, and replace the secret.',
  cloudflare: 'Roll the token in the Cloudflare dashboard, or extend its TTL, and replace the secret if its value changed.',
  snap: 'Run `snapcraft export-login --expires <date> -` and replace the secret with the output.',
  gpg: 'Extend the expiry with `gpg --quick-set-expire <fingerprint> <date> \'*\'` (and for the primary key), replace the secret with the exported secret key, and publish the updated public key.',
}

const ghWrite = (args, body) => execFileSync('gh', ['api', ...args, '--input', '-'], { input: JSON.stringify(body), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repository = process.env.REPOSITORY
  // The workflow passes every secret it knows; each repository has a few of them.
  const secrets = Object.fromEntries(Object.entries(kinds).map(([name]) => [name, process.env[name]]).filter(([, value]) => value))
  const tokens = Object.entries(kinds).filter(([name]) => secrets[name])
  const open = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${inbox}/issues?state=open&creator=${encodeURIComponent(bot)}&per_page=100`])).flat()

  for (const [name, kind] of tokens) {
    const marker = `<!-- token-expiry:${repository}:${name} -->`
    const issue = open.find(item => item.body?.startsWith(marker))
    const result = await checks[kind](secrets[name])
    const date = result.expires?.toISOString().slice(0, 10)
    const soon = result.expires && result.expires - Date.now() < warnDays * day
    console.log(`${name}: ${result.problem ?? result.unknown ?? (date ? `expires ${date}` : 'does not expire')}`)
    if (result.unknown) continue
    if (result.problem || soon) {
      if (issue) continue
      const status = result.problem
        ? `${result.problem}, so it has expired or was revoked.`
        : result.expires < Date.now() ? `It expired on ${date}.` : `It expires on ${date}.`
      ghWrite(['--method', 'POST', `repos/${inbox}/issues`], {
        title: `Renew ${name} in ${repository}`,
        body: `${marker}\nThe [\`${name}\`](https://github.com/${repository}/settings/secrets/actions) secret in ${repository} needs renewing. ${status}\n\n${renewal[kind]}\n\nThis issue closes itself after the next check finds the renewed secret. To check now, run the Token expiry workflow in ${repository}.`,
      })
    } else if (issue) {
      ghWrite(['--method', 'POST', `repos/${inbox}/issues/${issue.number}/comments`], { body: `Renewed: ${date ? `\`${name}\` now expires on ${date}` : `\`${name}\` no longer expires`}.` })
      ghWrite(['--method', 'PATCH', `repos/${inbox}/issues/${issue.number}`], { state: 'closed', state_reason: 'completed' })
    }
  }
}
