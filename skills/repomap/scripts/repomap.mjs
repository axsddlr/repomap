#!/usr/bin/env node
// repomap: a fast, dependency-free repository index for coding agents.
// Extracts symbols (with line ranges and doc lines) and imports with per-language regexes, caches them
// outside the repo keyed by file mtime and size, and answers small queries so an agent can read only the
// lines it needs instead of grepping and reading whole files.
//
// Usage: node repomap.mjs [--root DIR] <command> [args] [--limit N] [--budget N] [--json]
//   overview            languages, key files, directories and the most central files (budgeted)
//   outline <file>...   symbols of a file with line ranges
//   find <name>         where a symbol is defined (exact, then case-insensitive, then substring)
//   refs <name>         lines that use an identifier (definitions excluded)
//   deps <file>         files this file imports (resolved inside the repo)
//   rdeps <file>        files that import this file
//   search <words...>   files ranked by words in paths, symbol names and doc lines
//   build | stats       (re)index and report counts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The cache is keyed on this script's own content, so changing the extractor re-indexes everything once.
const VERSION = createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);
const MAX_BYTES = 1_000_000;
const LANG = {
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.go': 'go', '.rs': 'rs', '.kt': 'kt', '.kts': 'kt', '.java': 'java', '.cs': 'cs',
  '.sh': 'sh', '.bash': 'sh', '.md': 'md',
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'release', 'target', 'coverage', '.next', '.nuxt',
  '.venv', 'venv', '__pycache__', '.gradle', '.idea', '.vs', 'bin', 'obj', '.cache', '.turbo', '.parcel-cache']);
const GIT_SKIP = new Set(['node_modules', 'dist', 'release', 'coverage', '.next', '.nuxt', '__pycache__', 'vendor', 'third_party', 'bower_components']);
const KEYWORDS =new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'function', 'super', 'else', 'do', 'try',
  'throw', 'typeof', 'await', 'yield', 'delete', 'void', 'in', 'of', 'with', 'case', 'when', 'using', 'lock', 'foreach', 'sizeof', 'match']);

// ---------------------------------------------------------------- extraction

const indentOf = (s) => s.length - s.trimStart().length;
const clip = (s, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// A '/' starts a JS regex literal (not division) after an operator, an opening bracket, a keyword or line start.
const REGEX_BEFORE = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
function regexAllowed(s, j) {
  let p = j - 1;
  while (p >= 0 && /\s/.test(s[p])) p--;
  if (p < 0) return true;
  if (REGEX_BEFORE.has(s[p])) return true;
  if (/[\w$]/.test(s[p])) {
    let a = p;
    while (a > 0 && /[\w$]/.test(s[a - 1])) a--;
    return REGEX_KEYWORDS.has(s.slice(a, p + 1));
  }
  return false;
}
/** Index of the last character of the regex literal starting at j (flags included), or j if it does not close on this line. */
function skipRegex(s, j) {
  let k = j + 1, inClass = false;
  while (k < s.length) {
    const c = s[k];
    if (c === '\\') { k += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    k++;
  }
  if (k >= s.length) return j;
  while (k + 1 < s.length && /[a-z]/i.test(s[k + 1])) k++;
  return k;
}

/** Per-line brace depth with strings and comments skipped (good enough for C-like languages). */
function braceDepths(lines, lang) {
  const n = lines.length;
  const before = new Int32Array(n), after = new Int32Array(n), maxIn = new Int32Array(n);
  const hash = lang === 'sh' || lang === 'py';
  const tplQuote = lang === 'ts' || lang === 'js' || lang === 'go';
  let d = 0, st = null;
  for (let i = 0; i < n; i++) {
    const s = lines[i];
    before[i] = d;
    let mx = d;
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      if (st === 'block') { if (c === '*' && s[j + 1] === '/') { st = null; j++; } continue; }
      if (st === 'tpl') { if (c === '\\') { j++; continue; } if (c === '`') st = null; continue; }
      if (c === '"' || (c === "'" && lang !== 'rs')) {
        let k = j + 1;
        while (k < s.length && s[k] !== c) { if (s[k] === '\\') k++; k++; }
        j = k;
        continue;
      }
      if (c === "'" && lang === 'rs') { const m = /^'(\\.|[^\\'])'/.exec(s.slice(j)); if (m) j += m[0].length - 1; continue; }
      if (tplQuote && c === '`') { st = 'tpl'; continue; }
      if (hash && c === '#') break;
      if (!hash && c === '/' && s[j + 1] === '/') break;
      if (!hash && c === '/' && s[j + 1] === '*') { st = 'block'; j++; continue; }
      if ((lang === 'ts' || lang === 'js') && c === '/' && regexAllowed(s, j)) { j = skipRegex(s, j); continue; }
      if (c === '{') { d++; if (d > mx) mx = d; } else if (c === '}') d--;
    }
    after[i] = d;
    maxIn[i] = mx;
  }
  return { before, after, maxIn };
}

