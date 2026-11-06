# Release notes

Notable user-facing changes add a Markdown file to this directory. The Create Draft Release workflow combines the files into the release notes and deletes them.

## When to add a note

Release notes are for what most users of the affected platforms will notice and want to know. A short list gets read; a long one buries the changes that matter. Most pull requests need no note.

Add a note for:

- New features, settings, and options.
- Changes to how a feature looks or works that users will notice on their own, such as a redesigned menu or a new default.
- Fixes for bugs that many users hit: crashes, lost or corrupted data, playback failures, or a common feature that doesn't work.
- Speedups users can feel in everyday use.
- Changes to supported systems, install methods, or privacy.

Skip the note for:

- Polish: spacing, alignment, icons, hover and focus states, small animation changes, and contrast tweaks for some themes or colors.
- Fixes for rare situations, such as races, several windows editing the same data, or failures after a crash or reload.
- Fixes and follow-ups for changes that haven't been released yet.
- Internal changes: refactoring, tests, CI, dependencies, and translations.

When in doubt, leave it out. Before adding a note, check whether a pending note covers the same area, and extend it if it can absorb the change in a few words. Don't add a second note for the same feature.

```markdown
---
category: improvement
platforms: [android]
---

Queued videos now show their length, views, and upload date.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/…">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/…">
  <img alt="Watch queue with video details" src="https://github.com/user-attachments/assets/…">
</picture>
```

Name the file after the change in kebab-case, for example `queue-video-details.md`.

## Front matter

- `category`: `highlight`, `improvement`, or `fix`. Highlights lead the release, so keep them to two or three changes most users will care about.
- `platforms` (optional): any of `android`, `ios`, `linux`, `macos`, `windows`, and `desktop`. Leave it out when the change affects every platform. The update prompt in the app and the store listings skip notes for other platforms.
- `references` (optional): issue and pull request numbers, for example `[2509]`. They replace the references from the pull requests that changed the file, for notes added after their change merged.

## Note

- Write one or two sentences of at most 300 characters, ending with a period. Shorter is better.
- Describe what users notice, not how it works. Leave out minor details and lists of every affected place.
- Leave out issue and pull request numbers. The release notes add them from the pull requests that changed the file.
- Don't name the platform at the start ("On Android, …"). Set `platforms` instead.

## Images

Images are optional. Put them after a blank line as Markdown images, `<img>` tags, or a `<picture>` with dark and light sources like the example. Host them on GitHub by dropping them into the pull request description and copying their URLs. The release notes scale down images taller than 300 pixels.

## Follow-up changes

A pull request that changes something unreleased adds no new note. Update the existing note if its wording or images no longer fit. If the note still fits, or the change doesn't meet the bar above, check "No release note needed" in the pull request description.

`pnpm run lint` checks every note.
