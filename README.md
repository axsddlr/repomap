# repomap

**A fast, dependency-free code index for coding agents.** repomap extracts every function, class, method and import in a repository, with exact line ranges and the first line of each doc comment, caches it, and answers small queries. Agents use it instead of grepping and reading whole files, so they spend far fewer tokens finding the code that matters.

- **One file, no dependencies:** a single Node 18+ script. No Python, no tree-sitter, no native modules, no model calls.
- **Fast and incremental:** a few hundred files index in well under a second; after that only changed files are re-parsed, so a call takes tens of milliseconds.
- **Small output:** answers are `file:start-end` ranges, not file dumps. On a 163-file TypeScript/Kotlin project, `repomap search login lockout` printed 828 characters; the equivalent `rg -n -i "login|lockout"` printed 13 KB.
- **Ships as a Claude Code skill** with instructions that teach the agent to query it before grep. It also works as a plain CLI for any agent or person.

Run on this repository:

```text
$ repomap find buildIndex
skills/repomap/scripts/repomap.mjs:388-418 function buildIndex  // Builds or incrementally refreshes the index of `root`. Only files whose mtime or size changed are parsed.
    export function buildIndex(root, opts = {}) {

$ repomap outline repomap.mjs
skills/repomap/scripts/repomap.mjs (680 lines)
  ...
  200-358 function extract  // Extracts symbols and imports from one file's source.
    206-214 function extract.add (local)
  388-418 function buildIndex  // Builds or incrementally refreshes the index of `root`. Only files whose mtime or size changed are parsed.
  452-470 function refs
  547-585 function search
  ...

$ repomap refs braceDepths
skills/repomap/scripts/repomap.mjs:257: const depth = braceDepths(lines, lang);
```

## Install

### As a Claude Code skill

With the [skills CLI](https://skills.sh):

```sh
npx skills add axsddlr/repomap --skill repomap            # this project
npx skills add axsddlr/repomap --skill repomap --global   # all projects
```

Or by hand:

```sh
git clone https://github.com/axsddlr/repomap
cp -r repomap/skills/repomap ~/.claude/skills/repomap      # PowerShell: Copy-Item -Recurse repomap\skills\repomap $HOME\.claude\skills\repomap
```

Claude Code picks the skill up from its description. To make every session use it before grep, add this to your `~/.claude/CLAUDE.md` (or a project `CLAUDE.md`, or `AGENTS.md` for other agents):

```markdown
## Code search

- Before grep, glob or reading whole files in a repo, use repomap: `node "$HOME/.claude/skills/repomap/scripts/repomap.mjs" overview|search <words>|find <name>|outline <file>|refs <name>|deps <file>|rdeps <file>`, then read only the line ranges it returns. Fall back to `rg` for string literals, config values, comments, or when its result looks incomplete.
```

### As a CLI

```sh
npx github:axsddlr/repomap overview          # run without installing
npm install -g github:axsddlr/repomap        # then: repomap <command>
node path/to/skills/repomap/scripts/repomap.mjs <command>   # or just run the file
```

## Commands

Run from anywhere inside a repository (repomap finds the git root; `--root DIR` overrides).

| Command | What it answers |
| --- | --- |
| `overview [--budget N]` | Languages, key files (package.json scripts, Dockerfile, CI, manifests), directory sizes, then files ranked by how many others import them, with their top symbols, within a character budget (default 6000). |
| `search <words...>` | Files ranked by the words in paths, symbol names (camelCase-aware) and doc comments, each with the matching symbols' line ranges. |
| `find <name>` | Where a symbol is defined: exact match, then case-insensitive, then substring. Includes class methods and helpers nested in factory functions. |
| `outline <file>...` | Every symbol in a file with its line range and doc line. |
| `refs <name>` | Whole-word uses of an identifier, definitions excluded. |
| `deps <file>` / `rdeps <file>` | Files this file imports / files that import it, resolved inside the repository. |
| `build` | Refresh the index and print counts, time and cache path. |

Flags: `--json` (machine-readable output), `--limit N`, `--budget N`, `--root DIR`. Files can be given as repo-relative or absolute paths, or as a unique suffix (`web.ts`).

## How it works

- **Files:** `git ls-files --cached --others --exclude-standard` (honours `.gitignore`), or a directory walk outside git. Build output and dependency folders (`node_modules`, `dist`, `release`, `coverage`, `vendor`, ...) are skipped even when committed; so are binary files and files over 1 MB.
- **Extraction:** per-language regexes plus a brace-depth pass that skips strings and comments, which gives line ranges for C-like languages. Python uses indentation. Doc lines come from JSDoc/`///`/`//`/`#` comments above a declaration or the first docstring line.
- **Languages:** TypeScript and JavaScript (functions, classes, methods, interfaces, types, enums, exported consts, helpers nested in functions), Python, Go, Rust, Kotlin, Java, C#, shell functions and Markdown headings.
- **Imports:** TS/JS relative imports (including `.js`-to-`.ts` and `index` files, `export ... from`, `require`, dynamic `import()`), Python modules (relative and absolute), Rust `crate::`/`super::`, Kotlin/Java packages and Go module paths.
- **Cache:** one JSON file per repository in `~/.cache/repomap/` (override with `REPOMAP_CACHE`), never inside the repository. Entries are refreshed by file size and modified time; a new version of the script re-indexes everything once.

## Compared with graph-based tools

Tools such as [graphify](https://github.com/Graphify-Labs/graphify) build a full knowledge graph with tree-sitter, send documents and images through a model, and render a visualisation. repomap does only the part agents use constantly, which is answering "where is it, and which lines do I read?". It does that in one file that starts instantly. The trade-off is that extraction is regex-based, not a full parser: unusual formatting or macro-generated code can be missed, and `refs` is a text match that cannot tell two symbols with the same name apart.

## Development

```sh
npm test        # node --test: fixture repositories per language, the cache, git and non-git listing, every query, and the CLI
```

CI runs the tests on Linux, Windows and macOS with Node 18, 20, 22 and 24. Adding a language means extending `extract()` in `skills/repomap/scripts/repomap.mjs` and adding a fixture test in `test/repomap.test.mjs`.

## License

MIT
