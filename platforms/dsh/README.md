# DeepSeek Harness

DSH reads `SKILL.md` folders from several roots, highest rank first: the repository's `.dsh/skills` and `.agents/skills`, then `$DSH_HOME/skills` (default `~/.dsh/skills`) and `~/.agents/skills`.

| Scope | Directory | Command |
| --- | --- | --- |
| User (every project) | `$DSH_HOME/skills/repomap` | `node platforms/install.mjs --target dsh` |
| Project | `<repo>/.dsh/skills/repomap` | `node platforms/install.mjs --target dsh --project` |

Windows paths are `%USERPROFILE%\.dsh\skills\repomap` and `<repo>\.dsh\skills\repomap`.

```sh
git clone https://github.com/axsddlr/repomap
cd repomap
node platforms/install.mjs --target dsh
```

Set `DSH_HOME` before installing to use a different root. A copy in `~/.agents/skills/repomap` or `<repo>/.agents/skills/repomap` is also picked up, since DSH reads those shared roots too — `--dir "$HOME/.agents"` writes there.

## Verify

Start a new session and the skill appears in the catalog. To run the installed copy directly:

```sh
node "$HOME/.dsh/skills/repomap/scripts/repomap.mjs" overview
```

A running session picks up a new or changed skill folder when its catalog refreshes; otherwise restart.

## Make DSH use it before grep

Add to `AGENTS.md`:

```markdown
## Code search

- Before grep, glob or reading whole files in a repo, use repomap: `node "$HOME/.dsh/skills/repomap/scripts/repomap.mjs" overview|search <words>|find <name>|outline <file>|refs <name>|deps <file>|rdeps <file>`, then read only the line ranges it returns. Fall back to `rg` for string literals, config values, comments, or when its result looks incomplete.
```

## Uninstall

Delete `$DSH_HOME/skills/repomap` (or `<repo>/.dsh/skills/repomap`).
