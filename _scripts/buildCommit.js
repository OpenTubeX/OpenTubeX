const { execFileSync } = require('node:child_process')

// Embed the checked-out commit. Release workflows build the release commit,
// while GITHUB_SHA names the commit they were dispatched from, and F-Droid
// must reproduce the bundle without GitHub's environment.
module.exports = function getBuildCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return process.env.GITHUB_SHA ?? ''
  }
}
