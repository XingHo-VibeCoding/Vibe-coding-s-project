// ============================================================================
// card-canvas.js —— 把「物资卡片」画到 canvas 上（依赖 result-card）
// ----------------------------------------------------------------------------
// 用途：让**同一张卡片**既能以 DOM 形式出现在右侧面板，也能贴到 3D 场景里
//       （作为悬浮标签 / 详情气泡）。这是把 result-card 抽成独立组件之后
//       才可能做到的事 —— 之前渲染逻辑写死在 panel.js 里，想放到 3D 上
//       只能把 HTML 字符串再抄一遍。
//
// 为什么 3D 里不能直接用 DOM 卡片：three.js 的 Sprite 需要一张纹理（canvas 或图片），
// 不接受 DOM 节点。所以同一个「卡片」概念在这里有两种落地形式：
//   DOM 版  → result-card.createItemCard()   给面板用
//   Canvas 版 → 本文件 drawCardToCanvas()     给 3D 标签用
// 两者共享同一份「字段顺序 + 配色 + 文案规则」，避免两边各写一套后慢慢走样。
//
// 这里刻意不引入 three.js —— 只负责"把卡片画成一张图"，
// 由 scene.js 决定怎么把它变成 Sprite。职责单一，也方便单独测试。
// ============================================================================

import { zoneLabel } from './layout.js';

/**
 * 卡片配色（与 styles.css 的 :root 变量保持一致）。
 * 为什么不直接读 CSS 变量：canvas 的绘制 API 不认 `var(--x)`，
 * 只能拿到具体色值。这里做一份镜像，改动时两边要一起改 ——
 * 所以集中放在一个对象里，改的时候不容易漏。
 */
export const CARD_COLORS = {
  bg: '#ffffff',
  line: '#d8dee7',
  lineStrong: '#c2ccd8',
  ink: '#1f2933',
  muted: '#6b7785',
  accent: '#2f6f9f',
  accentInk: '#235a82',
  accentSoft: '#e6eef5',
  highlight: '#e8543b',
  highlightSoft: '#fdeae6',
  tagInk: '#b06a00',
  tagLine: '#e6c98a',
  tagBg: '#fbf2dd',
};

/** 按 DPR 缩放后的逻辑尺寸（画布像素 = 逻辑尺寸 × scale） */
const CARD_W = 260;
const CARD_H = 96;

/**
 * 把一条物资记录画成卡片，返回 canvas 元素。
 *
 * @param {object} item 物资记录
 * @param {object} [opts]
 * @param {number} [opts.scale=2] 超采样倍数。3D 里卡片是贴图，会被放大，
 *                                用 2 倍分辨率画出来才不糊（类似 @2x 图）。
 * @param {boolean} [opts.active] 是否高亮（对应 DOM 版的 .active 样式）
 * @returns {HTMLCanvasElement}
 */
export function drawCardToCanvas(item, opts = {}) {
  const { scale = 2, active = false } = opts;
  const c = document.createElement('canvas');
  c.width = CARD_W * scale;
  c.height = CARD_H * scale;

  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);          // 之后都按逻辑坐标画，自动获得超采样
  const C = CARD_COLORS;

  // ---- 底板 + 圆角边框 ----
  roundRect(ctx, 0.5, 0.5, CARD_W - 1, CARD_H - 1, 8);
  ctx.fillStyle = active ? C.highlightSoft : C.bg;
  ctx.fill();
  ctx.lineWidth = active ? 2 : 1;
  ctx.strokeStyle = active ? C.highlight : C.line;
  ctx.stroke();

  const padX = 11;
  let y = 22;

  // ---- 编号（等宽感、强调色）----
  ctx.fillStyle = C.accentInk;
  ctx.font = 'bold 13px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.materialId, padX, y);

  // ---- 区域徽标（右上角，和 DOM 版的 .rzone 对应）----
  const zoneText = zoneLabel(item.zone);
  ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
  const zw = ctx.measureText(zoneText).width + 12;
  const zx = CARD_W - padX - zw;
  roundRect(ctx, zx, y - 9, zw, 18, 4);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(zoneText, zx + zw / 2, y);

  // ---- 物资名称（最大字号，视觉主体）----
  y += 26;
  ctx.fillStyle = C.ink;
  ctx.font = 'bold 15px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(clip(ctx, item.materialName, CARD_W - padX * 2), padX, y);

  // ---- 位置行（次要信息，灰色）----
  y += 21;
  ctx.fillStyle = C.muted;
  ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
  const meta = `${item.campus} · ${zoneText} · 第${item.row}排 · 第${item.level}层`;
  ctx.fillText(clip(ctx, meta, CARD_W - padX * 2), padX, y);

  // ---- 箱位（单独一行，用等宽字体强调"这是精确坐标"）----
  y += 20;
  ctx.fillStyle = C.accentInk;
  ctx.font = 'bold 13px ui-monospace, Consolas, monospace';
  ctx.fillText(`箱 ${item.boxId}`, padX, y);

  // ---- 数据状态徽标（非正常状态才画，正常的不加噪）----
  if (item.dataStatus && item.dataStatus !== '正常') {
    const tw = ctx.measureText(item.dataStatus).width + 12;
    const tx = CARD_W - padX - tw;
    roundRect(ctx, tx, y - 9, tw, 18, 4);
    ctx.fillStyle = C.tagBg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.tagLine;
    ctx.stroke();
    ctx.fillStyle = C.tagInk;
    ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.dataStatus, tx + tw / 2, y);
  }

  return c;
}

/** 卡片在 3D 世界里的宽高比（供 Sprite 算缩放用） */
export const CARD_ASPECT = CARD_W / CARD_H;

/** 卡片逻辑尺寸（世界单位换算时参考） */
export const CARD_SIZE = { w: CARD_W, h: CARD_H };

/**
 * 文本超宽就截断加省略号。
 * 为什么要做：3D 里的卡片是固定尺寸贴图，文字超出画布会被硬切掉半截字，
 * 看起来像渲染坏了。主动截断 + 省略号更清楚。
 */
function clip(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

/** canvas 2D 的圆角矩形路径（部分浏览器无 roundRect，自己画一个） */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
