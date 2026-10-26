---
name: repomap
description: Fast, dependency-free code index for any repository. Use it BEFORE grep, glob or reading whole files whenever you need to understand an unfamiliar repo, locate where a function, class or method is defined, see a file's structure, find who calls or imports something, or decide which files matter for a task. Returns exact file:line ranges and one-line docs so you read only the lines you need. Covers TypeScript/JavaScript, Python, Go, Rust, Kotlin, Java, C#, shell and Markdown. Also name it in subagent briefs as the code index to use before grep.
---

# repomap

One Node script (Node 18 or later; no install, no dependencies, no model calls) that indexes a repository's symbols and imports and answers small queries. The index is cached outside the repository (`~/.cache/repomap/`, or `$REPOMAP_CACHE`) and refreshed incrementally on every call: only files whose size or modified time changed are re-parsed, so a warm call takes tens of milliseconds and a cold one well under a second for a few hundred files.

The script is `scripts/repomap.mjs` next to this file. Run it from anywhere inside the repository (it finds the git root; `--root DIR` overrides). For the default personal install:

```sh
node "$HOME/.claude/skills/repomap/scripts/repomap.mjs" <command> [args]
```

(This works in bash, zsh and PowerShell. For a project install use `.claude/skills/repomap/scripts/repomap.mjs`; if the package is installed globally, `repomap <command>` also works. Below, `repomap` stands for whichever applies.)

## Commands

| Command | Use it for | Output |
| --- | --- | --- |
| `repomap overview [--budget 6000]` | First look at a repository | Languages, key files (package.json scripts, Dockerfile, CI, manifests), directory sizes, then files ranked by how many others import them, with their top symbols. Capped at the budget, in characters. |
| `repomap search <words...>` | "Where is X handled?", instead of a grep | Top files ranked by the words in paths, symbol names (camelCase-aware) and doc comments, each with the matching symbols' line ranges. |
| `repomap find <name>` | Where a symbol is defined | `file:start-end kind Parent.name  // doc` plus the declaration line. Exact match first, then case-insensitive, then substring. Finds class methods and helpers nested inside factory functions too. |
| `repomap outline <file>` | Before reading a file | Every symbol with its line range and doc line. Then read only the range you need. |
| `repomap refs <name>` | Callers and uses of an identifier | `file:line: code` for each whole-word use, definitions excluded. |
| `repomap deps <file>` / `rdeps <file>` | What a file imports / what imports it (impact of a change) | Files resolved inside the repository. |
| `repomap build` | Force or time a refresh | Counts and the cache path. |

Flags: `--limit N`, `--budget N` (overview), `--json` (machine-readable), `--root DIR`. File arguments accept a repo-relative path, an absolute path, or a unique suffix such as `web.ts`.

## How to use it to save tokens

1. Unfamiliar repository: run `overview` once instead of listing and opening files.
2. Locating code: `search` or `find` instead of `grep -rn`.
3. Before opening a file: `outline` it, then read only the line range of the symbol you need (for example Read with offset and limit). Do not read whole files to find one function.
4. Before changing a symbol: `refs <name>` for its uses and `rdeps <file>` for the files that import it.
5. Fall back to `rg`/`grep` only for what an index cannot answer: string literals, config values, comments, error messages, languages it does not cover, or when a result looks incomplete.

## Limits

- Extraction is regex- and brace-based, not a full parser. It is right for normal code, but macro-generated symbols, unusual formatting or code inside template strings can be missed or mis-ranged. If a range looks wrong, read a few lines around it.
- `refs` is a whole-word text match: it cannot tell apart two different symbols with the same name.
- Skipped: files over 1 MB, binary files, `.gitignore`d files, and build output or dependency folders even when committed (`node_modules`, `dist`, `release`, `coverage`, `vendor`, ...).