const CONTINUES = /([(,=:|&<[{+\-*/?]|=>|->|\bextends|\bimplements|\bwhere)\s*$/;
function stripComment(s) { return s.replace(/\s\/\/.*$/, '').replace(/^\s*\/\/.*$/, ''); }

/** Last line of the declaration starting at line i: brace-matched body, or the end of a bodiless declaration. */
function blockEnd(lines, depth, i) {
  const d0 = depth.before[i];
  let opened = false;
  for (let j = i; j < lines.length && j < i + 5000; j++) {
    if (depth.maxIn[j] > d0) opened = true;
    if (opened && depth.after[j] <= d0) return j;
    if (!opened) {
      const t = stripComment(lines[j]).trim();
      if (t.endsWith(';')) return j;
      if (t && !CONTINUES.test(t)) {
        let k = j + 1;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && lines[k].trim().startsWith('{')) continue;
        return j;
      }
    }
  }
  return i;
}

function pyEnd(lines, i) {
  const ind = indentOf(lines[i]);
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (!t || t.startsWith('#')) continue;
    if (indentOf(lines[j]) <= ind) break;
    last = j;
  }
  return last;
}

/** First line of the comment or docstring that documents the declaration at line i. */
function docFor(lines, i, lang) {
  if (lang === 'py') {
    let k = i + 1;
    while (k < lines.length && !lines[k].trim()) k++;
    const t = (lines[k] ?? '').trim();
    const m = /^[rubf]*("""|''')(.*)$/i.exec(t);
    if (m) {
      const inner = m[2].replace(/("""|''').*$/, '').trim();
      if (inner) return clip(inner);
      const next = (lines[k + 1] ?? '').trim();
      return next ? clip(next.replace(/("""|''').*$/, '')) : undefined;
    }
  }
  let k = i - 1;
  while (k >= 0 && /^\s*(@|#\[)/.test(lines[k])) k--;
  if (k < 0) return undefined;
  const t = lines[k].trim();
  const hashStyle = lang === 'py' || lang === 'sh';
  if (t.endsWith('*/')) {
    let a = k;
    while (a > 0 && !/\/\*/.test(lines[a])) a--;
    for (let j = a; j <= k; j++) {
      const x = lines[j].trim().replace(/^\/\*+!?/, '').replace(/\*+\/$/, '').replace(/^\*\s?/, '').trim();
      if (x && !x.startsWith('@')) return clip(x);
    }
    return undefined;
  }
  const lineComment = hashStyle ? /^#(?!!)\s?/ : /^\/\/\/?\s?/;
  if (lineComment.test(t)) {
    let a = k;
    while (a > 0 && lineComment.test(lines[a - 1].trim())) a--;
    for (let j = a; j <= k; j++) {
      const x = lines[j].trim().replace(lineComment, '').trim();
      if (x) return clip(x);
    }
  }
  return undefined;
}

const TS_RULES = [
  [/^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 5, 'function'],
  [/^(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 5, 'class'],
  [/^(export\s+)?(declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, 3, 'interface'],
  [/^(export\s+)?(declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(<[^=]*>)?\s*=/, 3, 'type'],
  [/^(export\s+)?(declare\s+)?(const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 4, 'enum'],
  [/^(export\s+)?(declare\s+)?namespace\s+([A-Za-z_$][\w$.]*)/, 3, 'namespace'],
];
const NESTED_FN = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]|^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+?)?\s*=>|\([^)]*$|[A-Za-z_$][\w$]*\s*=>)/;
const TS_MEMBER =/^((?:public|private|protected|static|async|readonly|override|abstract|declare|get|set)\s+|\*\s*)*(#?[A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(/;
const KT_MODS = '(?:(?:public|private|protected|internal|open|abstract|final|override|data|sealed|inline|suspend|operator|infix|tailrec|external|enum|annotation|inner|value|actual|expect|const|lateinit|static|virtual|async|partial|readonly|extern|unsafe|new|synchronized|native|default|strictfp|transient|volatile|record)\\s+)*';
const KT_TYPE = new RegExp(`^${KT_MODS}(class|interface|object|record|struct)\\s+([A-Za-z_][\\w]*)`);
const KT_FUN = new RegExp(`^${KT_MODS}fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?([A-Za-z_][\\w]*)\\s*\\(`);
const CS_METHOD = new RegExp(`^${KT_MODS}(?:[\\w<>\\[\\],.?]+\\s+)+([A-Za-z_][\\w]*)\\s*(<[^>]*>)?\\s*\\(`);

/** Extracts symbols and imports from one file's source. */
export function extract(path, src) {
  const lang = LANG[extname(path).toLowerCase()];
  const lines = src.split(/\r?\n/);
  const symbols = [];
  const imports = [];
  let pkg;
  const add = (s) => {
    const sym = { name: s.name, kind: s.kind, line: s.i + 1, end: s.end + 1, exported: !!s.exported };
    if (s.parent) sym.parent = s.parent;
    const doc = docFor(lines, s.i, lang);
    if (doc) sym.doc = doc;
    sym.sig = clip(lines[s.i].trim());
    symbols.push(sym);
    return sym;
  };

  if (lang === 'md') {
    let fence = false;
    const heads = [];
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (m) heads.push({ i, level: m[1].length, name: m[2] });
    });
    heads.forEach((h, k) => {
      const next = heads.slice(k + 1).find((x) => x.level <= h.level);
      symbols.push({ name: h.name, kind: `h${h.level}`, line: h.i + 1, end: next ? next.i : lines.length, exported: true });
    });
    return { lang, lines: lines.length, symbols, imports };
  }

  if (lang === 'py') {
    const classes = [];
    lines.forEach((l, i) => {
      const t = l.trimStart();
      if (!t || t.startsWith('#')) return;
      const ind = indentOf(l);
      while (classes.length && (i > classes.at(-1).end || ind <= classes.at(-1).ind)) classes.pop();
      let m;
      if ((m = /^import\s+(.+)$/.exec(t)) && ind === 0) for (const part of m[1].split(',')) imports.push(part.trim().split(/\s+as\s+/)[0]);
      else if ((m = /^from\s+(\.*[\w.]*)\s+import\b/.exec(t)) && ind === 0) imports.push(m[1]);
      else if ((m = /^class\s+([A-Za-z_]\w*)/.exec(t))) {
        const parent = classes.at(-1);
        const end = pyEnd(lines, i);
        const sym = add({ name: m[1], kind: 'class', i, end, exported: !m[1].startsWith('_'), parent: parent && ind === parent.body ? parent.name : undefined });
        let k = i + 1;
        while (k <= end && !lines[k].trim()) k++;
        classes.push({ name: sym.name, ind, end: i + (end - i), body: k <= end ? indentOf(lines[k]) : ind + 4 });
      } else if ((m = /^(async\s+)?def\s+([A-Za-z_]\w*)/.exec(t))) {
        const parent = classes.at(-1);
        const isMethod = parent && ind === parent.body;
        if (ind === 0 || isMethod) add({ name: m[2], kind: isMethod ? 'method' : 'function', i, end: pyEnd(lines, i), exported: !m[2].startsWith('_'), parent: isMethod ? parent.name : undefined });
      }
    });
    return { lang, lines: lines.length, symbols, imports };
  }

  const depth = braceDepths(lines, lang);
  const containers = [];
  if (lang === 'ts' || lang === 'js') {
    const re = [/^\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm, /^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g];
    const found = [];
    for (const r of re) for (const m of src.matchAll(r)) found.push([m.index, m[1]]);
    found.sort((a, b) => a[0] - b[0]);
    for (const [, spec] of found) if (!imports.includes(spec)) imports.push(spec);
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (lang === 'sh' && t.startsWith('#'))) continue;
    while (containers.length && i > containers.at(-1).end) containers.pop();
    const top = depth.before[i] === 0;
    const cont = containers.at(-1);
    const member = cont && depth.before[i] === cont.depth + 1;
    let m;
    if (!top && !member) {
      // TS/JS: named helpers declared inside a function body (factory closures) are indexed under that function.
      if ((lang === 'ts' || lang === 'js') && (m = NESTED_FN.exec(t))) {
        const name = m[1] ?? m[2];
        const owner = symbols.filter((s) => !s.parent && s.line <= i + 1 && s.end >= i + 1 && s.kind === 'function').at(-1);
        if (owner) add({ name, kind: 'function', i, end: blockEnd(lines, depth, i), exported: false, parent: owner.name });
      }
      continue;
    }
    if (lang === 'ts' || lang === 'js') {
      if (top) {
        let hit = false;
        for (const [re, g, kind] of TS_RULES) {
          if ((m = re.exec(t))) {
            const end = blockEnd(lines, depth, i);
            add({ name: m[g], kind, i, end, exported: /^export\b/.test(t) });
            if (kind === 'class') containers.push({ name: m[g], depth: depth.before[i], end, exported: /^export\b/.test(t) });
            hit = true;
            break;
          }
        }
        if (!hit && (m = /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.*)$/.exec(t))) {
          const rest = m[3];
          const fn = /^(async\s+)?function\b/.test(rest) || (/^(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:[^=]+)?=>/.test(rest)) || (/^(async\s+)?\(/.test(rest) && /=>/.test(t));
          if (m[1] || fn || /^[A-Z][A-Z0-9_]+$/.test(m[2])) add({ name: m[2], kind: fn ? 'function' : 'const', i, end: blockEnd(lines, depth, i), exported: !!m[1] });
        }
      } else if (member && (m = TS_MEMBER.exec(t)) && !KEYWORDS.has(m[2]) && !t.endsWith(';')) {
        add({ name: m[2], kind: 'method', i, end: blockEnd(lines, depth, i), exported: cont.exported && !/^(private|#)/.test(t), parent: cont.name });
      }
    } else if (lang === 'go') {
      if (!top) continue;
      if ((m = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(t))) imports.push(m[1]);
      else if (/^import\s*\($/.test(t)) {
        for (let k = i + 1; k < lines.length && lines[k].trim() !== ')'; k++) { const q = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(lines[k]); if (q) imports.push(q[1]); }
      }
      else if ((m = /^package\s+(\w+)/.exec(t))) pkg = m[1];
      else if ((m = /^func\s+\(\s*\w*\s*\*?\s*([A-Za-z_]\w*)[^)]*\)\s*([A-Za-z_]\w*)/.exec(t))) add({ name: m[2], kind: 'method', i, end: blockEnd(lines, depth, i), exported: /^[A-Z]/.test(m[2]), parent: m[1] });
      else if ((m = /^func\s+([A-Za-z_]\w*)/.exec(t))) add({ name: m[1], kind: 'function', i, end: blockEnd(lines, depth, i), exported: /^[A-Z]/.test(m[1]) });
      else if ((m = /^type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/.exec(t))) add({ name: m[1], kind: m[2], i, end: blockEnd(lines, depth, i), exported: /^[A-Z]/.test(m[1]) });
      else if ((m = /^type\s+([A-Za-z_]\w*)\b/.exec(t))) add({ name: m[1], kind: 'type', i, end: blockEnd(lines, depth, i), exported: /^[A-Z]/.test(m[1]) });
    } else if (lang === 'rs') {
      const pub = /^pub(\([^)]*\))?\s/.test(t);
      if (top && (m = /^use\s+([^;]+);/.exec(t))) imports.push(m[1].trim());
      else if ((m = /^(?:pub(?:\([^)]*\))?\s+)?(?:default\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/.exec(t))) {
        const inImpl = member && cont.kind === 'impl';
        add({ name: m[1], kind: inImpl ? 'method' : 'function', i, end: blockEnd(lines, depth, i), exported: pub, parent: member ? cont.name : undefined });
      } else if (top && (m = /^(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|mod|union)\s+([A-Za-z_]\w*)/.exec(t))) {
        const end = blockEnd(lines, depth, i);
        add({ name: m[2], kind: m[1], i, end, exported: pub });
        if (m[1] === 'trait' || m[1] === 'mod') containers.push({ name: m[2], kind: m[1], depth: depth.before[i], end });
      } else if (top && (m = /^(?:unsafe\s+)?impl(?:<[^>]*>)?\s+([\w:]+)(?:<[^>]*>)?(?:\s+for\s+([\w:]+))?/.exec(t))) {
        containers.push({ name: (m[2] ?? m[1]).split('::').pop(), kind: 'impl', depth: depth.before[i], end: blockEnd(lines, depth, i) });
      }
    } else if (lang === 'kt' || lang === 'java' || lang === 'cs') {
      if (top && (m = /^package\s+([\w.]+)/.exec(t))) { pkg = m[1]; continue; }
      if (top && (m = /^namespace\s+([\w.]+)/.exec(t))) { pkg = m[1]; if (!t.endsWith(';')) containers.push({ name: m[1], kind: 'namespace', depth: depth.before[i], end: blockEnd(lines, depth, i), transparent: true }); continue; }
      if (top && (m = /^import\s+(?:static\s+)?([\w.*]+)/.exec(t))) { imports.push(m[1]); continue; }
      if (top && (m = /^using\s+(?:static\s+)?([\w.]+)\s*;/.exec(t))) { imports.push(m[1]); continue; }
      const parent = member && !cont.transparent ? cont.name : undefined;
      const pub = !/^(private|internal)\b/.test(t) && (lang !== 'java' && lang !== 'cs' ? true : /\bpublic\b/.test(t) || !parent);
      if ((m = KT_TYPE.exec(t)) || (m = /^(?:companion\s+)(object)\s+([A-Za-z_]\w*)/.exec(t)) || (lang !== 'kt' && (m = new RegExp(`^${KT_MODS}(enum)\\s+([A-Za-z_][\\w]*)`).exec(t)))) {
        const kind = /enum/.test(t.split(m[2])[0]) ? 'enum' : m[1];
        const end = blockEnd(lines, depth, i);
        add({ name: m[2], kind, i, end, exported: pub, parent });
        containers.push({ name: m[2], depth: depth.before[i], end });
      } else if (lang === 'kt' && (m = KT_FUN.exec(t))) {
        add({ name: m[1], kind: parent ? 'method' : 'function', i, end: blockEnd(lines, depth, i), exported: pub, parent });
      } else if (lang !== 'kt' && parent && (m = CS_METHOD.exec(t)) && !KEYWORDS.has(m[1]) && !/=\s*[^=>]/.test(t.split('(')[0])) {
        add({ name: m[1], kind: m[1] === cont.name ? 'constructor' : 'method', i, end: blockEnd(lines, depth, i), exported: pub, parent });
      }
    } else if (lang === 'sh') {
      if ((m = /^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)/.exec(t)) || (m = /^function\s+([A-Za-z_][\w-]*)/.exec(t))) add({ name: m[1], kind: 'function', i, end: blockEnd(lines, depth, i), exported: true });
    }
    // Containers found on this line (class, impl, ...) are pushed above; members are checked against containers.at(-1).
    if (containers.length && containers.at(-1).end < i) containers.pop();
  }
  // TS/JS: containers pushed inside the loop must be nested by line; keep symbols in source order.
  symbols.sort((a, b) => a.line - b.line);
  const out = { lang, lines: lines.length, symbols, imports };
  if (pkg) out.pkg = pkg;
  return out;
}

// ---------------------------------------------------------------- index

function listFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    // Build output and dependencies are skipped even when committed (they duplicate the source symbols).
    return out.split('\0').filter((p) => p && !p.split('/').slice(0, -1).some((seg) => GIT_SKIP.has(seg)));
  } catch {
    const files = [];
    const walk = (dir, rel) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && !['.github', '.gitea'].includes(e.name))) continue;
          walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile()) files.push(rel ? `${rel}/${e.name}` : e.name);
      }
    };
    walk(root, '');
    return files;
  }
}

