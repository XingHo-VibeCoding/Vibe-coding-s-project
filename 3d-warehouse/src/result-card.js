// ============================================================================
// result-card.js —— 可复用「物资卡片」组件（依赖 state / layout）
// ----------------------------------------------------------------------------
// 职责只有一个：**把一条物资记录变成一个 DOM 节点**。不碰数据、不碰镜头、不碰搜索。
//
// 为什么要单独成文件（而不是留在 panel.js 里）：
//   同一个"物资"在页面上有两处需要被展示成卡片 ——
//     1) 右侧「定位结果」列表（动态条数）
//     2) （预留）3D 场景里的悬浮标签 / AR 式信息卡
//   之前渲染逻辑写死在 panel.js 的 renderResults() 里，和"面板"这个容器绑死，
//   换个位置展示就只能复制一遍 HTML 字符串 —— 复制出来的那份迟早和原版不一致。
//   抽出来之后，两边都只调这一个函数，改样式只改一处。
//
// 分三层，各自只做一件事，方便单独替换：
//   createItemCard(item, opts)  → 一条记录 → 一个 <div>
//   createHintCard(text, opts)  → 一段提示语 → 一个占位块（空态 / 加载态 / 错误态共用）
//   createSkeletonCard()        → 一个骨架块（加载中的占位形状）
//
// 三种"非正常状态"统一走 createHintCard，靠 kind 决定配色和角色：
//   kind='empty'   中性灰   —— 还没搜 / 没命中
//   kind='loading' 中性灰 + 呼吸动画 —— 数据在路上
//   kind='error'   暖红     —— 出错了，需要人注意
// ============================================================================

import { state } from './state.js';
import { zoneLabel } from './layout.js';

/**
 * 一条物资记录 → 卡片节点。
 *
 * @param {object} item 物资记录（materialId / materialName / campus / zone / row / level / boxId / dataStatus）
 * @param {object} [opts]
 * @param {(item:object)=>void} [opts.onPick] 点击回调。不传则卡片不可点（只读展示用）
 * @param {boolean} [opts.compact] 紧凑模式：只留编号 + 名称，用于空间窄的地方
 * @returns {HTMLDivElement}
 */
export function createItemCard(item, opts = {}) {
  const { onPick, compact = false } = opts;
  const node = document.createElement('div');
  node.className = compact ? 'result-item is-card compact' : 'result-item is-card';
  node.dataset.id = item.materialId;

  // 用 createElement + textContent 而不是拼 innerHTML：
  // 物资名称来自数据源（将来可能是后端 / 文档），直接拼 HTML 字符串等于把
  // 数据里的 < > & 当成标签解析，名称里出现"<"就会破版，甚至有注入风险。
  const rid = document.createElement('div');
  rid.className = 'rid';
  rid.textContent = item.materialId;

  const rname = document.createElement('div');
  rname.className = 'rname';
  rname.textContent = item.materialName;

  node.append(rid, rname);

  if (!compact) {
    const rmeta = document.createElement('div');
    rmeta.className = 'rmeta';
    rmeta.textContent =
      `${item.campus} · ${zoneLabel(item.zone)} · 第${item.row}排 · ` +
      `第${item.level}层 · 箱${item.boxId}`;
    node.appendChild(rmeta);

    // 数据状态徽标：只有非正常状态才显示，正常的不加噪
    if (item.dataStatus && item.dataStatus !== '正常') {
      const tag = document.createElement('span');
      tag.className = 'rtag';
      tag.textContent = item.dataStatus;
      node.appendChild(tag);
    }

    const rzone = document.createElement('span');
    rzone.className = 'rzone';
    rzone.textContent = zoneLabel(item.zone);
    node.appendChild(rzone);
  }

  // 可点性：用 role + tabIndex 让它同时能被键盘 Tab 到、回车触发，
  // 不只是鼠标/手指能点（无障碍的基本要求，成本只有两行）。
  if (onPick) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.addEventListener('click', () => onPick(item));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick(item);
      }
    });
  }

  return node;
}

/**
 * 提示块（空态 / 加载态 / 错误态三态共用）。
 *
 * @param {string} text 提示正文
 * @param {object} [opts]
 * @param {'empty'|'loading'|'error'} [opts.kind='empty'] 决定配色与无障碍角色
 * @param {string} [opts.title] 可选的加粗首行（错误态常用）
 * @returns {HTMLDivElement}
 */
export function createHintCard(text, opts = {}) {
  const { kind = 'empty', title } = opts;
  const box = document.createElement('div');
  box.className = `hint hint-${kind}`;
  // 加载中用 status（读屏会播报"正在…"但不打断）；
  // 出错用 alert（读屏会立刻打断播报）。语义选对，读屏用户才知道轻重。
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  if (kind === 'loading') box.setAttribute('aria-live', 'polite');

  if (kind === 'loading') {
    const spin = document.createElement('span');
    spin.className = 'hint-spinner';
    spin.setAttribute('aria-hidden', 'true');   // 纯装饰，读屏跳过
    box.appendChild(spin);
  }

  if (title) {
    const t = document.createElement('strong');
    t.className = 'hint-title';
    t.textContent = title;
    box.appendChild(t);
  }

  const body = document.createElement('span');
  body.className = 'hint-text';
  body.textContent = text;
  box.appendChild(body);

  return box;
}

/**
 * 骨架块：加载中占位，形状接近真实卡片，让"即将出现什么"有预期。
 * 纯装饰，对读屏隐藏（真正的语义由 createHintCard 的 role=status 承担）。
 * @returns {HTMLDivElement}
 */
export function createSkeletonCard() {
  const node = document.createElement('div');
  node.className = 'result-item skeleton';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML =
    '<div class="sk-bar sk-w40"></div>' +
    '<div class="sk-bar sk-w70"></div>' +
    '<div class="sk-bar sk-w90 sk-dim"></div>';
  return node;
}

/**
 * 生成「当前箱位」详情卡的键值行。
 *
 * 抽出来的理由和上面一样：详情卡将来可能被 3D 悬浮标签复用，
 * 现在它和 panel.js 的展开/收起逻辑缠在一起，换个位置就没法用。
 *
 * @param {Array<[string, string]>} rows [标签, 值] 的有序对
 * @returns {DocumentFragment}
 */
export function createDetailRows(rows) {
  const frag = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'kv';

    const k = document.createElement('span');
    k.className = 'kv-k';
    k.textContent = label;

    const v = document.createElement('span');
    v.className = 'kv-v';
    v.textContent = value == null || value === '' ? '—' : String(value);

    row.append(k, v);
    frag.appendChild(row);
  }
  return frag;
}

/** 当前是否处于"还没拿到数据"的状态（给调用方判断用） */
export function isLoading() {
  return state.loading === true;
}
