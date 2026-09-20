// ============================================================================
// panel.js —— 界面 DOM 的唯一出入口（依赖 state / layout）
// ----------------------------------------------------------------------------
// 职责：所有"读写页面元素"的代码都收在这里，其他模块不直接碰 DOM。
// 好处：将来换界面（改版 / 换框架）只需要动这一个文件。
//
// 约定：本模块只负责"显示成什么样"，不含任何业务判断。
// ============================================================================

import { state } from './state.js';
import { zoneLabel, breadcrumbFor } from './layout.js';

// --- 元素引用（集中查一次，避免散落各处 querySelector） ---
const el = {
  host: () => document.getElementById('canvas-host'),
  search: () => document.getElementById('search'),
  results: () => document.getElementById('results'),
  count: () => document.getElementById('result-count'),
  breadcrumb: () => document.getElementById('breadcrumb'),
  breadcrumbText: () => document.getElementById('breadcrumb-text'),
  nohit: () => document.getElementById('nohit'),
  nohitTitle: () => document.getElementById('nohit-title'),
  nohitTip: () => document.getElementById('nohit-tip'),
  selinfo: () => document.getElementById('selinfo'),
  selinfoBody: () => document.getElementById('selinfo-body'),
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
// 结果列表
// ---------------------------------------------------------------------------
/**
 * 渲染结果列表。
 * @param {object[]} hits 命中记录；空数组时显示提示语
 * @param {(item:object)=>void} [onPick] 点击某一项的回调
 */
export function renderResults(hits, onPick) {
  const box = el.results();
  if (!box) return;
  box.innerHTML = '';

  if (!hits.length) {
    const d = document.createElement('div');
    d.className = 'hint';
    d.textContent = state.nohit
      ? '未找到匹配项，请检查编号或名称。'
      : '输入物资编号 / 名称 / 区域 / 货架排号 / 箱位开始定位。';
    box.appendChild(d);
    return;
  }

  for (const it of hits) {
    const node = document.createElement('div');
    node.className = 'result-item';
    node.dataset.id = it.materialId;
    node.innerHTML =
      `<div class="rid">${it.materialId}</div>` +
      `<div class="rname">${it.materialName}</div>` +
      `<div class="rmeta">${it.campus} · ${zoneLabel(it.zone)} · 第${it.row}排 · 第${it.level}层 · 箱${it.boxId}</div>` +
      `<span class="rtag">${it.dataStatus}</span><span class="rzone">${zoneLabel(it.zone)}</span>`;
    if (onPick) node.addEventListener('click', () => onPick(it));
    box.appendChild(node);
  }
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
/** 显示某条物资的详情 */
export function showSelInfo(item) {
  const box = el.selinfo();
  const body = el.selinfoBody();
  if (!box || !body) return;
  box.classList.remove('hidden');
  body.innerHTML =
    `<div class="row"><span>物资编号</span><span>${item.materialId}</span></div>` +
    `<div class="row"><span>物资名称</span><span>${item.materialName}</span></div>` +
    `<div class="row"><span>校区</span><span>${item.campus}</span></div>` +
    `<div class="row"><span>区域</span><span>${zoneLabel(item.zone)}</span></div>` +
    `<div class="row"><span>排 / 层</span><span>第${item.row}排 / 第${item.level}层</span></div>` +
    `<div class="row"><span>箱子编号</span><span>${item.boxId}</span></div>` +
    `<div class="row"><span>数据状态</span><span>${item.dataStatus}</span></div>` +
    `<div class="path">路径：${breadcrumbFor(item)}</div>`;
}

/** 隐藏详情卡 */
export function hideSelInfo() {
  el.selinfo()?.classList.add('hidden');
}
