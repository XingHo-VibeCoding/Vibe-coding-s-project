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
import { outline } from './scene.js';
import {
  renderResults, setResultCount, setNoHit, hideNoHit, hideBreadcrumb, getInputValue,
} from './panel.js';
import { locate, resetView } from './emphasis.js';
import { enterMap } from './mapview.js';

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
  if (hits.length === 1) {
    locate(hits[0]);
    return hits;
  }

  // 命中多条 → 全部打上标记并切到全屏地图，一眼看清分布在哪些区域。
  // 为什么这么做：手机上列表一次只显示得下一两条，
  // 而"同一个东西在两三个区都有"恰恰是最需要看空间分布的场合。
  markAllHits(hits);
  enterMap();
  return hits;
}

/**
 * 给多条命中记录同时打标记（不聚焦某一个，保留全局视野）。
 * 这里是"轻量高亮"：命中箱位调亮 + 描边，其余压暗，但不动镜头。
 */
function markAllHits(hits) {
  state.highlightBoxId = null;
  state.nohit = false;
  const ids = new Set(hits.map((h) => h.boxId));

  for (const mesh of state.slotMeshes) {
    const m = mesh.material;
    const isHit = mesh.userData.occupied && ids.has(mesh.userData.boxId);
    if (isHit) {
      m.color.setHex(mesh.userData.baseColor);
      m.opacity = 1;
      m.transparent = false;
    } else if (mesh.userData.occupied) {
      m.color.setHex(mesh.userData.baseColor);
      m.opacity = 0.18;
      m.transparent = true;
    } else {
      m.opacity = 0.1;
      m.transparent = true;
    }
  }

  // 轮廓高亮所有命中的箱位
  outline.selectedObjects = hits
    .map((h) => state.meshes.get(h.boxId))
    .filter(Boolean);
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

  // 数据没加载成功时，搜索一定是"搜不到东西"——因为 `state.items` 是空的。
  // 如果不在这里拦一下，用户会看到「未找到"杯子"对应的物资」，
  // 于是去怀疑自己输错了关键词，反复改词重搜，而真正的问题是数据没读出来。
  // 这里直接说清原因，并把面板保持在错误态（错误信息比"没搜到"更接近真相）。
  if (state.loadError) {
    setNoHit('暂时搜不了', '物资数据没能加载成功，搜索不可用。请刷新页面重试。');
    renderResults([], locate);
    return [];
  }

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
