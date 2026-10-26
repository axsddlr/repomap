# Changelog

## 0.1.0 (2026-10-26)

First release.

- Commands: `overview`, `search`, `find`, `outline`, `refs`, `deps`, `rdeps`, `build`, with `--json`, `--limit`, `--budget` and `--root`.
- Languages: TypeScript/JavaScript (including helpers nested in factory functions), Python, Go, Rust, Kotlin, Java, C#, shell and Markdown headings.
- Import resolution for TS/JS relative imports (including `.js`-to-`.ts` and `index` files), Python modules, Rust `crate::`/`super::` paths, Kotlin/Java packages and Go module paths.
- Incremental cache outside the repository, keyed by repository path and refreshed by file size and modified time; changing the script re-indexes everything once.
- Files come from `git ls-files` (tracked plus untracked, honouring `.gitignore`), or a directory walk outside git; build output and dependency folders are skipped even when committed.
- Claude Code skill (`skills/repomap/SKILL.md`) and an npm `bin` entry.
