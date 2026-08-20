import assert from 'node:assert/strict'
import test from 'node:test'

import { linkifyDescription, linkifyHashtagsAndHandles } from '../../src/renderer/helpers/descriptionLinks.js'

test('links hashtags and handles in plain text descriptions', () => {
  const html = linkifyDescription('Follow @SomeCreator #Deutsch')

  assert.match(html, /<a href="https:\/\/youtube\.com\/@SomeCreator"[^>]*>@SomeCreator<\/a>/)
  assert.match(html, /<a href="https:\/\/youtube\.com\/hashtag\/Deutsch"[^>]*>#Deutsch<\/a>/)
})

test('still links URLs and email addresses in plain text descriptions', () => {
  const html = linkifyDescription('Visit https://example.com or mail me at someone@example.com')

  assert.match(html, /<a href="https:\/\/example\.com"[^>]*>example\.com<\/a>/)
  assert.match(html, /<a href="mailto:someone@example\.com"[^>]*>someone@example\.com<\/a>/)
})

test('leaves hashtags and handles that the backend linked already untouched', () => {
  const html = linkifyHashtagsAndHandles('<a href="https://www.youtube.com/hashtag/linked">#linked</a> #plain')

  assert.match(html, /^<a href="https:\/\/www\.youtube\.com\/hashtag\/linked">#linked<\/a> /)
  assert.match(html, /<a href="https:\/\/youtube\.com\/hashtag\/plain"[^>]*>#plain<\/a>$/)
})

test('leaves the URLs in an HTML description to the backend', () => {
  const html = linkifyHashtagsAndHandles('Visit https://example.com about #tag')

  assert.match(html, /^Visit https:\/\/example\.com about /)
  assert.match(html, /<a href="https:\/\/youtube\.com\/hashtag\/tag"[^>]*>#tag<\/a>$/)
})

test('does not link things that only look like hashtags or handles', () => {
  // `#` in `C#` and `@` in an email address are not tags/handles,
  // neither are handles that are too short to exist on YouTube
  const html = linkifyHashtagsAndHandles('C# is not F#, foo@bar.com is an address and @ab is too short')

  assert.doesNotMatch(html, /<a/)
})

test('does not link one- or two-digit hashtags', () => {
  const html = linkifyHashtagsAndHandles('Parts #9, #10 and #99')

  assert.strictEqual(html, 'Parts #9, #10 and #99')
})

test('links longer numeric and short textual hashtags', () => {
  const html = linkifyHashtagsAndHandles('#100 #123 #ai #9a #猫')

  for (const tag of ['100', '123', 'ai', '9a', '猫']) {
    assert.match(html, new RegExp(`<a href="https://youtube\\.com/hashtag/${tag}"[^>]*>#${tag}</a>`))
  }
})

test('keeps the escaped HTML of a title escaped', () => {
  // titles are plain text, so they get escaped before their hashtags and handles are linked
  const html = linkifyHashtagsAndHandles('&lt;b&gt;Bold&lt;/b&gt; #Tag')

  assert.match(html, /^&lt;b&gt;Bold&lt;\/b&gt; /)
  assert.match(html, /<a href="https:\/\/youtube\.com\/hashtag\/Tag"[^>]*>#Tag<\/a>$/)
})

test('does not link inside HTML attributes', () => {
  const html = linkifyHashtagsAndHandles('<img src="https://example.com/emoji.png" alt="#emoji">')

  assert.strictEqual(html, '<img src="https://example.com/emoji.png" alt="#emoji">')
})