export function cachePath(root, cacheDir) {
  const dir = cacheDir ?? process.env.REPOMAP_CACHE ?? join(homedir(), '.cache', 'repomap');
  return join(dir, `${createHash('sha1').update(resolve(root).toLowerCase()).digest('hex').slice(0, 16)}.json`);
}

/** Builds or incrementally refreshes the index of `root`. Only files whose mtime or size changed are parsed. */
export function buildIndex(root, opts = {}) {
  root = resolve(root);
  const file = cachePath(root, opts.cacheDir);
  let old = { files: {} };
  try { const c = JSON.parse(readFileSync(file, 'utf8')); if (c.version === VERSION && c.root === root) old = c; } catch { /* no cache */ }
  const all = listFiles(root).sort();
  const files = {};
  let parsed = 0;
  for (const p of all) {
    const lang = LANG[extname(p).toLowerCase()];
    if (!lang) continue;
    let st;
    try { st = statSync(join(root, p)); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const prev = old.files[p];
    if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) { files[p] = prev; continue; }
    const buf = readFileSync(join(root, p));
    if (buf.subarray(0, 8000).includes(0)) continue;
    files[p] = { mtime: st.mtimeMs, size: st.size, ...extract(p, buf.toString('utf8')) };
    parsed++;
  }
  const index = { version: VERSION, root, built: Date.now(), all, files };
  const changed = parsed > 0 || Object.keys(old.files).length !== Object.keys(files).length || (old.all ?? []).length !== all.length;
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(index));
    renameSync(tmp, file);
  }
  return { index, parsed, cacheFile: file };
}

