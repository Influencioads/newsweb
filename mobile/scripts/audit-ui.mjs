#!/usr/bin/env node
/**
 * audit-ui.mjs — house-style gate for mobile/src. Node ESM, no deps.
 *
 *   node scripts/audit-ui.mjs              per-rule counts + locations
 *   node scripts/audit-ui.mjs --strict     exit 1 on any non-INFO hit
 *   node scripts/audit-ui.mjs --self-test  run the inline fixture
 *
 * A trailing `// audit-allow-hex` comment exempts one line from `hex`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = 'src/lib/theme.ts';
const PRESSABLE = 'src/ui/PressableScale.tsx';
const TEXT = 'src/ui/Text.tsx';
const MOTION = 'src/lib/motion.ts';
const STRICT = process.argv.includes('--strict');

const RULES = {
  hex: `hex/rgb/rgba literal outside ${THEME} — use useColors()/makeStyles + alpha()`,
  white: '`.white` palette alias — use surface',
  pressable: `raw Pressable/Touchable* import outside ${PRESSABLE} — use <PressableScale>`,
  glyph: 'emoji / Unicode glyph literal — use <Icon>',
  'te-lineheight': 'Telugu style with lineHeight < 1.65x fontSize (Anek 1.5x) or no lineHeight',
  'te-uppercase': 'textTransform uppercase on a Telugu face',
  'te-body-floor': 'font.telugu below the 17 body floor',
  'static-color': `static \`color\` import from ${THEME} in a rendering file — use useColors()/makeStyles`,
  motion: `ad-hoc withSpring/withTiming config outside ${MOTION} — use m.spring / m.timing / SPRING.*`,
};
const INFO = new Set(['te-body-floor']);

const HEX_RX = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/g;
const GLYPH_RX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2302}\u{2315}\u{2039}\u{203A}]/gu;
const IMPORT_RX = /import\s*\{([^}]*)\}\s*from\s*['"](?:react-native|react-native-gesture-handler)['"]/g;
const THEME_IMPORT_RX = /import\s*\{([^}]*)\}\s*from\s*['"]@\/lib\/theme['"]/g;
const MOTION_RX = /\bwith(?:Spring|Timing)\(\s*[^,()]+,\s*\{/g;
const NOTO_MIN = 1.65;
const ANEK_MIN = 1.5;

/** The `type` scale from theme.ts so `type.body.fontSize` / `...type.meta` resolve. */
const TYPE = {};
for (const m of readFileSync(join(ROOT, THEME), 'utf8').matchAll(
  /^\s*(\w+):\s*\{\s*fontSize:\s*([\d.]+),\s*lineHeight:\s*([\d.]+)/gm,
)) {
  TYPE[m[1]] = { fontSize: +m[2], lineHeight: +m[3] };
}
/** <T> hands every non-headline variant to Noto for Telugu; Text.tsx must floor them at NOTO_MIN. */
const TEXT_FLOORS = /Math\.max\(lineHeight, Math\.ceil\(fontSize \* (?:TELUGU_LINE_RATIO|1\.65)\)\)/.test(readFileSync(join(ROOT, TEXT), 'utf8'));

/** Scale variants T gives Noto (not display, headline*, eyebrow) must reach NOTO_MIN unless Text.tsx floors them. */
function checkScale(type, floored, hit) {
  if (floored) return;
  for (const [k, v] of Object.entries(type))
    if (!/^(display|headline|eyebrow)/.test(k) && v.lineHeight / v.fontSize < NOTO_MIN - 1e-9)
      hit('te-lineheight', THEME, 0, `type.${k} ${v.lineHeight}/${v.fontSize} = ${(v.lineHeight / v.fontSize).toFixed(2)} < ${NOTO_MIN} and ${TEXT} does not floor it`);
}

const rel = (f) => relative(ROOT, f).split('\\').join('/');
const lineOf = (code, pos) => code.slice(0, pos).split('\n').length;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Blank comments in place (line numbers survive) so doc prose never trips a rule. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1'); // ponytail: `//` after ':' is a URL, anything else a comment
}

/** Every `{…}` in `code` paired with its own-property text (nested objects cut out). */
function objectLiterals(code) {
  const out = [];
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
    } else if (c === '{') stack.push({ start: i, kids: [] });
    else if (c === '}' && stack.length) {
      const o = stack.pop();
      let own = '';
      let p = o.start + 1;
      for (const k of o.kids) {
        own += code.slice(p, k.start);
        p = k.end + 1;
      }
      o.end = i;
      out.push({ start: o.start, own: own + code.slice(p, i) });
      if (stack.length) stack[stack.length - 1].kids.push(o);
    }
  }
  return out; // ponytail: regex literals with quotes/braces are not tokenised; style code has none
}

