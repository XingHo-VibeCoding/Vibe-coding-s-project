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
import { FLY_DURATION } from './config.js';
import { state, view, view2d } from './state.js';
import { camera, topCam, renderPass, outline } from './scene.js';

/** 当前正在进行的相机动画（null = 静止） */
let anim = null;

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
    topCam.position.set(view2d.target.x, 90, view2d.target.z);
    topCam.up.set(0, 0, -1);
    topCam.lookAt(view2d.target.x, 0, view2d.target.z);
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
    view2d.zoom = clamp(view2d.zoom * factor, 0.6, 6);
  } else {
    view.radius = clamp(view.radius * factor, 6, 120);
  }
}

/** 旋转：拖动时改变偏航 / 俯仰（只在 3D 透视下有效） */
export function rotateBy(dTheta, dPhi) {
  view.theta += dTheta;
  view.phi = clamp(view.phi + dPhi, 0.05, Math.PI / 2 - 0.02);
}

/**
 * 平移：把屏幕像素位移换算成世界坐标位移。
 * @param {number} dx 水平像素位移
 * @param {number} dy 垂直像素位移
 */
export function panBy(dx, dy) {
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

export { clamp };
