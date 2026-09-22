// ============================================================================
// camera.js —— 相机运动（依赖 config / state / scene）
// ----------------------------------------------------------------------------
// 职责：把"视角参数"（球坐标 view / view2d）翻译成相机位置，并负责平滑过渡。
// 对外导出四个函数：
//   updateCamera()   每帧调用：按当前 view 数值摆放相机
//   flyTo(...)       设定一次相机动画（不立即生效，由 updateCamera 逐帧推进）
//   stepAnimation(dt) 每帧调用：推进动画进度
//   isAnimating()    是否还在动画中
// ============================================================================

import * as THREE from 'three';
import {
  FLY_DURATION, RADIUS_MIN, RADIUS_MAX, DEFAULT_VIEW, defaultRadiusFor,
  MAP_ZOOM_MIN, MAP_ZOOM_MAX, PHI_MIN, PHI_MAX, WALK_BOUNDS,
} from './config.js';
import { state, view, view2d } from './state.js';
import { camera, topCam, renderPass, outline, placeTopCam } from './scene.js';

/** 当前正在进行的相机动画（null = 静止） */
let anim = null;

/**
 * 俯仰角靠近边界多少比例开始减速。
 *
 * 0.10 = 只有最后 10% 的行程（约 8.6°）带阻尼。
 *
 * 为什么从 0.25 缩到 0.10：0.25 意味着**四分之一行程都在减速**，
 * 用户滑到一半就感觉"越来越不跟手"，滑到 200px 时响应只剩百分之几 ——
 * 主观感受是"卡死了、坏了"，而不是"到头了"。
 * 缩窄之后，绝大部分行程是全速跟手的，只在最后约 8° 轻轻收一下，
 * 到头的瞬间干脆利落，反而更像"撞到底"这种可理解的物理感。
 *
 * 注意：这只是**减速带**，不是"软到无限"。真到边界仍然是硬停 ——
 * 这是球坐标相机的固有性质，任何 3D 软件都一样（见 config.js 的 PHI_MIN 说明）。
 */
const EDGE_DAMP_ZONE = 0.10;

/** 平滑缓动（先加速后减速），让镜头飞行更自然 */
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 每帧调用：根据 view / view2d 的数值摆放活动相机 */
export function updateCamera() {
  const cam = state.topView ? topCam : camera;

  if (!state.topView) {
    // 球坐标 → 直角坐标：以 target 为中心，按半径 / 俯仰 / 偏航算出相机位置
    const sinPhi = Math.sin(view.phi);
    const ox = view.radius * sinPhi * Math.sin(view.theta);
    const oy = view.radius * Math.cos(view.phi);
    const oz = view.radius * sinPhi * Math.cos(view.theta);
    camera.position.set(view.target.x + ox, view.target.y + oy, view.target.z + oz);
    camera.lookAt(view.target);
  } else {
    // 地图模式：俯视相机始终对准场景中心，只靠 target 平移 + zoom 缩放
    placeTopCam();
    topCam.position.set(view2d.target.x, 90, view2d.target.z);
    topCam.zoom = view2d.zoom;
    topCam.updateProjectionMatrix();
  }

  // 让后处理管线使用当前活动相机（否则高亮轮廓会错位）
  renderPass.camera = cam;
  outline.renderCamera = cam;
}

/**
 * 设定一次相机动画。
 * @param {THREE.Vector3} toTarget 目标中心点
 * @param {number|null} toRadius   目标半径（null = 保持）
 * @param {number|null} toPhi      目标俯仰角（null = 保持）
 * @param {number|null} toTheta    目标偏航角（null = 保持）
 * @param {number} dur             时长（毫秒）
 * @param {number|null} toZoom     目标 2D 缩放（null = 保持）
 */
export function flyTo(toTarget, toRadius, toPhi, toTheta, dur = FLY_DURATION, toZoom) {
  anim = {
    t: 0,
    dur,
    from: {
      target: view.target.clone(),
      radius: view.radius,
      phi: view.phi,
      theta: view.theta,
      zoom: view2d.zoom,
    },
    to: {
      target: toTarget.clone(),
      radius: toRadius == null ? view.radius : toRadius,
      phi: toPhi == null ? view.phi : toPhi,
      theta: toTheta == null ? view.theta : toTheta,
      zoom: toZoom == null ? view2d.zoom : toZoom,
    },
  };
}

