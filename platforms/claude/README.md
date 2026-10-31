# Claude Code

Claude Code reads skills from `SKILL.md` folders, first match wins.

| Scope | Directory | Command |
| --- | --- | --- |
| User (every project) | `~/.claude/skills/repomap` | `node platforms/install.mjs --target claude` |
| Project | `<repo>/.claude/skills/repomap` | `node platforms/install.mjs --target claude --project` |

Windows paths are `%USERPROFILE%\.claude\skills\repomap` and `<repo>\.claude\skills\repomap`.

```sh
git clone https://github.com/axsddlr/repomap
cd repomap
node platforms/install.mjs --target claude
```

The [skills CLI](https://skills.sh) does the same thing, and is handy for the global install:

```sh
npx skills add axsddlr/repomap --skill repomap            # project
npx skills add axsddlr/repomap --skill repomap --global   # user
```

## Verify

Start a new session and ask for a code map, or run the installed copy directly:

```sh
node ~/.claude/skills/repomap/scripts/repomap.mjs overview
```

## Make Claude use it before grep

Add to `~/.claude/CLAUDE.md`, or a project `CLAUDE.md`:

```markdown
## Code search

- Before grep, glob or reading whole files in a repo, use repomap: `node "$HOME/.claude/skills/repomap/scripts/repomap.mjs" overview|search <words>|find <name>|outline <file>|refs <name>|deps <file>|rdeps <file>`, then read only the line ranges it returns. Fall back to `rg` for string literals, config values, comments, or when its result looks incomplete.
```

## Uninstall

Delete `~/.claude/skills/repomap` (or `<repo>/.claude/skills/repomap`).
