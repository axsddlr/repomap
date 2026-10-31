// Tests for platforms/install.mjs. Run: npm test
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const INSTALL = fileURLToPath(new URL('../platforms/install.mjs', import.meta.url));
const SKILL = fileURLToPath(new URL('../skills/repomap', import.meta.url));
const run = (args) => spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8' });
const read = (p) => readFileSync(p, 'utf8');

test('install.mjs --list prints every runtime destination', () => {
  const r = run(['--list']);
  assert.equal(r.status, 0, r.stderr);
  for (const label of ['Claude Code', 'Codex CLI', 'DeepSeek Harness']) assert.match(r.stdout, new RegExp(label));
  assert.match(r.stdout, /\.claude/);
  assert.match(r.stdout, /\.codex/);
  assert.match(r.stdout, /\.dsh/);
});

test('install.mjs copies the shared skill unchanged, and the Codex manifest only for codex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repomap-install-'));
  try {
    for (const target of ['claude', 'codex', 'dsh']) {
      const dest = join(dir, target);
      const r = run(['--target', target, '--dir', dest]);
      assert.equal(r.status, 0, r.stderr);
      const skill = join(dest, 'repomap');
      assert.equal(read(join(skill, 'SKILL.md')), read(join(SKILL, 'SKILL.md')), `${target}: SKILL.md is the canonical one`);
      assert.equal(read(join(skill, 'scripts', 'repomap.mjs')), read(join(SKILL, 'scripts', 'repomap.mjs')), `${target}: script is the canonical one`);
      assert.equal(existsSync(join(skill, 'agents', 'openai.yaml')), target === 'codex', `${target}: agents/openai.yaml presence`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install.mjs refuses to replace a skill without --force, and the result runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repomap-install-'));
  try {
    assert.equal(run(['--target', 'dsh', '--dir', dir]).status, 0);
    const again = run(['--target', 'dsh', '--dir', dir]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    assert.equal(run(['--target', 'dsh', '--dir', dir, '--force']).status, 0);
    const help = spawnSync(process.execPath, [join(dir, 'repomap', 'scripts', 'repomap.mjs'), 'help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /overview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install.mjs rejects an unknown target, no target, and --project for Codex', () => {
  const bad = run(['--target', 'nope']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown target/);
  assert.equal(run([]).status, 1, 'no target is an error');
  const noProject = run(['--target', 'codex', '--project']);
  assert.equal(noProject.status, 1);
  assert.match(noProject.stderr, /--project does not apply/);
});
