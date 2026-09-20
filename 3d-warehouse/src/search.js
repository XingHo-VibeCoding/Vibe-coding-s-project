// ============================================================================
// search.js —— 搜索与匹配规则（依赖 state / panel / emphasis）
// ----------------------------------------------------------------------------
// 职责：把用户输入的一句话，翻译成"命中哪些物资记录"。
// 匹配优先级（从精确到模糊）：
//   1. 物资编号精确（大小写不敏感）
//   2. 箱位编号精确（如 A-01-02）
//   3. 区域（A / A区 / a）
//   4. 区域 + 排号（A1 / A-01 / a 01 排）
//   5. 名称 / 编号 / 箱位 包含模糊匹配
// ============================================================================

import { state } from './state.js';
import {
  renderResults, setResultCount, setNoHit, hideNoHit, hideBreadcrumb, getInputValue,
} from './panel.js';
import { locate, resetView } from './emphasis.js';

/**
 * 收尾：把命中结果写进列表，并根据数量决定要不要自动定位。
 * @param {object[]} hits 命中的物资记录
 * @returns {object[]} 原样返回 hits（方便调用方链式处理）
 */
export function finishSearch(hits) {
  setResultCount(hits.length);

  if (hits.length === 0) {
    state.nohit = true;
    const q = getInputValue().trim();
    setNoHit(
      `未找到「${q}」对应的物资`,
      '可试试：物资编号 FZ-SP-00001、区域 A/B/C、货架排号 A-01、箱位 A-01-02，或名称含“餐盘 / 电池”。'
    );
    hideBreadcrumb();
    renderResults([], locate);
    return [];
  }

  renderResults(hits, locate);
  // 只命中一条 → 直接飞过去，省掉一次点击
  if (hits.length === 1) locate(hits[0]);
  return hits;
}

/**
 * 主搜索入口。
 * @param {string} termRaw 原始输入
 * @returns {object[]} 命中结果
 */
export function search(termRaw) {
  const q = (termRaw || '').trim();
  if (!q) { resetView(); return []; }
  const ql = q.toLowerCase();

  hideNoHit();

  // 1. 物资编号精确匹配
  if (state.byId.has(q)) return finishSearch([state.byId.get(q)]);
  if (state.byId.has(q.toUpperCase())) return finishSearch([state.byId.get(q.toUpperCase())]);

  // 2. 箱位编号精确匹配
  const boxExact = state.items.filter((it) => it.boxId.toLowerCase() === ql);
  if (boxExact.length) return finishSearch(boxExact);

  // 3. 只输入区域，如 "A" / "A区" / "a 区"
  const zoneOnly = ql.match(/^([abc])\s*区?$/);
  if (zoneOnly) {
    return finishSearch(state.items.filter((it) => it.zone.toLowerCase() === zoneOnly[1]));
  }

  // 4. 区域 + 排号，如 "A1" / "A-01" / "a 01 排"
  const zr = ql.match(/^([abc])[-\s]?0?(\d)\s*(排)?$/);
  if (zr) {
    return finishSearch(state.items.filter(
      (it) => it.zone.toLowerCase() === zr[1] && it.row === +zr[2]
    ));
  }

  // 5. 名称 / 编号 / 箱位 的模糊包含匹配
  const hits = state.items.filter(
    (it) => it.materialName.toLowerCase().includes(ql)
      || it.materialId.toLowerCase().includes(ql)
      || it.boxId.toLowerCase().includes(ql)
  );
  return finishSearch(hits);
}
