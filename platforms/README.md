# Platforms

repomap is a standard agent skill: one `SKILL.md` and one script. Every runtime below reads that same folder, so this directory contains no second copy of the code — only the per-runtime destination, the extra manifest Codex reads, and the instructions for each.

| Runtime | Install directory | Command |
| --- | --- | --- |
| [Claude Code](./claude/README.md) | `~/.claude/skills/repomap` | `node platforms/install.mjs --target claude` |
| [Codex CLI](./codex/README.md) | `$CODEX_HOME/skills/repomap` | `node platforms/install.mjs --target codex` |
| [DeepSeek Harness](./dsh/README.md) | `$DSH_HOME/skills/repomap` | `node platforms/install.mjs --target dsh` |

Add `--project` to install into the current repository instead of the user profile (Claude Code and DSH; Codex reads `$CODEX_HOME` only). `--dir DIR` installs into `DIR/repomap` for anything else, such as a shared `agents` root.

```sh
node platforms/install.mjs --list        # every destination, resolved
node platforms/install.mjs --target dsh  # install, user scope
node platforms/install.mjs --target dsh --force   # update an existing install
```

An existing install is never replaced without `--force`, so an update is an explicit step.

Once installed, tell the agent to prefer repomap over grep — each platform README has the block to paste into `CLAUDE.md` or `AGENTS.md`.

## Adding a runtime

The skill itself needs no changes: it is already agentskills-compliant (`name: repomap` matching the folder, `description` for routing). To support another runtime, add an entry to `TARGETS` in [`install.mjs`](./install.mjs) with its user directory and, if it has one, its project directory, plus a folder here if it needs a runtime-specific manifest.
