// Tests for repomap.mjs. Run: npm test (or node --test test/)
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildIndex, extract, findSymbols, outline, refs, deps, rdeps, search, overview } from '../skills/repomap/scripts/repomap.mjs';

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'repomap-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}
const cacheDir = () => mkdtempSync(join(tmpdir(), 'repomap-cache-'));

test('TypeScript: exported functions, classes with method ranges, interfaces, types, consts, doc lines', () => {
  const src = [
    "import { join } from 'node:path';",
    "import { helper } from './util';",
    '',
    '/** Starts the server on a port. */',
    'export async function startServer(port: number): Promise<void> {',
    '  const x = { a: 1 };',
    '  if (x) { return; }',
    '}',
    '',
    'export class Engine extends Base {',
    '  private items = new Map<string, number>();',
    '  /** Saves one device. */',
    '  async saveDevice(d: Device): Promise<void> {',
    "    const s = '}';",
    '  }',
    '  static create(): Engine { return new Engine(); }',
    '}',
    '',
    'export interface Device { id: string }',
    "export type Kind = 'a' | 'b';",
    'export const MAX_SIZE = 16;',
    'export const pick = (n: number) => n + 1;',
    'function localOnly() {}',
  ].join('\n');
  const r = extract('src/server.ts', src);
  const by = Object.fromEntries(r.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(by.startServer.kind, 'function');
  assert.equal(by.startServer.line, 5);
  assert.equal(by.startServer.end, 8);
  assert.equal(by.startServer.exported, true);
  assert.equal(by.startServer.doc, 'Starts the server on a port.');
  assert.equal(by.Engine.kind, 'class');
  assert.equal(by.Engine.line, 10);
  assert.equal(by.Engine.end, 17, 'a brace inside a string must not end the class early');
  assert.equal(by['Engine.saveDevice'].kind, 'method');
  assert.equal(by['Engine.saveDevice'].line, 13);
  assert.equal(by['Engine.saveDevice'].end, 15);
  assert.equal(by['Engine.saveDevice'].doc, 'Saves one device.');
  assert.equal(by['Engine.create'].line, 16);
  assert.equal(by.Device.kind, 'interface');
  assert.equal(by.Kind.kind, 'type');
  assert.equal(by.MAX_SIZE.kind, 'const');
  assert.equal(by.pick.kind, 'function');
  assert.equal(by.localOnly.exported, false);
  assert.deepEqual(r.imports, ['node:path', './util']);
});

test('TypeScript: regex literals containing quotes, braces or backticks do not throw off brace depth', () => {
  const src = [
    "const A = /^'(\\\\.|[^\\\\'])'/;",
    'const B = /[{]x/g, C = s.replace(/`/g, "");',
    'function f(s) { return /}"/.test(s) ? 1 / 2 : s.split(/[{}]/); }',
    'export function after() {',
    '  return 1;',
    '}',
  ].join('\n');
  const r = extract('src/re.ts', src);
  const after = r.symbols.find((s) => s.name === 'after');
  assert.ok(after, 'the function after the regex literals is found at top level');
  assert.equal(after.line, 4);
  assert.equal(after.end, 6);
  assert.equal(r.symbols.find((s) => s.name === 'f').end, 3, 'division and regex on one line keep the range');
});

test('TypeScript: helpers declared inside a factory function are indexed with the factory as parent', () => {
  const src = [
    'export function createWeb(o: Options): Web {',
    '  const sessions = new Map();',
    '  const sessionOf = (req: Req): string | undefined => {',
    '    return undefined;',
    '  };',
    '  /** Checks the password. */',
    '  async function postLogin(req: Req) {',
    '    items.forEach((x) => x);',
    '  }',
    '  return { handle() {} };',
    '}',
  ].join('\n');
  const r = extract('src/server/web.ts', src);
  const by = Object.fromEntries(r.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(by['createWeb.sessionOf'].kind, 'function');
  assert.equal(by['createWeb.sessionOf'].line, 3);
  assert.equal(by['createWeb.sessionOf'].end, 5);
  assert.equal(by['createWeb.postLogin'].line, 7);
  assert.equal(by['createWeb.postLogin'].end, 9);
  assert.equal(by['createWeb.postLogin'].doc, 'Checks the password.');
  assert.equal(by['createWeb.sessions'], undefined, 'plain inner values are not indexed');
});

test('Python: classes, methods by indentation, functions, docstrings, imports', () => {
  const src = [
    'import os',
    'from .db import connect',
    '',
    'class Store:',
    '    """Holds rows."""',
    '    def get(self, k):',
    '        return k',
    '',
    '    def put(self, k, v):',
    '        pass',
    '',
    'async def main():',
    '    pass',
  ].join('\n');
  const r = extract('app/store.py', src);
  const by = Object.fromEntries(r.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(by.Store.kind, 'class');
  assert.equal(by.Store.end, 10);
  assert.equal(by.Store.doc, 'Holds rows.');
  assert.equal(by['Store.get'].line, 6);
  assert.equal(by['Store.put'].end, 10);
  assert.equal(by.main.kind, 'function');
  assert.deepEqual(r.imports, ['os', '.db']);
});

test('Go, Rust, Kotlin, shell and Markdown basics', () => {
  const go = extract('pkg/srv.go', 'package srv\n\nimport (\n\t"fmt"\n\t"example.com/x/db"\n)\n\n// Server serves.\ntype Server struct {\n\tn int\n}\n\nfunc (s *Server) Run() error {\n\treturn nil\n}\n\nfunc New() *Server { return &Server{} }\n');
  const g = Object.fromEntries(go.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(g.Server.kind, 'struct');
  assert.equal(g.Server.doc, 'Server serves.');
  assert.equal(g['Server.Run'].kind, 'method');
  assert.equal(g['Server.Run'].end, 15);
  assert.equal(g.New.exported, true);
  assert.deepEqual(go.imports, ['fmt', 'example.com/x/db']);

  const rs = extract('src/lib.rs', 'use crate::db::Pool;\n\npub struct Pool { n: u32 }\n\nimpl Pool {\n    pub fn new() -> Self {\n        Pool { n: 0 }\n    }\n}\n\npub trait Store {}\nfn helper() {}\n');
  const r = Object.fromEntries(rs.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(r.Pool.kind, 'struct');
  assert.equal(r['Pool.new'].kind, 'method');
  assert.equal(r.Store.kind, 'trait');
  assert.equal(r.helper.exported, false);

  const kt = extract('app/src/Main.kt', 'package io.x\n\nimport android.os.Bundle\n\nclass MainActivity : Activity() {\n    override fun onCreate(b: Bundle?) {\n        super.onCreate(b)\n    }\n}\n\nobject NavPolicy {\n    fun navFor(u: String): Int = 1\n}\n');
  const k = Object.fromEntries(kt.symbols.map((s) => [s.parent ? `${s.parent}.${s.name}` : s.name, s]));
  assert.equal(k.MainActivity.kind, 'class');
  assert.equal(k['MainActivity.onCreate'].line, 6);
  assert.equal(k.NavPolicy.kind, 'object');
  assert.equal(k['NavPolicy.navFor'].kind, 'method');
  assert.deepEqual(kt.imports, ['android.os.Bundle']);

  const sh = extract('docker/entrypoint.sh', '#!/bin/sh\nsetup() {\n  echo hi\n}\nfunction run {\n  :\n}\n');
  assert.deepEqual(sh.symbols.map((s) => s.name), ['setup', 'run']);

  const md = extract('README.md', '# Title\n\ntext\n\n## Setup\n\nmore\n');
  assert.deepEqual(md.symbols.map((s) => [s.name, s.kind, s.line]), [['Title', 'h1', 1], ['Setup', 'h2', 5]]);
});

test('buildIndex walks a non-git folder, skips node_modules/dist/binaries, and caches by mtime and size', () => {
  const root = repo({
    'src/a.ts': "import { b } from './b';\nexport function a() { return b(); }\n",
    'src/b.ts': 'export function b() { return 1; }\n',
    'node_modules/x/index.js': 'export function nope() {}\n',
    'dist/out.js': 'export function built() {}\n',
    'img.png': '\x89PNG\r\n\x1a\n\0\0\0binary',
  });
  const cache = cacheDir();
  try {
    const first = buildIndex(root, { cacheDir: cache });
    assert.deepEqual(Object.keys(first.index.files).sort(), ['src/a.ts', 'src/b.ts']);
    assert.equal(first.parsed, 2);
    const second = buildIndex(root, { cacheDir: cache });
    assert.equal(second.parsed, 0, 'unchanged files come from the cache');
    writeFileSync(join(root, 'src/b.ts'), 'export function b() { return 2; }\nexport function c() {}\n');
    const t = new Date(Date.now() + 5000);
    utimesSync(join(root, 'src/b.ts'), t, t);
    const third = buildIndex(root, { cacheDir: cache });
    assert.equal(third.parsed, 1, 'only the changed file is re-parsed');
    assert.ok(findSymbols(third.index, 'c').some((s) => s.file === 'src/b.ts'));
    rmSync(join(root, 'src/a.ts'));
    const fourth = buildIndex(root, { cacheDir: cache });
    assert.deepEqual(Object.keys(fourth.index.files), ['src/b.ts'], 'deleted files leave the index');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('in a git repo, build output committed to git (dist/, coverage/) is still skipped, and untracked files are included', (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git is not installed'); return; }
  const root = repo({ 'src/a.ts': 'export function a() {}\n', 'dist/a.js': 'export function a() {}\n', '.gitignore': 'ignored.ts\n', 'ignored.ts': 'export function x() {}\n' });
  const cache = cacheDir();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'src', 'dist', '.gitignore'], { cwd: root });
    writeFileSync(join(root, 'src/new.ts'), 'export function fresh() {}\n');
    const { index } = buildIndex(root, { cacheDir: cache });
    assert.deepEqual(Object.keys(index.files).sort(), ['src/a.ts', 'src/new.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('find, outline, refs, deps, rdeps and search answer from the index', () => {
  const root = repo({
    'src/server/web.ts': "import { Engine } from '../app/engine';\nimport { log } from '../app/log.js';\n\n/** Handles the login form. */\nexport function postLogin(req: Req) {\n  const e = new Engine();\n  e.saveDevice({});\n  log('login ok');\n}\n",
    'src/app/engine.ts': "import { log } from './log';\n\nexport class Engine {\n  saveDevice(d: unknown) {\n    log('saved');\n  }\n}\n",
    'src/app/log.ts': 'export function log(m: string) {}\n',
    'src/app/index.ts': "export * from './engine';\n",
    'README.md': '# Demo\n\n## Login\n',
  });
  const cache = cacheDir();
  try {
    const { index } = buildIndex(root, { cacheDir: cache });
    const f = findSymbols(index, 'saveDevice');
    assert.equal(f.length, 1);
    assert.equal(f[0].file, 'src/app/engine.ts');
    assert.equal(f[0].line, 4);
    assert.equal(f[0].parent, 'Engine');
    assert.ok(findSymbols(index, 'savedev').length >= 1, 'case-insensitive substring fallback');

    const o = outline(index, 'src/app/engine.ts');
    assert.deepEqual(o.map((s) => s.name), ['Engine', 'saveDevice']);

    const r = refs(index, root, 'saveDevice');
    assert.deepEqual(r.map((x) => `${x.file}:${x.line}`), ['src/server/web.ts:7'], 'refs excludes the definition line');

    assert.deepEqual(deps(index, 'src/server/web.ts'), ['src/app/engine.ts', 'src/app/log.ts']);
    assert.deepEqual(rdeps(index, 'src/app/log.ts'), ['src/app/engine.ts', 'src/server/web.ts']);
    assert.deepEqual(rdeps(index, 'src/app/engine.ts'), ['src/app/index.ts', 'src/server/web.ts']);

    const s = search(index, 'login form');
    assert.equal(s[0].file, 'src/server/web.ts', 'doc text and symbol names rank the right file first');
    assert.ok(s[0].hits.some((h) => h.includes('postLogin')));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('overview stays within its character budget and lists languages, dirs and key files', () => {
  const files = {};
  for (let i = 0; i < 200; i++) files[`src/mod${i}/file${i}.ts`] = `export function fn${i}() {}\nexport class C${i} {}\n`;
  files['package.json'] = JSON.stringify({ name: 'demo', main: 'dist/main.js', scripts: { test: 'node --test' } });
  const root = repo(files);
  const cache = cacheDir();
  try {
    const { index } = buildIndex(root, { cacheDir: cache });
    const text = overview(index, { budget: 3000 });
    assert.ok(text.length <= 3000, `overview is ${text.length} chars`);
    assert.match(text, /ts\s+200/);
    assert.match(text, /package\.json/);
    assert.match(text, /\(\+\d+ more/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

// ---- CLI ----
const SCRIPT = fileURLToPath(new URL('../skills/repomap/scripts/repomap.mjs', import.meta.url));
const cli = (args, opts = {}) => spawnSync(process.execPath, [opts.script ?? SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, REPOMAP_CACHE: opts.cache } });

test('CLI: find, outline and search print file:line ranges; --json is machine-readable; errors exit 1', () => {
  const root = repo({ 'src/app.ts': '/** Boots the app. */\nexport function boot() {\n  return 1;\n}\n' });
  const cache = cacheDir();
  try {
    const find = cli(['--root', root, 'find', 'boot'], { cache });
    assert.equal(find.status, 0, find.stderr);
    assert.match(find.stdout, /^src\/app\.ts:2-4 function boot {2}\/\/ Boots the app\./m);
    const json = JSON.parse(cli(['--root', root, 'outline', 'app.ts', '--json'], { cache }).stdout);
    assert.equal(json.file, 'src/app.ts');
    assert.equal(json.symbols[0].name, 'boot');
    assert.match(cli(['--root', root, 'search', 'boots'], { cache }).stdout, /src\/app\.ts/);
    const bad = cli(['--root', root, 'outline', 'missing.ts'], { cache });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not in the index/);
    assert.match(cli(['help']).stdout, /overview/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('CLI: runs when invoked through a symlink (how npm installs bin scripts on Linux and macOS)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'repomap-bin-'));
  const link = join(dir, 'repomap.mjs');
  try {
    try { symlinkSync(SCRIPT, link); } catch { t.skip('symlinks are not permitted here'); return; }
    const r = cli(['help'], { script: link });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /overview/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