/** Numeric style key → number | undefined (expression we cannot resolve) | null (absent). */
function num(own, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*([^,\\n}]+)`).exec(own);
  if (m) {
    const v = m[1].trim();
    if (/^\d+(\.\d+)?$/.test(v)) return +v;
    const t = /^type\.(\w+)\.(fontSize|lineHeight)$/.exec(v);
    return t && TYPE[t[1]] ? TYPE[t[1]][t[2]] : undefined;
  }
  if (new RegExp(`\\b${key}\\b`).test(own)) return undefined; // shorthand `{ fontSize }`
  const spreads = [...own.matchAll(/\.\.\.\s*([\w.]+)/g)].map((s) => /^type\.(\w+)$/.exec(s[1]));
  if (!spreads.length) return null;
  if (spreads.some((s) => !s || !TYPE[s[1]])) return undefined;
  return TYPE[spreads[spreads.length - 1][1]][key];
}

function scan(file, src, hit) {
  const name = rel(file);
  const code = stripComments(src);
  const raw = src.split('\n');
  code.split('\n').forEach((line, i) => {
    const n = i + 1;
    if (name !== THEME && !raw[i].includes('audit-allow-hex'))
      for (const m of line.match(HEX_RX) ?? []) hit('hex', name, n, m);
    for (const m of line.match(/[\w.]*\.white\b/g) ?? []) hit('white', name, n, m);
    for (const g of line.match(GLYPH_RX) ?? [])
      hit('glyph', name, n, `${g} U+${g.codePointAt(0).toString(16).toUpperCase()}`);
  });
  if (name !== PRESSABLE)
    for (const m of code.matchAll(IMPORT_RX)) {
      const bad = m[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
        .filter((s) => /^(Pressable|Touchable\w+)$/.test(s));
      if (bad.length) hit('pressable', name, lineOf(code, m.index), bad.join(', '));
    }
  if (!name.startsWith('src/lib/'))
    for (const m of code.matchAll(THEME_IMPORT_RX))
      if (m[1].split(',').some((s) => s.trim() === 'color')) hit('static-color', name, lineOf(code, m.index), 'color');
  if (name !== MOTION) for (const m of code.matchAll(MOTION_RX)) hit('motion', name, lineOf(code, m.index), m[0].trim());
  for (const { start, own } of objectLiterals(code)) {
    const fam = /\bfontFamily\s*:\s*([^,\n}]+)/.exec(own)?.[1]?.trim();
    if (!fam) continue;
    const face = /font\.telugu|NotoSansTelugu/.test(fam) ? 'noto' : /font\.headline|AnekTelugu/.test(fam) ? 'anek' : null;
    if (!face) continue;
    const n = lineOf(code, start);
    const fs = num(own, 'fontSize');
    const lh = num(own, 'lineHeight');
    const min = face === 'noto' ? NOTO_MIN : ANEK_MIN;
    if (typeof fs === 'number' && typeof lh === 'number' && lh / fs < min - 1e-9)
      hit('te-lineheight', name, n, `${lh}/${fs} = ${(lh / fs).toFixed(2)} < ${min} (${fam})`);
    else if (typeof fs === 'number' && lh === null) hit('te-lineheight', name, n, `no lineHeight for fontSize ${fs} (${fam})`);
    if (typeof fs === 'number' && fs < 17 && /font\.telugu\b|NotoSansTelugu_400/.test(fam))
      hit('te-body-floor', name, n, `fontSize ${fs}`);
    if (/textTransform\s*:\s*['"]uppercase['"]/.test(own)) hit('te-uppercase', name, n, fam);
  }
}

function selfTest() {
  const fixture = `
import { Pressable, View } from 'react-native';
import { color, font } from '@/lib/theme';
const a = '#fff'; // audit-allow-hex
x.value = withSpring(1, { damping: 3 });
y.value = withTiming(0, DUR.fast) + withSpring(0, SPRING.sheet);
const b = '#abc'; /* #def inside a comment is fine */
const c = palette.white;
const d = <Text>\u2192 ok</Text>;
const s = makeStyles((color) => ({
  bad: { fontFamily: font.telugu, fontSize: 14, lineHeight: 21 },
  ok: { fontFamily: font.teluguBold, ...type.body },
  anek: { fontFamily: font.headline, fontSize: 20, lineHeight: 30, textTransform: 'uppercase' },
  none: { fontFamily: font.telugu, fontSize: 18 },
  unknown: { fontFamily: font.telugu, ...readerType(type.body, 1) },
  latin: { fontFamily: font.latin, fontSize: 11, lineHeight: 13, textTransform: 'uppercase' },
}));
`;
  const got = {};
  const count = (rule) => (got[rule] = (got[rule] ?? 0) + 1);
  scan(join(ROOT, 'src/x.tsx'), fixture, count);
  checkScale({ ui: { fontSize: 14, lineHeight: 22 }, headlineMd: { fontSize: 19, lineHeight: 29 } }, false, count);
  checkScale({ ui: { fontSize: 14, lineHeight: 22 } }, true, count);
  const want = {
    hex: 1,
    white: 1,
    pressable: 1,
    glyph: 1,
    'te-lineheight': 3,
    'te-uppercase': 1,
    'te-body-floor': 1,
    'static-color': 1,
    motion: 1,
  };
  const diff = Object.keys(RULES).filter((k) => (got[k] ?? 0) !== (want[k] ?? 0));
  console.log(diff.length ? `self-test FAILED: ${JSON.stringify({ got, want })}` : 'self-test ok');
  process.exit(diff.length ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

const hits = Object.fromEntries(Object.keys(RULES).map((k) => [k, []]));
const files = walk(join(ROOT, 'src'));
const record = (rule, file, line, msg) => hits[rule].push(`${file}:${line}  ${msg}`);
for (const f of files) scan(f, readFileSync(f, 'utf8'), record);
checkScale(TYPE, TEXT_FLOORS, record);

let bad = 0;
for (const [rule, list] of Object.entries(hits)) {
  const info = INFO.has(rule);
  if (!info) bad += list.length;
  console.log(`${info ? 'INFO' : list.length ? 'FAIL' : ' ok '}  ${rule.padEnd(14)}${String(list.length).padStart(4)}  ${RULES[rule]}`);
  for (const l of list) console.log(`          ${l}`);
}
console.log(`\n${files.length} files scanned, ${bad} violation(s)${STRICT && bad ? ' — failing (--strict)' : ''}`);
if (STRICT && bad) process.exit(1);