/** 立即中断动画，相机停在当前位置 */
export function stopFly() {
  anim = null;
}

/** 是否正在播放相机动画 */
export function isAnimating() {
  return anim !== null;
}

/** 每帧调用：按 dt（秒）推进动画进度 */
export function stepAnimation(dt) {
  if (!anim) return;

  // dur <= 0 表示"不做动画、立刻落位"。
  // 必须单独判掉：否则 anim.t / anim.dur 是 0/0 = NaN，k 变 NaN 后
  // 所有 lerp 结果全成 NaN，相机位置直接坏掉（半径读出 NaN）。
  // 这个能力是开屏摆机位要用的（见 main.js 的 flyToOverview(0)）。
  if (anim.dur <= 0) {
    view.target.copy(anim.to.target);
    view2d.target.copy(anim.to.target);
    view.radius = anim.to.radius;
    view.phi = anim.to.phi;
    view.theta = anim.to.theta;
    view2d.zoom = anim.to.zoom;
    anim = null;
    return;
  }

  anim.t += dt * 1000;
  const k = easeInOut(Math.min(1, anim.t / anim.dur));
  view.target.lerpVectors(anim.from.target, anim.to.target, k);
  view2d.target.lerpVectors(anim.from.target, anim.to.target, k);
  view.radius = anim.from.radius + (anim.to.radius - anim.from.radius) * k;
  view.phi = anim.from.phi + (anim.to.phi - anim.from.phi) * k;
  view.theta = anim.from.theta + (anim.to.theta - anim.from.theta) * k;
  view2d.zoom = anim.from.zoom + (anim.to.zoom - anim.from.zoom) * k;
  if (anim.t >= anim.dur) anim = null;
}

/** 缩放：鼠标滚轮 / 双指捏合都走这里，统一夹在安全区间内 */
export function zoomBy(factor) {
  if (state.topView) {
    view2d.zoom = clamp(view2d.zoom * factor, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  } else {
    view.radius = clamp(view.radius * factor, RADIUS_MIN, RADIUS_MAX);
  }
}

/**
 * 飞回全景（按当前画布比例自动选距离）。
 * 为什么要按比例：手机竖屏水平可视角度只有约 23°，固定 52 装不下 A~C 三个区域，
 * 会让 C 区标签被右边缘切掉。这里按画布宽高比算出合适的距离。
 * @param {number} [dur] 动画时长
 */
export function flyToOverview(dur = FLY_DURATION) {
  const aspect = camera.aspect || 1.6;
  const radius = defaultRadiusFor(aspect);
  flyTo(DEFAULT_VIEW.target.clone(), radius, DEFAULT_VIEW.phi, DEFAULT_VIEW.theta, dur);
  return radius;
}

/**
 * 旋转：拖动时改变偏航 / 俯仰（只在 3D 透视下有效）。
 *
 * 这里必须 stopFly()，这是个**真实缺陷修复**：
 * 相机飞行动画（flyTo）每帧都会把 view.theta 重写成"起点→终点"的插值结果。
 * 如果动画还没播完用户就开始拖，手指刚算出的 theta 会在下一帧被动画覆盖掉，
 * 表现就是"手指明明在动，画面却几乎不转 / 要划好几下才动一下"。
 * 用户主动拖动 = 接管镜头的意图，立刻中断动画，把控制权交回手指。
 *
 * theta（偏航）**不设上下限**，横向可以一直转下去 —— 这是"无限拖拽"的主要来源。
 * 只做归一化到 (-π, π]：同一个朝向只对应一个数值，避免数值随使用时长无界增长。
 *
 * phi（俯仰）有物理边界，到边界时**平滑衰减**而不是硬停：
 * 硬夹会让人感觉"卡住了"，而按"离边界还剩多少"同比削减这一步的位移，
 * 就是"越转越沉、自然到头"的手感（和滚轮/触控板的边缘阻尼同理）。
 */
export function rotateBy(dTheta, dPhi) {
  stopFly();
  view.theta = wrapAngle(view.theta + dTheta);
  view.phi = clamp(view.phi + dampToBounds(view.phi, dPhi, PHI_MIN, PHI_MAX), PHI_MIN, PHI_MAX);
}

/**
 * 朝边界方向推进时的阻尼。
 * @param {number} cur 当前值
 * @param {number} delta 本步位移
 * @param {number} lo 下界
 * @param {number} hi 上界
 * @returns {number} 实际生效的位移
 */
function dampToBounds(cur, delta, lo, hi) {
  if (!delta) return 0;
  // 离目标边界的剩余距离，占整个区间的多少（0=贴边，1=刚离开）
  const remain = delta < 0
    ? (cur - lo) / (hi - lo)
    : (hi - cur) / (hi - lo);
  if (remain >= EDGE_DAMP_ZONE) return delta;      // 还离得远，正常跟手
  const k = Math.max(0, remain) / EDGE_DAMP_ZONE;  // 0 → 贴边（不动），1 → 可全速
  return delta * k;
}

/** 把角度折算到 (-π, π]，保证同一个朝向只有一个表示 */
function wrapAngle(a) {
  const TWO_PI = Math.PI * 2;
  let x = a % TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  if (x > Math.PI) x -= TWO_PI;
  return x;
}

/**
 * 平移：把屏幕像素位移换算成世界坐标位移。
 *
 * 和 rotateBy 同理，先 stopFly()：动画正在推进时 target 每帧都被重写，
 * 用户这时拖动（比如刚点完搜索结果、镜头还在飞，就想把画面挪一下）
 * 会看到"拖了没反应"。主动拖动即视为接管镜头。
 *
 * @param {number} dx 水平像素位移
 * @param {number} dy 垂直像素位移
 */
export function panBy(dx, dy) {
  stopFly();
  const tgt = state.topView ? view2d.target : view.target;
  const dist = state.topView ? 18 / view2d.zoom : view.radius;
  const cam = state.topView ? topCam : camera;

  // 相机的"右"和"上"方向（从相机世界矩阵取前两列）
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);

  tgt.addScaledVector(right, -dx * dist * 0.0011);
  tgt.addScaledVector(up, dy * dist * 0.0011);
}

