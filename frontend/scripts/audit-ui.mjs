#!/usr/bin/env node
/**
 * audit-ui.mjs — token-contract linter for src/**\/*.{ts,tsx}.
 *
 *   node scripts/audit-ui.mjs [--strict] [--no-legacy] [--quiet]
 *
 *   --strict     exit 1 when any non-INFO rule has violations
 *   --no-legacy  (with --strict) promote bg-white from INFO to ERROR
 *   --quiet      summary table only
 *
 * A line ending in `// audit-allow-hex` is exempt from the hex rule.
 * Skipped: src/i18n/strings.ts, *.d.ts, *.test.* / *.spec.*, src/test/**.
 */
/* global process, console, URL */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const NO_LEGACY = args.has('--no-legacy');
const QUIET = args.has('--quiet');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

const SKIP = [/[/\\]i18n[/\\]strings\.ts$/, /\.d\.ts$/, /\.(test|spec)\.tsx?$/, /[/\\]src[/\\]test[/\\]/];
const INTERACTIVE = /onClick=|<button\b|<a[\s>]|role="button"/;
const TELUGU_CLASS = /(?<![\w-])t[eh](?![\w-])/;
const CLAMP = /(?<![\w-])(?:line-clamp-\d+|truncate)(?![\w-])/;

/** Each rule: id, severity, and check(line, rawLine) → array of match strings. */
const RULES = [
  { id: 'text-px', severity: 'ERROR', desc: 'text-[Npx] — use the named type scale',
    check: all(/\btext-\[\d+(?:\.\d+)?px\]/g) },
  { id: 'hex', severity: 'ERROR', desc: 'hex colour literal — use a token',
    check: (line, raw) => /\/\/\s*audit-allow-hex\s*$/.test(raw) ? [] : all(/(?<![\w&])#[0-9a-fA-F]{3,8}(?![\w-])/g)(line) },
  { id: 'small-tap', severity: 'ERROR', desc: 'interactive element with h/w/min-h/min-w below 44px',
    check: (line) => INTERACTIVE.test(line)
      ? all(/\b(?:min-)?[hw]-\[(\d+(?:\.\d+)?)px\]/g)(line).filter((m) => Number(m.match(/[\d.]+/)[0]) < 44)
      : [] },
  { id: 'rounded', severity: 'ERROR', desc: 'bare "rounded" or rounded-[Npx] — use rounded-xl / -2xl / -pill',
    check: all(/(?<![\w-])rounded(?:-[a-z]{1,2})?-\[[^\]]*px\]|(?<![\w-.:])rounded(?![\w-])/g) },
  { id: 'te-clamp', severity: 'ERROR', desc: 'line-clamp/truncate on Telugu text — use te-clamp-N',
    // ponytail: per-line check; a cn() className split across lines slips through.
    check: (line) => /className/.test(line) && TELUGU_CLASS.test(line) ? all(CLAMP)(line) : [] },
  { id: 'dark-bg-surface', severity: 'ERROR', desc: 'dark:bg-surface — surface is already theme-aware',
    check: all(/dark:bg-surface\b/g) },
  { id: 'window-dialog', severity: 'ERROR', desc: 'window.prompt/confirm/alert — use Dialog/ConfirmDialog/PromptDialog',
    check: all(/\bwindow\.(?:prompt|confirm|alert)\s*\(/g) },
  { id: 'bg-white', severity: STRICT && NO_LEGACY ? 'ERROR' : 'INFO', desc: 'bg-white — use bg-surface',
    check: all(/(?<![\w-])bg-white(?![\w-])/g) },
];

function all(re) {
  return (line) => {
    const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
    return [...line.matchAll(g)].map((m) => m[0]);
  };
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !SKIP.some((re) => re.test(p))) yield p;
  }
}

/** Blank out block + line comments, keeping line count intact. */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock.split('\n').map((l) => l.replace(/(?<!:)\/\/.*$/, ''));
}

const violations = Object.fromEntries(RULES.map((r) => [r.id, []]));
let files = 0;
for (const file of walk(SRC)) {
  files++;
  const raw = readFileSync(file, 'utf8').split('\n');
  const lines = stripComments(raw.join('\n'));
  const rel = relative(ROOT, file).split(sep).join('/');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      const hits = rule.check(line, raw[i] ?? '');
      if (hits.length) violations[rule.id].push({ loc: `${rel}:${i + 1}`, hits, snippet: line.trim().slice(0, 110) });
    }
  });
}

/* ---------------------------------------------------------------------------
 * Token-scale check (tailwind.config.ts, not src/).
 *
 * A responsive variant such as `md:text-display` is emitted after the `.th`
 * rule in the same layer, so it wins on source order and a token that ships a
 * line-height below the Telugu floor silently breaks §4.1 wherever it is used
 * with a responsive prefix. The scale itself therefore has to satisfy the
 * floor: 1.5 for the Anek headline tokens, 1.65 for the Noto body tokens.
 * (ui / ui-sm / meta / eyebrow are Latin tokens; `.te` supplies 1.7 there.)
 * ------------------------------------------------------------------------- */
const SCALE_FLOOR = [
  [/^(display|headline-)/, 1.5],
  [/^te-(body|lead)/, 1.65],
];
const scaleIssues = [];
try {
  const cfg = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8');
  // Slice the fontSize map only. `lineHeight:` also appears inside every
  // token tuple, so the end marker has to be the named lineHeight SCALE.
  const from = cfg.indexOf('fontSize:');
  const to = cfg.indexOf('lineHeight: {', from);
  const block = cfg.slice(from, to > from ? to : undefined);
  for (const m of block.matchAll(/'?([a-z-]+)'?:\s*\['(\d+(?:\.\d+)?)px',\s*\{\s*lineHeight:\s*'([\d.]+)'/g)) {
    const [, name, size, lh] = m;
    const floor = SCALE_FLOOR.find(([re]) => re.test(name));
    if (floor && Number(lh) < floor[1] - 1e-9) {
      scaleIssues.push(`tailwind.config.ts  text-${name}: ${size}px / ${lh} (floor ${floor[1]})`);
    }
  }
} catch {
  scaleIssues.push('tailwind.config.ts could not be read for the token-scale check');
}

let failing = 0;
for (const rule of RULES) {
  const list = violations[rule.id];
  const n = list.reduce((a, v) => a + v.hits.length, 0);
  if (n && rule.severity !== 'INFO') failing += n;
  if (!QUIET && n) {
    console.log(`\n[${rule.severity}] ${rule.id} — ${rule.desc}`);
    for (const v of list) console.log(`  ${v.loc}  ${v.snippet}`);
  }
}

console.log(`\naudit-ui: ${files} files scanned${STRICT ? ' (strict)' : ''}`);
console.log('rule'.padEnd(18) + 'severity'.padEnd(10) + 'count');
for (const rule of RULES) {
  const n = violations[rule.id].reduce((a, v) => a + v.hits.length, 0);
  console.log(rule.id.padEnd(18) + rule.severity.padEnd(10) + n);
}
if (scaleIssues.length) {
  console.log('');
  console.log('[ERROR] te-scale - type token below the Telugu line-height floor');
  for (const issue of scaleIssues) console.log('  ' + issue);
}
console.log('te-scale'.padEnd(18) + 'ERROR'.padEnd(10) + scaleIssues.length);
failing += scaleIssues.length;

console.log(`\n${failing} blocking violation(s)`);
if (STRICT && failing) process.exit(1);
