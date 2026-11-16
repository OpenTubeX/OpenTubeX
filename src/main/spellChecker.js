/**
 * As soon as a session exists, Chromium's spellchecker looks up a dictionary
 * for the system language and downloads it from Google when it is missing,
 * even with spellchecking turned off. Call this in the same task that first
 * uses the session, before that lookup finishes.
 * @param {import('electron').Session} session
 */
export function disableSpellChecker(session) {
  session.setSpellCheckerLanguages([])
  session.setSpellCheckerEnabled(false)
}