// ---------------------------------------------------------------- queries

const qual = (s) => (s.parent ? `${s.parent}.${s.name}` : s.name);
const allSymbols = (index) => Object.entries(index.files).flatMap(([file, f]) => f.symbols.map((s) => ({ file, ...s })));

export function findSymbols(index, name, limit = 30) {
  const syms = allSymbols(index).filter((s) => index.files[s.file].lang !== 'md');
  const lc = name.toLowerCase();
  let hit = syms.filter((s) => s.name === name || qual(s) === name);
  if (!hit.length) hit = syms.filter((s) => s.name.toLowerCase() === lc || qual(s).toLowerCase() === lc);
  if (!hit.length) hit = syms.filter((s) => qual(s).toLowerCase().includes(lc));
  return hit.sort((a, b) => Number(b.exported) - Number(a.exported) || a.file.localeCompare(b.file) || a.line - b.line).slice(0, limit);
}

/** Resolves a user-supplied path (absolute, cwd-relative, repo-relative or a unique suffix) to an indexed file. */
export function resolveFile(index, p, cwd = process.cwd()) {
  const norm = (x) => x.split(sep).join('/');
  const cands = [];
  if (isAbsolute(p)) cands.push(norm(relative(index.root, p)));
  else { cands.push(norm(p).replace(/^\.\//, '')); cands.push(norm(relative(index.root, resolve(cwd, p)))); }
  for (const c of cands) if (index.files[c]) return c;
  const tail = '/' + norm(p).replace(/^\.?\//, '');
  const hits = Object.keys(index.files).filter((f) => f.endsWith(tail) || f === tail.slice(1));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`ambiguous file "${p}": ${hits.slice(0, 8).join(', ')}`);
  throw new Error(`not in the index: ${p}`);
}

export function outline(index, file) {
  return index.files[resolveFile(index, file)].symbols;
}

export function refs(index, root, name, limit = 50) {
  const re = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`);
  const defs = new Set(allSymbols(index).filter((s) => s.name === name).map((s) => `${s.file}:${s.line}`));
  const out = [];
  for (const [file, f] of Object.entries(index.files)) {
    if (f.lang === 'md') continue;
    let src;
    try { src = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (!src.includes(name)) continue;
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]) && !defs.has(`${file}:${i + 1}`)) {
        out.push({ file, line: i + 1, text: clip(lines[i].trim(), 160) });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
function resolveImport(index, from, spec, ctx) {
  const files = index.files;
  const f = files[from];
  const has = (p) => (files[p] ? p : undefined);
  if (f.lang === 'ts' || f.lang === 'js') {
    if (!spec.startsWith('.')) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    const stem = base.replace(/\.(m|c)?js$/, '').replace(/\.jsx$/, '');
    return has(base) ?? JS_EXTS.map((e) => has(stem + e)).find(Boolean) ?? JS_EXTS.map((e) => has(`${base}/index${e}`)).find(Boolean);
  }
  if (f.lang === 'py') {
    let mod = spec, dir = '';
    if (spec.startsWith('.')) {
      const dots = /^\.+/.exec(spec)[0].length;
      dir = posix.dirname(from);
      for (let k = 1; k < dots; k++) dir = posix.dirname(dir);
      mod = spec.slice(dots);
    }
    const rel = mod.split('.').filter(Boolean).join('/');
    const tries = dir ? [posix.join(dir, rel)] : [rel, `src/${rel}`];
    for (const t of tries) { const r = has(`${t}.py`) ?? has(`${t}/__init__.py`); if (r) return r; }
    return undefined;
  }
  if (f.lang === 'rs') {
    const parts = spec.replace(/[{].*$/, '').split('::').filter(Boolean);
    if (parts[0] !== 'crate' && parts[0] !== 'super' && parts[0] !== 'self') return undefined;
    const root = parts[0] === 'crate' ? 'src' : posix.dirname(from);
    for (let n = parts.length - 1; n >= 1; n--) {
      const p = posix.join(root, ...parts.slice(1, n + 1));
      const r = has(`${p}.rs`) ?? has(`${p}/mod.rs`);
      if (r) return r;
    }
    return undefined;
  }
  if (f.lang === 'kt' || f.lang === 'java') {
    const cls = spec.split('.').pop();
    const pkg = spec.split('.').slice(0, -1).join('.');
    return ctx.byPkg.get(`${pkg}:${cls}`);
  }
  if (f.lang === 'go') return ctx.goDirs.get(spec);
  return undefined;
}

function depsContext(index) {
  const byPkg = new Map();
  const goDirs = new Map();
  let goModule;
  try { goModule = /^module\s+(\S+)/m.exec(readFileSync(join(index.root, 'go.mod'), 'utf8'))?.[1]; } catch { /* not go */ }
  for (const [file, f] of Object.entries(index.files)) {
    if (f.pkg && (f.lang === 'kt' || f.lang === 'java')) for (const s of f.symbols) if (!s.parent) byPkg.set(`${f.pkg}:${s.name}`, file);
    if (f.lang === 'go' && goModule) { const d = posix.dirname(file); goDirs.set(d === '.' ? goModule : `${goModule}/${d}`, file); }
  }
  return { byPkg, goDirs };
}

export function deps(index, file) {
  const from = resolveFile(index, file);
  const ctx = depsContext(index);
  return [...new Set(index.files[from].imports.map((s) => resolveImport(index, from, s, ctx)).filter((x) => x && x !== from))].sort();
}

export function rdeps(index, file) {
  const target = resolveFile(index, file);
  const ctx = depsContext(index);
  const out = [];
  for (const [from, f] of Object.entries(index.files)) {
    if (from === target) continue;
    if (f.imports.some((s) => resolveImport(index, from, s, ctx) === target)) out.push(from);
  }
  return out.sort();
}

const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

export function search(index, query, limit = 10) {
  const q = [...new Set(words(query))];
  if (!q.length) return [];
  const entries = Object.entries(index.files);
  const N = entries.length;
  const df = new Map(q.map((w) => [w, 0]));
  const per = [];
  for (const [file, f] of entries) {
    const pathW = new Set(words(file));
    const symW = f.symbols.map((s) => ({ s, w: new Set(words(s.name)), d: new Set(words(s.doc ?? '')) }));
    let present = new Set();
    let score = 0;
    const hits = new Map();
    for (const w of q) {
      let ws = 0;
      if (pathW.has(w)) ws += 2;
      for (const { s, w: sw, d } of symW) {
        let h = 0;
        if (s.name.toLowerCase() === w) h = 4;
        else if (sw.has(w)) h = 3;
        if (d.has(w)) h += 2;
        if (h) { ws += h; hits.set(s, (hits.get(s) ?? 0) + h); }
      }
      if (ws) { present.add(w); score += Math.min(ws, 12) * 1; }
    }
    for (const w of present) df.set(w, df.get(w) + 1);
    if (score) per.push({ file, f, present, hits, raw: score });
  }
  for (const r of per) {
    let s = 0;
    for (const w of r.present) s += Math.log(1 + N / df.get(w));
    r.score = r.raw * s * (r.present.size / q.length) * (r.f.lang === 'md' ? 0.6 : 1);
  }
  return per.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => ({
    file: r.file,
    score: Math.round(r.score * 10) / 10,
    hits: [...r.hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => `${s.line}-${s.end} ${s.kind} ${qual(s)}`),
  }));
}

const KEY_FILE = /(^|\/)(package\.json|Dockerfile[^/]*|(docker-)?compose[^/]*\.ya?ml|Makefile|pyproject\.toml|setup\.py|go\.mod|Cargo\.toml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|AndroidManifest\.xml|pom\.xml|[^/]+\.csproj|tsconfig\.json|README\.md|CLAUDE\.md|AGENTS\.md)$|^\.(github|gitea)\/workflows\/[^/]+\.ya?ml$/;

export function overview(index, { budget = 6000 } = {}) {
  const files = Object.entries(index.files);
  const langs = {};
  for (const [, f] of files) langs[f.lang] = (langs[f.lang] ?? 0) + 1;
  const ctx = depsContext(index);
  const indeg = new Map();
  for (const [from, f] of files) for (const s of f.imports) { const t = resolveImport(index, from, s, ctx); if (t && t !== from) indeg.set(t, (indeg.get(t) ?? 0) + 1); }
  const head = [];
  head.push(`repo ${basename(index.root)}: ${index.all.length} files, ${files.length} indexed, ${files.reduce((n, [, f]) => n + f.symbols.length, 0)} symbols`);
  head.push('languages: ' + Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(', '));
  const keys = index.all.filter((p) => KEY_FILE.test(p));
  const keyText = keys.slice(0, 25).map((p) => {
    if (basename(p) !== 'package.json') return p;
    try {
      const j = JSON.parse(readFileSync(join(index.root, p), 'utf8'));
      const bits = [j.main && `main ${j.main}`, j.bin && `bin ${typeof j.bin === 'string' ? j.bin : Object.keys(j.bin).join('/')}`, j.scripts && `scripts ${Object.keys(j.scripts).slice(0, 8).join(' ')}`].filter(Boolean);
      return bits.length ? `${p} (${bits.join('; ')})` : p;
    } catch { return p; }
  });
  head.push('key files: ' + (keyText.join(', ') || '(none)') + (keys.length > 25 ? ` (+${keys.length - 25})` : ''));
  const dirs = new Map();
  for (const [p] of files) { const parts = p.split('/'); const d = parts.length > 2 ? parts.slice(0, 2).join('/') : parts.length === 2 ? parts[0] : '.'; dirs.set(d, (dirs.get(d) ?? 0) + 1); }
  head.push('dirs: ' + [...dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([d, n]) => `${d}/ ${n}`).join(', '));
  head.push('files (most imported / most exported first): path lines [in=importers] symbols');
  const ranked = files.map(([p, f]) => ({ p, f, rank: (indeg.get(p) ?? 0) * 3 + f.symbols.filter((s) => s.exported && !s.parent).length + (f.lang === 'md' ? -5 : 0) }))
    .sort((a, b) => b.rank - a.rank || a.p.localeCompare(b.p));
  let text = head.join('\n') + '\n';
  const footer = (k) => `(+${k} more files; use outline <file>, find <name>, search <words>)`;
  let shown = 0;
  for (const { p, f } of ranked) {
    const top = f.symbols.filter((s) => !s.parent).slice(0, 8).map((s) => s.name).join(', ');
    const line = `  ${p} ${f.lines}${indeg.get(p) ? ` [in=${indeg.get(p)}]` : ''}${top ? ' ' + clip(top, 100) : ''}\n`;
    if (text.length + line.length + footer(ranked.length).length + 1 > budget) break;
    text += line;
    shown++;
  }
  if (shown < ranked.length) text += footer(ranked.length - shown);
  return text.length > budget ? text.slice(0, budget) : text;
}

// ---------------------------------------------------------------- CLI

const fmtSym = (s, withFile = true) => `${withFile ? `${s.file}:` : ''}${s.line}-${s.end} ${s.kind} ${qual(s)}${s.exported ? '' : ' (local)'}${s.doc ? `  // ${s.doc}` : ''}`;

function main(argv) {
  const opts = { limit: undefined, budget: 6000, json: false, root: undefined };
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--budget') opts.budget = Number(argv[++i]);
    else if (a === '--root') opts.root = argv[++i];
    else args.push(a);
  }
  const [cmd, ...rest] = args;
  if (!cmd || cmd === 'help' || cmd === '--help') { process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n'); return; }
  let root = opts.root;
  if (!root) { try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { root = process.cwd(); } }
  const t0 = Date.now();
  const { index, parsed, cacheFile } = buildIndex(root);
  const print = (v, text) => process.stdout.write((opts.json ? JSON.stringify(v, null, 1) : text) + '\n');
  switch (cmd) {
    case 'build': case 'stats': {
      const n = Object.keys(index.files).length;
      print({ files: n, parsed, ms: Date.now() - t0, cacheFile }, `indexed ${n} files (${parsed} parsed, ${n - parsed} cached) in ${Date.now() - t0} ms; cache ${cacheFile}`);
      break;
    }
    case 'overview': print({ text: overview(index, opts) }, overview(index, opts)); break;
    case 'outline': {
      for (const f of rest) {
        const rel = resolveFile(index, f);
        const syms = index.files[rel].symbols;
        print({ file: rel, symbols: syms }, `${rel} (${index.files[rel].lines} lines)\n` + syms.map((s) => '  ' + (s.parent ? '  ' : '') + fmtSym(s, false)).join('\n'));
      }
      break;
    }
    case 'find': { const r = findSymbols(index, rest.join(' '), opts.limit ?? 30); print(r, r.map((s) => fmtSym(s) + `\n    ${s.sig ?? ''}`).join('\n') || 'no match'); break; }
    case 'refs': { const r = refs(index, index.root, rest[0], opts.limit ?? 50); print(r, r.map((x) => `${x.file}:${x.line}: ${x.text}`).join('\n') || 'no references'); break; }
    case 'deps': { const r = deps(index, rest[0]); print(r, r.join('\n') || 'no in-repo imports'); break; }
    case 'rdeps': { const r = rdeps(index, rest[0]); print(r, r.join('\n') || 'no in-repo importers'); break; }
    case 'search': { const r = search(index, rest.join(' '), opts.limit ?? 10); print(r, r.map((x) => `${x.file} (${x.score})\n` + x.hits.map((h) => `    ${h}`).join('\n')).join('\n') || 'no match'); break; }
    default: throw new Error(`unknown command: ${cmd} (try help)`);
  }
}

// Compare real paths: npm installs bin scripts as symlinks on Linux and macOS.
const isMain = () => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`repomap: ${e.message}\n`); process.exitCode = 1; }
}
