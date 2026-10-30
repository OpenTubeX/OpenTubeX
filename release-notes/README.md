# Release notes

Every user-facing change adds a Markdown file to this directory. The Create Draft Release workflow combines the files into the release notes and deletes them.

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

- `category`: `highlight`, `improvement`, or `fix`. Highlights lead the release, so keep them to the few changes most users will care about.
- `platforms` (optional): any of `android`, `ios`, `linux`, `macos`, `windows`, and `desktop`. Leave it out when the change affects every platform. The update prompt in the app and the store listings skip notes for other platforms.
- `references` (optional): issue and pull request numbers, for example `[2509]`. They replace the references from the pull requests that changed the file, for notes added after their change merged.

## Note

- Write one or two sentences of at most 300 characters, ending with a period.
- Describe what users notice, not how it works.
- Leave out issue and pull request numbers. The release notes add them from the pull requests that changed the file.
- Don't name the platform at the start ("On Android, …"). Set `platforms` instead.

## Images

Images are optional. Put them after a blank line as Markdown images, `<img>` tags, or a `<picture>` with dark and light sources like the example. Host them on GitHub by dropping them into the pull request description and copying their URLs. The release notes scale down images taller than 300 pixels.

## Follow-up changes

A pull request that changes something unreleased adds no new note. Update the existing note if its wording or images no longer fit. If the note still fits, or users won't notice the change, check "No release note needed" in the pull request description.

`pnpm run lint` checks every note.
