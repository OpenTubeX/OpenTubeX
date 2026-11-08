import { Marked } from 'marked'

const GITHUB_ALERT_TYPES = /NOTE|TIP|IMPORTANT|WARNING|CAUTION/i
const GITHUB_ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/i
const LOCAL_REPOSITORY = 'opentubex/opentubex'
const UPSTREAM_REPOSITORY = 'freetubeapp/freetube'

/**
 * Shortens links to GitHub issues to a reference like #1234.
 *
 * @param {import('marked').Tokens.Link} token
 * @returns {string | false}
 */
function renderIssueLink(token) {
  const match = GITHUB_ISSUE_URL_PATTERN.exec(token.href)

  if (!match) {
    return false
  }

  const [, owner, repository, issueNumber] = match
  const repositoryName = `${owner}/${repository}`
  let label = `${repositoryName}#${issueNumber}`

  if (repositoryName.toLowerCase() === LOCAL_REPOSITORY) {
    label = `#${issueNumber}`
  } else if (repositoryName.toLowerCase() === UPSTREAM_REPOSITORY) {
    label = `${owner}#${issueNumber}`
  }

  return `<a href="${token.href}">${label}</a>`
}

/**
 * Whether a reference starts here instead of in the middle of a word or URL.
 *
 * @param {import('marked').Token[]} tokens
 * @returns {boolean}
 */
function startsNewReference(tokens) {
  return !/[\w/]$/.test(tokens.at(-1)?.raw ?? '')
}

/** @type {import('marked').TokenizerAndRendererExtension} */
const issueReferenceExtension = {
  name: 'issueReference',
  level: 'inline',
  start: (source) => source.search(/#\d+\b/),
  tokenizer(source, tokens) {
    const match = /^#(\d+)\b/.exec(source)

    if (match && !this.lexer.state.inLink && startsNewReference(tokens)) {
      return {
        type: 'issueReference',
        raw: match[0],
        issueNumber: match[1]
      }
    }
  },
  renderer({ issueNumber }) {
    return `<a href="https://github.com/OpenTubeX/OpenTubeX/issues/${issueNumber}">#${issueNumber}</a>`
  }
}

/** @type {import('marked').TokenizerAndRendererExtension} */
const commitReferenceExtension = {
  name: 'commitReference',
  level: 'inline',
  start: (source) => source.search(/\b[\da-f]{40}\b/),
  tokenizer(source, tokens) {
    const match = /^[\da-f]{40}\b/.exec(source)

    if (match && !this.lexer.state.inLink && startsNewReference(tokens)) {
      return {
        type: 'commitReference',
        raw: match[0],
        commitHash: match[0]
      }
    }
  },
  renderer({ commitHash }) {
    return `<a href="https://github.com/OpenTubeX/OpenTubeX/commit/${commitHash}"><code>${commitHash.slice(0, 7)}</code></a>`
  }
}

/**
 * Creates the Markdown renderer used for update release notes.
 *
 * @param {object} [options]
 * @param {import('marked').MarkedExtension[]} [options.extensions]
 * @param {(token: import('marked').Tokens.Link) => string | false} [options.renderLink]
 * @returns {Marked}
 */
export function createReleaseNotesMarkdown({ extensions = [], renderLink = renderIssueLink } = {}) {
  return new Marked({
    extensions: [{
      name: 'githubAlert',
      level: 'block',
      start: (source) => source.match(new RegExp(`^>\\s*\\[!(${GITHUB_ALERT_TYPES.source})\\]`, 'im'))?.index,
      tokenizer(source) {
        const match = new RegExp(`^(?:>\\s*\\[!(${GITHUB_ALERT_TYPES.source})\\][ \\t]*([^\\n]*)(?:\\n|$))((?:>[^\\n]*(?:\\n|$))*)`, 'i').exec(source)
        if (!match) {
          return undefined
        }

        const firstLine = match[2]
        const remainingLines = match[3].replaceAll(/^> ?/gm, '')
        const text = firstLine.length > 0 && remainingLines.length > 0
          ? `${firstLine}\n${remainingLines}`
          : firstLine + remainingLines

        return {
          type: 'githubAlert',
          raw: match[0],
          alertType: match[1].toLowerCase(),
          tokens: this.lexer.blockTokens(text)
        }
      },
      renderer(token) {
        return `<blockquote data-alert="${token.alertType}">\n${this.parser.parse(token.tokens)}</blockquote>\n`
      }
    }, issueReferenceExtension, commitReferenceExtension, ...extensions],
    renderer: {
      link: renderLink,
      // Release notes are the only thing in the prompt, so show collapsible
      // sections expanded instead of making them a second click.
      html: ({ text }) => text.replace(/^<details(?=[\s>])/i, '<details open')
    }
  })
}

const PICTURE = /<picture\b[^>]*>([\s\S]*?)<\/picture>/gi
// Quoted attribute values, such as alt text, can contain >.
const TAG_ATTRIBUTES = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*>`

/**
 * Replaces each picture element with its img, showing the source for the
 * app's color scheme. Picture sources follow the OS color scheme instead,
 * which can differ from the app theme.
 *
 * @param {string} html
 * @param {'dark' | 'light'} colorScheme
 * @returns {string}
 */
export function resolvePictureColorScheme(html, colorScheme) {
  return html.replaceAll(PICTURE, (picture, content) => {
    const img = new RegExp(`<img\\b${TAG_ATTRIBUTES}`, 'i').exec(content)?.[0] ?? ''
    const source = content.match(new RegExp(`<source\\b${TAG_ATTRIBUTES}`, 'gi'))
      ?.find(tag => new RegExp(`\\bmedia=(["'])\\(prefers-color-scheme:\\s*${colorScheme}\\)\\1`, 'i').test(tag))
    const url = source && /\bsrcset=(["'])\s*(\S+?)[\s,"']/i.exec(source)?.[2]
    return url ? img.replace(/\bsrc=(["']).*?\1/i, `src="${url}"`) : img
  })
}
