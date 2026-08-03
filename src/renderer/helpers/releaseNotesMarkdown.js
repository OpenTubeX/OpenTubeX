import { Marked } from 'marked'

const GITHUB_ALERT_TYPES = /NOTE|TIP|IMPORTANT|WARNING|CAUTION/i

/**
 * Creates the Markdown renderer used for update release notes.
 *
 * @param {object} options
 * @param {import('marked').MarkedExtension[]} [options.extensions]
 * @param {(token: import('marked').Tokens.Link) => string | false} options.renderLink
 * @returns {Marked}
 */
export function createReleaseNotesMarkdown({ extensions = [], renderLink }) {
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
    }, ...extensions],
    renderer: {
      link: renderLink
    }
  })
}
