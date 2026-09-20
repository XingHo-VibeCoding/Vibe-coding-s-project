// ============================================================================
// panel.js —— 界面 DOM 的唯一出入口（依赖 state / layout / result-card）
// ----------------------------------------------------------------------------
// 职责：所有"读写页面元素"的代码都收在这里，其他模块不直接碰 DOM。
// 好处：将来换界面（改版 / 换框架）只需要动这一个文件。
//
// 约定：本模块只负责"显示成什么样"，不含任何业务判断。
//
// 和 result-card.js 的分工：卡片**长什么样**归 result-card（可复用的那部分），
// 面板**在什么状态下摆哪些卡片**归这里（列表 / 空 / 加载 / 错误四态）。
// ============================================================================

import { state } from './state.js';
import { zoneLabel, breadcrumbFor } from './layout.js';
import { createItemCard, createHintCard, createSkeletonCard, createDetailRows } from './result-card.js';

// --- 元素引用（集中查一次，避免散落各处 querySelector） ---
const el = {
  host: () => document.getElementById('canvas-host'),
  search: () => document.getElementById('search'),
  results: () => document.getElementById('results'),
  count: () => document.getElementById('result-count'),
  breadcrumb: () => document.getElementById('breadcrumb'),
  breadcrumbText: () => document.getElementById('breadcrumb-text'),
  bcAction: () => document.querySelector('#breadcrumb .bc-action'),
  nohit: () => document.getElementById('nohit'),
  nohitTitle: () => document.getElementById('nohit-title'),
  nohitTip: () => document.getElementById('nohit-tip'),
  selinfo: () => document.getElementById('selinfo'),
  selinfoBody: () => document.getElementById('selinfo-body'),
  selHead: () => document.getElementById('selinfo-head'),
  selToggle: () => document.getElementById('selinfo-toggle'),
  btnMap: () => document.getElementById('btn-map'),
  btnMapLabel: () => document.querySelector('#btn-map span'),
  btnMapIcon: () => document.querySelector('#btn-map .c-icon'),
  mapBar: () => document.getElementById('map-bar'),
};

// ---------------------------------------------------------------------------
// 输入框
// ---------------------------------------------------------------------------
/** 读取搜索框当前内容 */
export function getInputValue() {
  return el.search()?.value ?? '';
}

/** 清空搜索框 */
export function clearInput() {
  const s = el.search();
  if (s) s.value = '';
}

// ---------------------------------------------------------------------------
// 结果列表（四态：加载中 / 出错 / 空 / 有结果）
// ---------------------------------------------------------------------------
/**
 * 渲染结果列表。
 *
 * 四态的判定顺序**不能调换**，这是这段代码里唯一需要想清楚的地方：
 *   1) 加载中  —— 数据都还没到，谈不上"命中几条"，必须先判
 *   2) 出错    —— 数据到了但坏了，比"没命中"更需要人注意，优先级高于空
 *   3) nohit   —— 搜索执行了、确实没有匹配项
 *   4) 默认提示 —— 还没搜过
 * 如果先判 `!hits.length` 就会把 1、2 两种情况都错误地显示成"输入…开始定位"，
 * 用户看到的是"一切正常，只是我没输入"，而实际是数据根本没加载出来。
 *
 * @param {object[]} hits 命中记录；空数组时进入 3/4 态
 * @param {(item:object)=>void} [onPick] 点击某一项的回调
 */
export function renderResults(hits, onPick) {
  const box = el.results();
  if (!box) return;
  box.innerHTML = '';

  // ---- 1. 加载中：骨架 + 一句说明 ----
  if (state.loading) {
    box.appendChild(createHintCard('正在读取物资数据…', { kind: 'loading' }));
    // 两块骨架，形状接近真实卡片，让"即将出现什么"有预期
    box.append(createSkeletonCard(), createSkeletonCard());
    return;
  }

  // ---- 2. 出错：说清"出了什么事"和"还能做什么" ----
  if (state.loadError) {
    box.appendChild(createHintCard(state.loadError, {
      kind: 'error',
      title: '物资数据没能读出来',
    }));
    return;
  }

  // ---- 3 & 4. 空态：分"搜过没命中"和"还没搜"两种文案 ----
  if (!hits.length) {
    box.appendChild(createHintCard(
      state.nohit
        ? '换个关键词试试：物资编号、名称、区域(A B C)、排号(A1)或箱位(A-01-02)。'
        : '输入物资编号 / 名称 / 区域 / 货架排号 / 箱位开始定位。',
    ));
    return;
  }

  // ---- 有结果 ----
  const frag = document.createDocumentFragment();
  for (const it of hits) frag.appendChild(createItemCard(it, { onPick }));
  box.appendChild(frag);
}

/**
 * 只切换"加载中"这一个状态并重画列表。
 *
 * 为什么单独开一个函数而不是让调用方自己改 `state.loading` 再调 renderResults：
 * 改状态和重画必须成对出现，漏掉任何一半都会出现"数据已在加载、界面还写着
 * 输入提示"的错位。包成一个动作，调用方就没有机会只做一半。
 *
 * @param {boolean} on
 */
export function setLoading(on) {
  state.loading = !!on;
  renderResults([], null);
}

/**
 * 设置加载错误并重画。
 * @param {string} msg 面向用户的错误说明（不要塞原始堆栈）
 */
