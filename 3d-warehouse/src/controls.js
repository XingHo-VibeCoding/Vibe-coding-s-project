// ============================================================================
// controls.js —— 视角输入（鼠标 + 触摸）（依赖 state / scene / camera / config）
// ----------------------------------------------------------------------------
// 职责：把"手指/鼠标的动作"翻译成相机操作，只做这一件事。
//
// 触摸手势约定：
//   单指拖拽  → 旋转（横竖都能转；横向无限，纵向转到底会自然减速）
//   双指拖拽  → 平移（手机上最自然的平移方式，和地图类应用一致）
//   双指捏合  → 缩放
//   快速轻扫  → 惯性继续转（flick），大角度不用反复划
//
// 为什么手机上没有"单指平移"：一个指头只能有一种默认语义，选了旋转
// （找货最常做的是绕着货架看）。平移交给双指——比"长按 350ms 再拖"
// 可靠得多，长按很容易被系统手势或手指微抖打断。
// 鼠标右键在手机上无对应操作，桌面端保留右键平移。
// ============================================================================

import { ROTATE_SENSITIVITY, FLICK_MS, FLICK_MIN_PX } from './config.js';
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
  let sens = ROTATE_SENSITIVITY.mouse; // 当前指针的旋转灵敏度（按下时确定）

  // ---- 惯性轻扫（flick）用 ----
  // 记录最近的位移轨迹，抬手时据此判断"这一下扫得多快"。
  // 为什么要做：没有惯性时，想转 180° 得把手指在屏幕上倒腾两三回，
  // 这正是真机反馈"大角度要划好多下"的来源之一。
  let trail = [];             // [{ t, x }] 最近若干次单指水平位置
  let inertia = null;         // { vx, vy, raf } 正在跑的惯性动画

  const twoDist = () => {
    const p = [...pointers.values()];
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };

  /** 停掉正在跑的惯性（用户再次按下、或切到地图模式时必须停） */
  function stopInertia() {
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
  }

  stopInertiaFn = stopInertia;   // 让模块级的 haltInertia() 能用到

  /**
   * 抬手后按最后一次的滑动速度继续转一会儿，速度按 friction 逐帧衰减。
   * 用 rAF + 时间差计算，保证不同刷新率（60/90/120Hz）下衰减速度一致。
   */
  function startInertia(vx, vy) {
    if (!vx && !vy) return;
    if (state.topView) return;          // 俯视地图下不转，没必要跑惯性
    const friction = 0.94;              // 每帧保留的比例
    let prev = performance.now();
    inertia = {
      raf: 0,
      vx, vy,
    };
    const step = (now) => {
      if (!inertia) return;
      const dt = Math.min(48, now - prev) / 16.67;  // 折算成"多少帧"（封顶防跳变）
      prev = now;
      inertia.vx *= Math.pow(friction, dt);
      inertia.vy *= Math.pow(friction, dt);
      // 速度太慢就收工，避免无意义地一直占着 rAF
      if (Math.abs(inertia.vx) < 0.0008 && Math.abs(inertia.vy) < 0.0008) {
        inertia = null;
        return;
      }
      rotateBy(-inertia.vx * dt * sens, -inertia.vy * dt * sens);
      inertia.raf = requestAnimationFrame(step);
    };
    inertia.raf = requestAnimationFrame(step);
  }

  function onDown(e) {
    stopInertia();   // 手指一落下就接管，惯性立刻让位

    // 兜底自愈：正常情况下 pointerup/cancel 会把触点清掉，
    // 但如果那一次事件丢了（手指滑出屏幕、被系统手势打断、切后台），
    // pointers 里会残留"幽灵触点"，导致 pointers.size 一直是 2，
    // 之后所有单指操作都被当成双指 —— 整个页面就再也转不动了。
    // 判断依据：primary 触点代表"新一轮操作的开始"，
    //          此时若还残留别的触点，说明上一轮没干净结束，直接清空。
    // （双指操作时第二根手指 isPrimary=false，不会误清空）
    if (e.isPrimary && pointers.size > 0) pointers.clear();

    // 捕获指针，保证手指移出画布后仍能收到 move。
    // 必须 try/catch：某些环境（合成事件、已释放的 pointerId）会抛 NotFoundError，
    // 一旦抛出就会中断整个 onDown，导致 mode 没被设置、后面完全转不动。
    try {
      dom.setPointerCapture?.(e.pointerId);
    } catch (_) { /* 捕获失败不影响主流程 */ }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // 俯视地图 / 鼠标右键 → 平移；其余（3D 下的单指、左键）→ 旋转
      mode = (e.button === 2 || state.topView) ? 'pan' : 'rotate';
      lastX = e.clientX;
      lastY = e.clientY;

      // 触摸屏旋转更跟手（见 config.ROTATE_SENSITIVITY 的说明）
      sens = e.pointerType === 'touch' ? ROTATE_SENSITIVITY.touch : ROTATE_SENSITIVITY.mouse;

      trail = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    } else if (pointers.size === 2) {
      mode = 'pan';
      pinchDist = twoDist();
      trail = [];       // 双指不做惯性旋转
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

    if (mode === 'rotate' && !state.topView) {
      rotateBy(-dx * sens, -dy * sens);
      // 只留最近 FLICK_MS 内的轨迹，用来判断抬手速度
      const now = performance.now();
      trail.push({ t: now, x: e.clientX, y: e.clientY });
      while (trail.length > 2 && now - trail[0].t > FLICK_MS) trail.shift();
    } else {
      panBy(dx, dy);
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;

    // 抬手瞬间：若刚才在旋转且扫得够快，就带一段惯性。
    // 注意要在 mode 被清空之前判断。
    if (pointers.size === 0) {
      if (mode === 'rotate' && !state.topView && trail.length >= 2) {
        const first = trail[0];
        const last = trail[trail.length - 1];
        const dt = last.t - first.t;
        const moved = Math.hypot(last.x - first.x, last.y - first.y);
        // 位移够大、时间够短，才算"轻扫"而不是"慢慢挪"
        if (dt > 0 && moved >= FLICK_MIN_PX && dt <= FLICK_MS) {
          // px/ms → px/帧（16.67ms）
          startInertia(((last.x - first.x) / dt) * 16.67, ((last.y - first.y) / dt) * 16.67);
        }
      }
      mode = null;
      trail = [];
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

  return { pointers, stopInertia };
}

/**
 * 当前"停掉惯性"的实现（由 initControls 注册）。
 *
 * 为什么要有这个模块级出口：`initControls()` 的返回值只有 `main.js` 拿得到，
 * 但 `api.js`（对外测试接口）需要在任意时刻把惯性掐掉。
 * 惯性是个自己会一直跑的 rAF 循环 —— 测试若不显式停掉它，
 * 读到的 theta 就是个还在变化的随机值，断言会时好时坏，极难排查。
 */
let stopInertiaFn = () => {};
export function haltInertia() { stopInertiaFn(); }
