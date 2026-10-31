# Codex CLI

Codex reads skills from `$CODEX_HOME/skills`, which defaults to `~/.codex/skills` (Windows: `%USERPROFILE%\.codex\skills`).

| Scope | Directory | Command |
| --- | --- | --- |
| User (per machine) | `$CODEX_HOME/skills/repomap` | `node platforms/install.mjs --target codex` |

```sh
git clone https://github.com/axsddlr/repomap
cd repomap
node platforms/install.mjs --target codex
```

Codex resolves skills from `$CODEX_HOME` only, so there is no `--project` for this target. For a repo-local copy use `--dir`, for example `--dir .agents` to write `.agents/skills/repomap`, the shared `agentskills` location. Set `CODEX_HOME` before installing to put it somewhere other than the default.

## What gets added

Besides the shared `SKILL.md` and `scripts/repomap.mjs`, a Codex install includes [`agents/openai.yaml`](./agents/openai.yaml), the product-specific manifest Codex reads for UI metadata and invocation policy:

```yaml
interface:
  display_name: "repomap"
  short_description: "Fast dependency-free code index for agents"
  default_prompt: "Use $repomap to find where a symbol is defined before grepping."
policy:
  allow_implicit_invocation: true
```

The other runtimes ignore that file, which is why it lives here rather than in the shared skill folder.

## Verify

Start a new Codex session and ask it to map the repository, or run the installed copy:

```sh
node "$HOME/.codex/skills/repomap/scripts/repomap.mjs" overview
```

Skills are loaded when a session starts, so an already-running session will not see a new install until it restarts. `$repomap` mentions the skill explicitly.

## Make Codex use it before grep

Add to `AGENTS.md` (or `~/.codex/AGENTS.md` for every project):

```markdown
## Code search

- Before grep, glob or reading whole files in a repo, use repomap: `node "$HOME/.codex/skills/repomap/scripts/repomap.mjs" overview|search <words>|find <name>|outline <file>|refs <name>|deps <file>|rdeps <file>`, then read only the line ranges it returns. Fall back to `rg` for string literals, config values, comments, or when its result looks incomplete.
```

## Uninstall

Delete `$CODEX_HOME/skills/repomap`.
