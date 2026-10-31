#!/usr/bin/env node
// Install the repomap skill into the folder an agent runtime reads.
//
// Usage: node platforms/install.mjs --target <claude|codex|dsh> [--project] [--dir DIR] [--force] [--list]
//
// The skill itself is portable (agentskills.io: one SKILL.md plus scripts/), so this script does not
// contain a copy of it: it decides where the canonical skills/repomap lands per runtime, and for Codex
// adds the agents/openai.yaml manifest that runtime reads.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', 'skills', 'repomap');
const NAME = 'repomap';

// user() is the per-user directory the runtime scans. project() is the repo-scoped one, where the
// runtime has one; null means the runtime only reads its own per-user directory.
const TARGETS = {
  claude: {
    label: 'Claude Code',
    user: () => join(homedir(), '.claude', 'skills'),
    project: () => join(process.cwd(), '.claude', 'skills'),
  },
  codex: {
    label: 'Codex CLI',
    user: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills'),
    project: null,
  },
  dsh: {
    label: 'DeepSeek Harness',
    user: () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'skills'),
    project: () => join(process.cwd(), '.dsh', 'skills'),
  },
};

const USAGE = `Install the ${NAME} skill for an agent runtime.

Usage: node platforms/install.mjs --target <${Object.keys(TARGETS).join('|')}> [options]

Options:
  --target NAME  runtime to install for (required unless --list)
  --project      install into the current repository instead of the user profile
  --dir DIR       install into DIR/${NAME} instead of a runtime default
  --force        replace an existing install
  --list         print each runtime's install directory and exit
  --help         print this message

The same skill folder works in every runtime; only the destination differs.`;

function parse(argv) {
  const opts = { target: undefined, project: false, dir: undefined, force: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') opts.target = argv[++i];
    else if (a === '--project') opts.project = true;
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--force') opts.force = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else throw new Error(`unknown argument: ${a} (try --help)`);
  }
  return opts;
}

function targetOf(name) {
  const target = TARGETS[name];
  if (!target) throw new Error(`unknown target: ${name} (use ${Object.keys(TARGETS).join(', ')})`);
  return target;
}

function resolveDest(opts) {
  if (opts.dir) return { dir: resolve(opts.dir), label: opts.target ? targetOf(opts.target).label : 'custom directory', target: opts.target };
  const target = targetOf(opts.target);
  const pick = opts.project ? target.project : target.user;
  if (!pick) {
    throw new Error(
      `${target.label} reads only ${target.user()} (per machine), so --project does not apply. ` +
      'Drop --project, or use --dir DIR to place the skill anywhere.',
    );
  }
  return { dir: pick(), label: target.label, target: opts.target };
}

function main(argv) {
  const opts = parse(argv);
  if (opts.list) {
    for (const [name, t] of Object.entries(TARGETS)) {
      const project = t.project ? t.project() : '(per machine only)';
      process.stdout.write(`${name.padEnd(7)} ${t.label.padEnd(20)} ${t.user()}\n${''.padEnd(7)} ${'project:'.padEnd(20)} ${project}\n`);
    }
    return 0;
  }
  if (!opts.target && !opts.dir) throw new Error('a --target is required (try --list, or --help)');
  const { dir, label, target } = resolveDest(opts);
  const dest = join(dir, NAME);
  if (existsSync(dest) && !opts.force) throw new Error(`${dest} already exists; re-run with --force to replace it`);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(SOURCE, dest, { recursive: true });
  // Codex reads an optional agents/openai.yaml for UI metadata; the other runtimes ignore it.
  if (target === 'codex') cpSync(join(HERE, 'codex', 'agents'), join(dest, 'agents'), { recursive: true });
  process.stdout.write(`installed ${label} skill: ${dest}\n`);
  process.stdout.write(`next: node "${join(dest, 'scripts', 'repomap.mjs')}" overview\n`);
  if (opts.project) process.stdout.write('project install: start or restart the agent inside this repository so it reloads skills.\n');
  else if (target !== 'codex') process.stdout.write('user install: new agent sessions pick it up.\n');
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`install: ${e.message}\n`);
  process.exitCode = 1;
}