export function setLoadError(msg) {
  state.loadError = msg || '数据读取失败。';
  state.loading = false;
  renderResults([], null);
}

/**
 * 清掉错误标记。
 *
 * 必须单独开一个函数，因为 `setLoadError(null)` 走不通 ——
 * 它的第一行 `msg || '数据读取失败。'` 会把 null 当成空值填上默认文案，
 * 于是"清错误"变成了"换成另一条错误"。这个坑在测试里实测到过：
 * 调用 `setLoadError(null)` 之后 `panelState` 仍然停在 'error'。
 */
export function clearLoadError() {
  state.loadError = null;
  renderResults([], null);
}

/** 当前是否处于出错状态（供搜索流程判断要不要让位） */
export function hasLoadError() {
  return !!state.loadError;
}

/** 更新右上角"命中 N 条"计数 */
export function setResultCount(n) {
  const c = el.count();
  if (c) c.textContent = String(n);
}

/** 高亮结果列表中指定的一条 */
export function markActiveResult(id) {
  clearActiveResult();
  const node = document.querySelector(`.result-item[data-id="${CSS.escape(id)}"]`);
  if (node) node.classList.add('active');
}

/** 取消结果列表的全部高亮 */
export function clearActiveResult() {
  document.querySelectorAll('.result-item.active').forEach((e) => e.classList.remove('active'));
}

// ---------------------------------------------------------------------------
// 面包屑（路径提示条）
// ---------------------------------------------------------------------------
/** 显示面包屑并写入文字 */
export function setBreadcrumb(text) {
  const bc = el.breadcrumb();
  const txt = el.breadcrumbText();
  if (txt) txt.textContent = text;
  if (bc) bc.classList.remove('hidden');
}

/** 隐藏面包屑 */
export function hideBreadcrumb() {
  el.breadcrumb()?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// 空结果提示
// ---------------------------------------------------------------------------
/** 显示"没找到"提示 */
export function setNoHit(title, tip) {
  const box = el.nohit();
  if (!box) return;
  const t = el.nohitTitle();
  const p = el.nohitTip();
  if (t) t.textContent = title;
  if (p) p.textContent = tip;
  box.classList.remove('hidden');
}

/** 隐藏"没找到"提示 */
export function hideNoHit() {
  el.nohit()?.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// 选中详情卡
// ---------------------------------------------------------------------------
/**
 * 显示某条物资的详情。
 * 注意：默认是**收起**状态 —— 手机上完整详情卡会吃掉 300px 左右，
 * 把 3D 舞台挤得只剩一半。收起后只占一行标题，想看细节再点开。
 */
export function showSelInfo(item) {
  const box = el.selinfo();
  const body = el.selinfoBody();
  if (!box || !body) return;

  // 复用 result-card 的键值行构造器，而不是在这里再拼一遍 HTML。
  // 除了少写一遍，还顺手修掉了拼字符串的隐患：物资名称/编号来自数据源，
  // 用 innerHTML 拼接等于把数据里的 < > & 当标签解析（名称里带"<"就破版）。
  // createDetailRows 内部用 textContent 逐格赋值，没有这个问题。
  body.innerHTML = '';
  body.appendChild(createDetailRows([
    ['物资编号', item.materialId],
    ['物资名称', item.materialName],
    ['校区', item.campus],
    ['区域', zoneLabel(item.zone)],
    ['排 / 层', `第${item.row}排 / 第${item.level}层`],
    ['箱子编号', item.boxId],
    ['数据状态', item.dataStatus],
    ['路径', breadcrumbFor(item)],
  ]));

  setSelInfoExpanded(false);
  box.classList.remove('hidden');
}

/** 展开 / 收起详情卡主体 */
export function setSelInfoExpanded(expanded) {
  const box = el.selinfo();
  const body = el.selinfoBody();
  const toggle = el.selToggle();
  if (body) body.classList.toggle('collapsed', !expanded);
  if (box) box.classList.toggle('collapsed', !expanded);
  if (toggle) toggle.textContent = expanded ? '收起' : '展开';
}

/** 当前详情卡是否展开 */
export function isSelInfoExpanded() {
  return !el.selinfo()?.classList.contains('collapsed');
}

/** 切换详情卡展开状态 */
export function toggleSelInfo() {
  setSelInfoExpanded(!isSelInfoExpanded());
  return isSelInfoExpanded();
}

/** 隐藏详情卡，并复位成收起状态 */
export function hideSelInfo() {
  el.selinfo()?.classList.add('hidden');
  setSelInfoExpanded(false);
}

// ---------------------------------------------------------------------------
// 地图模式界面
// ---------------------------------------------------------------------------
/**
 * 同步地图模式的界面文字。
 * @param {boolean} on 是否处于全屏地图
 */
export function setMapUi(on) {
  const label = el.btnMapLabel();
  const icon = el.btnMapIcon();
  if (label) label.textContent = on ? '3D 视角' : '地图';
  if (icon) icon.setAttribute('data-lucide', on ? 'box' : 'map');

  const btn = el.btnMap();
  if (btn) btn.title = on ? '返回 3D 视角 (M)' : '切换全屏地图 (M)';

  const bc = el.bcAction();
  if (bc) bc.textContent = on ? '返回 3D 视角' : '全屏地图';

  el.mapBar()?.classList.toggle('hidden', !on);

  // 图标是 data-lucide 换名，需要重新渲染
  if (window.lucide) window.lucide.createIcons();
}