/** 当前是否处于 2D 俯视（controls / minimap 都要判断） */
export function isTopView() {
  return state.topView;
}

/**
 * 沿视线方向"走过去"：把注视点（target）在地面上前后左右推。
 *
 * 为什么需要它（和 zoomBy 的区别，也是它存在的唯一理由）：
 *   `zoomBy` 改的是 **radius** —— 你确实离注视点更近了，但绕的还是**同一个点**，
 *   相当于"站在原地把脸凑近"。想走到另一个货架跟前，必须把 **target 本身**挪过去。
 *   真机反馈的"一根手指只是移动我的视角，缺少定位"说的就是这个。
 *
 * 方向怎么算：
 *   相机位置 = target + radius·(sinφ·sinθ, cosφ, sinφ·cosθ)（见 updateCamera），
 *   所以"相机 → target"的**水平**方向就是 `-(sinθ, 0, cosθ)`。
 *   右方向 = 前进方向 × 上方向(0,1,0)，化简后为 `(cosθ, 0, -sinθ)`。
 *   直接从 theta 推导，比从相机世界矩阵取列更稳（矩阵在退化姿态下会翻）。
 *
 * ⚠️ 只改 X/Z、**绝不动 Y**：摇杆是"在地上走"，不是"飞"。
 *    若沿真实视线方向（含垂直分量）推，低头时会往地下钻、抬头会飞起来。
 *    Y 的边界也由 WALK_BOUNDS 只夹 X/Z 来保证（见 config.js）。
 *
 * 和 rotateBy / panBy 同理，先 stopFly()：动画推进时 target 每帧被重写，
 * 用户这时推摇杆会看到"推了没反应"。主动操作即视为接管镜头。
 *
 * @param {number} forward 前进量（世界单位，正 = 朝注视点方向走）
 * @param {number} strafe  左右平移量（世界单位，正 = 往右手边走）
 */
export function dollyBy(forward, strafe) {
  stopFly();
  if (!forward && !strafe) return;

  const sinT = Math.sin(view.theta);
  const cosT = Math.cos(view.theta);
  const fx = -sinT, fz = -cosT;   // 前进（水平）
  const rx = cosT, rz = -sinT;    // 右手边

  const tgt = view.target;
  tgt.x = clamp(tgt.x + fx * forward + rx * strafe, WALK_BOUNDS.minX, WALK_BOUNDS.maxX);
  tgt.z = clamp(tgt.z + fz * forward + rz * strafe, WALK_BOUNDS.minZ, WALK_BOUNDS.maxZ);
}

export { clamp };
