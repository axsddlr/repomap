# Changelog

## Unreleased

- Platform installers: `platforms/` documents and installs the skill for Claude Code, Codex CLI and DeepSeek Harness with `node platforms/install.mjs --target <runtime>` (plus `--project`, `--dir`, `--force`, `--list`). Codex additionally gets `agents/openai.yaml`; the skill folder itself stays single-source and agentskills-compliant.
- File-level doc line: `extract()` now returns one description per file — the Python module docstring, the leading comment block (JS/TS, Go, Rust, Kotlin, Java, C#, shell; JSDoc tags and license banners skipped), or the first Markdown paragraph. `overview` prints it next to each path, and `outline --json` includes it. An empty or missing doc yields no `doc` field rather than an error.

## 0.1.0 (2026-10-26)

First release.

- Commands: `overview`, `search`, `find`, `outline`, `refs`, `deps`, `rdeps`, `build`, with `--json`, `--limit`, `--budget` and `--root`.
- Languages: TypeScript/JavaScript (including helpers nested in factory functions), Python, Go, Rust, Kotlin, Java, C#, shell and Markdown headings.
- Import resolution for TS/JS relative imports (including `.js`-to-`.ts` and `index` files), Python modules, Rust `crate::`/`super::` paths, Kotlin/Java packages and Go module paths.
- Incremental cache outside the repository, keyed by repository path and refreshed by file size and modified time; changing the script re-indexes everything once.
- Files come from `git ls-files` (tracked plus untracked, honouring `.gitignore`), or a directory walk outside git; build output and dependency folders are skipped even when committed.
- Claude Code skill (`skills/repomap/SKILL.md`) and an npm `bin` entry.
