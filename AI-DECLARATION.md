---
version: "0.1.2"
level: auto
processes:
  design: copilot
  implementation: auto
  testing: auto
  documentation: auto
  review: auto
  deployment: auto
components:
  static/locales/ai: auto
---

This format is based on [AI-DECLARATION.md](https://ai-declaration.md/en/0.1.2).

## Notes

- OpenTubeX originated as a fork of FreeTube and regularly merges FreeTube's `development` branch. FreeTube does not accept AI-assisted contributions. The levels above describe work done in OpenTubeX, not code merged from upstream.
- Maintainers decide what to build and set the project rules in [AGENTS.md](AGENTS.md). Coding agents, mainly Claude in Claude Code and OpenAI models in Codex, design the details and implement, test, and document most changes. They ask the maintainers when a decision is unclear.
- Agents open pull requests, address findings from AI review bots (CodeRabbit, cubic), fix CI, and merge once the required checks and CodeRabbit's approval pass. They also maintain the CI, release, and packaging workflows.
- Every pull request ends with the model and tool that made the changes. Contributions from other people may be written by hand.
- Weblate contributors write the human translations. Strings without a human translation get AI translations in `static/locales/ai`, which are also offered on Weblate as suggestions.
