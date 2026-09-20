// ============================================================================
// controls.js —— 视角输入（鼠标 + 触摸）（依赖 state / scene / camera / config）
// ----------------------------------------------------------------------------
// 职责：把"手指/鼠标的动作"翻译成相机操作，只做这一件事。
//
// 交互约定：
//   鼠标左键拖拽  → 旋转       鼠标右键拖拽 / 滚轮 → 平移 / 缩放
//   触摸单指拖拽  → 旋转       触摸单指长按后拖拽 → 平移
//   触摸双指捏合  → 缩放       触摸双指移动     → 平移
//
// 为什么有"长按平移"：手机没有右键，单指原本只能旋转，
// 长按 350ms 后切换到平移，补上这个缺口。
// ============================================================================

import { LONG_PRESS_MS } from './config.js';
import { state } from './state.js';
import { renderer } from './scene.js';
import { zoomBy, rotateBy, panBy } from './camera.js';

/**
 * 绑定视角控制。
 * @param {HTMLElement} [dom] 交互容器，默认用 3D 画布
 */
export function initControls(dom = renderer.domElement) {
  /** 当前按下的所有触点：pointerId -> {x, y} */
  const pointers = new Map();

  let mode = null;            // 'rotate' | 'pan' | null
  let lastX = 0;
  let lastY = 0;
  let pinchDist = 0;          // 双指间距（用于算缩放比例）
  let pressTimer = null;      // 长按计时器
  let longPressPan = false;   // 是否已进入"长按平移"状态

  const twoDist = () => {
    const p = [...pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    longPressPan = false;
  };

  function onDown(e) {
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // 右键 或 俯视模式 → 平移；否则旋转
      mode = (e.button === 2 || state.topView) ? 'pan' : 'rotate';
      lastX = e.clientX;
      lastY = e.clientY;

      // 触摸屏单指：按住不动 350ms → 切到平移模式
      if (e.pointerType === 'touch' && !state.topView) {
        longPressPan = false;
        pressTimer = setTimeout(() => { longPressPan = true; }, LONG_PRESS_MS);
      }
    } else if (pointers.size === 2) {
      cancelPress();
      mode = 'pan';
      pinchDist = twoDist();
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 双指：捏合缩放 + 中点位移平移
    if (pointers.size === 2) {
      const d = twoDist();
      if (d > 0) zoomBy(pinchDist / d);
      pinchDist = d;

      const p = [...pointers.values()];
      panBy((p[0].x + p[1].x) / 2 - lastX, (p[0].y + p[1].y) / 2 - lastY);
      lastX = (p[0].x + p[1].x) / 2;
      lastY = (p[0].y + p[1].y) / 2;
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    // 已进入长按平移 → 直接平移
    if (longPressPan) { panBy(dx, dy); return; }

    if (mode === 'rotate' && !state.topView) {
      // 手指/鼠标已经明显移动 → 判定为旋转意图，取消长按计时
      if (pressTimer && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) cancelPress();
      rotateBy(-dx * 0.005, -dy * 0.005);
    } else {
      panBy(dx, dy);
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      mode = null;
      cancelPress();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    zoomBy(1 + e.deltaY * 0.0012);
  }

  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  return { pointers };
}
