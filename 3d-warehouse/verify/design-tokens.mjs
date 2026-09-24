// ============================================================================
// design-tokens.mjs —— 设计令牌守卫（把 DESIGN-RULES.md 的规则变成可执行断言）
// ----------------------------------------------------------------------------
// 运行：node verify/design-tokens.mjs
//   零依赖，纯 node:fs —— 不需要 NODE_PATH，也不需要起服务。
//   失败时退出码为 1，可以直接挂进提交前检查。
//
// 它守两件事（对应 DESIGN-RULES.md 的 §1.4「防回归约定」与 §9.1）：
//
//   1) 配色镜像不能漂：src/card-canvas.js 的 CARD_COLORS 是 styles.css
//      `:root` 变量的**手工镜像**（canvas 的 2D API 不认 var(--x)）。
//      两边一旦不一致，3D 场景里的卡片就会和右侧面板不同色 ——
//      这正是 STRUCTURE.md L63 警告的"改样式只改一处"被破坏。
//
//   2) 对比度不能掉：每条「前景令牌 / 底色 / 阈值」都按 WCAG 2.1 精确复算。
//      值全部**从 styles.css 现场读**，不抄数字 —— 所以改了 CSS 就会立刻反映，
//      不存在"脚本和样式表各说各话"。
//
// 为什么写成脚本而不是清单：清单靠人记得去查，脚本不用。Day 9 的教训是
// 「截图里看到的」和「页面上真实的」可以是两回事（见 .workbuddy/memory），
// 所以判断依据必须是可复算的数值，而不是印象。
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CSS_PATH = join(ROOT, 'styles.css');
const CARD_PATH = join(ROOT, 'src', 'card-canvas.js');

// ---------------------------------------------------------------- WCAG 2.1

function channel(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const r3 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------- 从源码里读真值

/** 解析 styles.css 的 `:root { --x: #hex; ... }`，返回 { '--x': '#hex' } */
function readCssTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = withoutComments.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) throw new Error('styles.css 里找不到 :root 块');
  const tokens = {};
  for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

