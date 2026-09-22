// ============================================================================
// joystick.js —— 左下角虚拟摇杆（依赖 config / state / camera）
// ----------------------------------------------------------------------------
// 职责：把"圆盘上的拖动偏移"翻译成"镜头在地面上走多远"，只做这一件事。
//
// 为什么单独一个文件，而不是塞进 controls.js：
//   controls.js 管的是**画布上的手势**（单指旋转 / 双指平移缩放），
//   摇杆是**叠加在画布之上的独立控件** —— 有自己的 DOM、自己的视觉状态、
//   自己的 rAF 循环。两套输入模型混在一个文件里，谁改谁都得先读懂另一半。
//
// 与 controls.js 的关系：**互不干扰**。
//   摇杆的指针事件落在摇杆元素上（不是 canvas），所以 controls.js 的
//   pointerdown 根本收不到，单指旋转的手感原封不动。
//
// 数据流（每帧）：
//   手指位置 → vec（-1.35~1.35，占盘半径比例）
//            → 死区 + 重新映射 → 0~1 的移动强度
//            → dollyBy(前进, 左右) → 改 view.target
//            → camera.updateCamera() 按新的 target 摆相机
// ============================================================================

import { JOYSTICK } from './config.js';
import { state } from './state.js';
import { dollyBy } from './camera.js';

/** 当前偏移（占盘半径的比例）。x 右为正，y 下为正 —— 与屏幕坐标一致。 */
let vec = { x: 0, y: 0 };
let baseEl = null;
let knobEl = null;
let activeId = null;   // 正在拖动摇杆的 pointerId（null = 没在拖）
// 测试专用：跳过"必须有手指按着"的限制，让循环继续跑。
// 真机路径永远走 activeId，这个标志只有 setVec() 会打开。
let forced = false;
let raf = 0;
let prevT = 0;

/**
 * 把偏移换算成"移动强度"。
 *
 * 两件事：
 *   ① 死区：强度小于 deadZone 直接当 0，避免手指静止时的微抖让画面自己飘。
 *   ② **重新映射**：把死区之外的部分线性拉伸到 0~1。
 *      不拉伸的话，手指刚越过死区就会瞬间跳到 12% 速度，起步会"蹿"一下；
 *      拉伸之后是从 0 平滑长起来的。
 *
 * @returns {{x:number,y:number}} 强度 0~1，方向为单位向量
 */
function movementVec() {
  const mag = Math.hypot(vec.x, vec.y);
  if (mag <= JOYSTICK.deadZone) return { x: 0, y: 0 };
  const t = Math.min(1, (mag - JOYSTICK.deadZone) / (1 - JOYSTICK.deadZone));
  return { x: (vec.x / mag) * t, y: (vec.y / mag) * t };
}

/** 按当前 vec 摆放摇杆头 */
function renderKnob() {
  if (!knobEl) return;
  // 摇杆头本身**夹在盘内**（推到盘外时它就贴边不动）——
  // 输入强度可以超出盘半径（见 clampRatio），但视觉上不该飞出去。
  const mag = Math.hypot(vec.x, vec.y);
  const k = mag > 1 ? 1 / mag : 1;
  const ox = vec.x * k * JOYSTICK.radius;
  const oy = vec.y * k * JOYSTICK.radius;
  knobEl.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
}

/**
 * 每帧推一次镜头。
 *
 * 为什么用 rAF 而不是"在 pointermove 里推"：
 *   手指停住不动时 pointermove 就不再触发，但用户显然期望**继续走**。
 *   摇杆是"持续输出"的控件，必须每帧按当前偏移推进。
 *   这也顺带解决了不同刷新率下的速度一致性（按 dt 算）。
 */
function step(now) {
  if (activeId === null && !forced) { raf = 0; return; }

  // 折算成秒。封顶 50ms：切后台再回来时 dt 可能是好几秒，
  // 不封顶会让镜头瞬移一大段（和 controls.js 惯性里封顶 48ms 同理）。
  const dt = Math.min(50, now - prevT) / 1000;
  prevT = now;

  // 俯视地图下不走：地图有自己的平移方式，两套同时生效会互相打架
  if (!state.topView) {
    const m = movementVec();
    if (m.x || m.y) {
      // 屏幕上方 = 前进，所以前进量取 -y（屏幕 y 向下为正）
      dollyBy(-m.y * JOYSTICK.speed * dt, m.x * JOYSTICK.speed * dt);
    }
  }

  raf = requestAnimationFrame(step);
}