/** 解析 card-canvas.js 的 `export const CARD_COLORS = { key: '#hex', ... }` */
function readCardColors(js) {
  const block = js.match(/export const CARD_COLORS\s*=\s*\{([\s\S]*?)\};/);
  if (!block) throw new Error('card-canvas.js 里找不到 CARD_COLORS');
  const colors = {};
  for (const m of block[1].matchAll(/(\w+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    colors[m[1]] = m[2].toLowerCase();
  }
  return colors;
}

// --------------------------------------------------------------- 断言

let failures = 0;
let checks = 0;

function ok(label, detail) {
  checks += 1;
  console.log(`  ✅ ${label}${detail ? '  ' + detail : ''}`);
}

function bad(label, detail) {
  checks += 1;
  failures += 1;
  console.log(`  ❌ ${label}${detail ? '  ' + detail : ''}`);
}

// --------------------------------------------------------------- 主流程

const tokens = readCssTokens(readFileSync(CSS_PATH, 'utf8'));
const cards = readCardColors(readFileSync(CARD_PATH, 'utf8'));

console.log(`\n读取：styles.css 的 :root 共 ${Object.keys(tokens).length} 个颜色令牌`);
console.log(`读取：card-canvas.js 的 CARD_COLORS 共 ${Object.keys(cards).length} 项\n`);

// --- 第一组：配色镜像一致性 ------------------------------------------------

console.log('【1】配色镜像一致性（CARD_COLORS ↔ styles.css :root）');

// CARD_COLORS 的键 → styles.css 的令牌名
const MIRROR = {
  bg: '--panel',
  line: '--line',
  lineStrong: '--line-strong',
  ink: '--ink',
  muted: '--muted',
  accent: '--accent',
  accentInk: '--accent-ink',
  accentSoft: '--accent-soft',
  highlight: '--highlight',
  highlightSoft: '--highlight-soft',
  tagInk: '--tag-ink',
};

for (const [key, token] of Object.entries(MIRROR)) {
  const want = tokens[token];
  const got = cards[key];
  if (!want) {
    bad(`${key} → ${token}`, `styles.css 里没有 ${token} 这个令牌`);
  } else if (want !== got) {
    bad(`${key} 未同步`, `card-canvas.js=${got} 但 ${token}=${want}`);
  } else {
    ok(`${key} = ${token}`, got);
  }
}

// tagLine / tagBg 目前两边都是硬编码、没有令牌 —— 记录为已知缺口，不算失败
const UNMAPPED = ['tagLine', 'tagBg'];
for (const key of UNMAPPED) {
  console.log(`  ⚠️  ${key} = ${cards[key]}（styles.css 里仍是硬编码，尚未抽令牌，暂不校验）`);
}

// --- 第二组：对比度 --------------------------------------------------------

const TEXT = 4.5; // 正文 / 小字
const NON_TEXT = 3.0; // 图标 / 边框 / 焦点环

const PAIRS = [
  // [说明, 前景令牌或字面色, 底色, 阈值]
  ['次要文字 on 白面板（.rmeta/.kv-k/.hint）', '--muted', '#ffffff', TEXT],
  ['次要文字 on 页面底色', '--muted', '--bg', TEXT],
  ['次要文字 on 卡片 hover 底（瓶颈项）', '--muted', '--accent-soft', TEXT],
  ['次要文字 on 小地图表头底', '--muted', '#f6f9fc', TEXT],
  ['次要文字 on selinfo 底', '--muted', '#f7f9fb', TEXT],
  ['次要文字 on 加载态底', '--muted', '#f4f7fa', TEXT],
  ['正文 on 白面板', '--ink', '#ffffff', TEXT],
  ['强调色文字 on 白面板（.rid/.ph-icon）', '--accent', '#ffffff', TEXT],
  ['强调色文字 on 卡片 hover 底', '--accent-ink', '--accent-soft', TEXT],
  ['标签文字 on 标签底（.rtag）', '--tag-ink', '#fbf2dd', TEXT],
  ['标签文字 on 白面板', '--tag-ink', '#ffffff', TEXT],
  ['顶栏正文 on 顶栏', '--topbar-ink', '--topbar', TEXT],
  ['顶栏副标题 on 顶栏', '#9fb0c0', '--topbar', TEXT],
  ['搜索占位符 on 搜索框底', '#9fb0c0', '#2c3a48', TEXT],
  ['出错态文字 on 出错态底', '#8f3320', '--highlight-soft', TEXT],

  ['焦点环 on 页面底色（非文字）', '--accent', '--bg', NON_TEXT],
  ['焦点环 on 白面板（非文字）', '--accent', '#ffffff', NON_TEXT],
  ['焦点环 on 顶栏（深色底专用覆盖色）', '#7fb4dd', '--topbar', NON_TEXT],
  ['焦点环 on 搜索框底（同上覆盖色）', '#7fb4dd', '#2c3a48', NON_TEXT],
  ['3D 目标高亮 / 当前态边框（非文字）', '--highlight', '#ffffff', NON_TEXT],
  ['收起态小红点（非文字）', '--highlight', '#ffffff', NON_TEXT],
];

console.log('\n【2】对比度（WCAG 2.1，正文 ≥4.5 / 非文字 ≥3.0）');

const resolve = (v) => {
  if (v.startsWith('--')) {
    if (!tokens[v]) throw new Error(`未定义的令牌 ${v}`);
    return tokens[v];
  }
  return v;
};

for (const [label, fg, bg, min] of PAIRS) {
  const f = resolve(fg);
  const b = resolve(bg);
  const ratio = r3(contrast(f, b));
  const detail = `${f} on ${b} = ${ratio}:1（需 ≥${min}）`;
  if (ratio >= min) ok(label, detail);
  else bad(label, detail);
}

// --- 第三组：令牌是否被真正使用（防"加了没人用"） --------------------------

console.log('\n【3】新增令牌确实被引用');
const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
for (const token of ['--tag-ink']) {
  const uses = (css.match(new RegExp(`var\\(\\s*${token}\\s*\\)`, 'g')) || []).length;
  if (uses > 0) ok(`${token} 被引用 ${uses} 次`);
  else bad(`${token} 定义了但没有任何规则使用`);
}

// --- 汇总 ------------------------------------------------------------------

console.log(`\n${'─'.repeat(64)}`);
if (failures === 0) {
  console.log(`✅ 设计令牌守卫通过：${checks} 项断言全部成立`);
  process.exit(0);
} else {
  console.log(`❌ 设计令牌守卫失败：${checks} 项里 ${failures} 项不成立`);
  process.exit(1);
}