/** 开始跑循环（已经在跑就不重复起） */
function startLoop() {
  if (raf) return;
  prevT = performance.now();
  raf = requestAnimationFrame(step);
}

/** 归中：偏移清零 + 摇杆头回中心 */
function center() {
  vec = { x: 0, y: 0 };
  renderKnob();
}
/** 按手指位置更新偏移（会被夹在 clampRatio 之内） */
function track(clientX, clientY) {
  const r = baseEl.getBoundingClientRect();
  let dx = clientX - (r.left + r.width / 2);
  let dy = clientY - (r.top + r.height / 2);

  const max = JOYSTICK.radius * JOYSTICK.clampRatio;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }

  vec = { x: dx / JOYSTICK.radius, y: dy / JOYSTICK.radius };
  renderKnob();
}

function onDown(e) {
  e.preventDefault();
  e.stopPropagation();       // 别让画布那边也收到（虽然元素不同，双保险）
  if (activeId !== null) return;   // 已经在拖了，忽略第二根手指

  activeId = e.pointerId;
  // 捕获指针：手指滑出圆盘甚至滑出屏幕，move 仍然能收到。
  // try/catch 同 controls.js —— 某些环境会抛 NotFoundError，抛了后面就全废。
  try { baseEl.setPointerCapture?.(e.pointerId); } catch (_) { /* 忽略 */ }

  baseEl.classList.add('is-active');
  track(e.clientX, e.clientY);
  startLoop();
}

function onMove(e) {
  if (e.pointerId !== activeId) return;
  e.preventDefault();
  track(e.clientX, e.clientY);
}

function onUp(e) {
  if (e.pointerId !== activeId) return;
  activeId = null;
  baseEl.classList.remove('is-active');
  center();
  // 循环会在下一帧自己发现 activeId === null 然后停掉，这里不用手动 cancel
}

/**
 * 绑定摇杆。
 *
 * 只在**触摸设备**启用：桌面端有鼠标滚轮/右键，摇杆纯属遮挡。
 * 判定用 maxTouchPoints / pointer:coarse，命中就给 body 加 `has-joystick`，
 * 由 CSS 决定怎么显示（JS 只给信号，样式交给 CSS —— 与抽屉同一套分工）。
 *
 * @returns {{getVec:Function, setVec:Function, reset:Function}} 测试用出口
 */
export function initJoystick() {
  baseEl = document.getElementById('joystick');
  knobEl = document.getElementById('joystick-knob');
  if (!baseEl || !knobEl) return { getVec: () => vec, setVec: () => {}, reset: center };

  const touchy = (navigator.maxTouchPoints || 0) > 0
    || window.matchMedia?.('(pointer: coarse)')?.matches;
  if (touchy) document.body.classList.add('has-joystick');

  // 把半径交给 CSS 当变量用。
  // 为什么要这样：摇杆盘的尺寸必须和 config.JOYSTICK.radius 严格一致 ——
  // track() 是拿"像素偏移 ÷ radius"算强度的，两边一旦不一致，
  // 就会出现"推到底也只有半速"或"没推满就满速"的错。
  // 与其在 CSS 里再抄一个 104px（改一处漏一处），不如让 JS 传过去，单一数据源。
  //
  // 写在 :root 而不是 baseEl 上：竖屏下结果面板的收起标签要**排在摇杆上方**
  // （`bottom: calc(var(--joystick-r) * 2 + 32px)`），它读的是同一个值。
  // 写在 baseEl 上时变量只沿 DOM 树往下继承，标签（.stage 的兄弟）读不到，
  // 只能再抄一个数字 —— 正是这里要避免的事。
  document.documentElement.style.setProperty('--joystick-r', JOYSTICK.radius + 'px');

  baseEl.addEventListener('pointerdown', onDown);
  baseEl.addEventListener('pointermove', onMove);
  baseEl.addEventListener('pointerup', onUp);
  baseEl.addEventListener('pointercancel', onUp);
  // 摇杆自己不该触发右键菜单 / 双击缩放
  baseEl.addEventListener('contextmenu', (e) => e.preventDefault());

  renderKnob();
  return {
    getVec: () => ({ ...vec }),
    // 测试用：直接设偏移并让循环跑起来（forced 跳过"必须有手指按着"）。
    // 真机路径不走这里 —— 测试另有"派发真实 pointer 事件"的用例覆盖 onDown/onMove。
    setVec: (x, y) => { forced = true; vec = { x, y }; renderKnob(); startLoop(); },
    reset: () => {
      forced = false;
      activeId = null;
      baseEl.classList.remove('is-active');
      center();
    },
  };
}
