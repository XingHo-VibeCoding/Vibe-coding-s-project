// ============================================================================
// mapview.js —— 全屏俯视地图（依赖 config / state / scene / camera / panel）
// ----------------------------------------------------------------------------
// 职责：回答"现在是不是在全屏地图上"以及"怎么进出地图"。
//
// 为什么单独拆一个文件：
//   地图是"换个角度看同一批货位"，本身不产生新数据、不改变业务规则。
//   拆出来后，删掉地图功能只需要删本文件 + main.js 里两行调用，
//   相机、搜索、面板都不受影响。
//
// 交互：
//   进入地图（点面包屑 / 点左下"地图"按钮 / 按 M）→ 切换到俯视正交相机
//   在地图里点任意位置                        → 镜头飞过去，并自动回到 3D 看
//   再点一次按钮 / 按 M / 按 Esc               → 退出地图，还原进地图前的 3D 视角
// ============================================================================

import * as THREE from 'three';
import { VIEW_CENTER, MAP_ENTER_ZOOM } from './config.js';
import { state, view, view2d } from './state.js';
import { topCam } from './scene.js';
import { flyTo, stopFly } from './camera.js';

/** 当前是否在全屏地图模式 */
export function isMapMode() {
  return state.topView;
}

/**
 * 进入全屏地图。
 * 先快照当前 3D 视角，退出时原样还原，用户不会"迷路"。
 */
export function enterMap() {
  if (state.topView) return false;

  state.saved3dView = {
    target: view.target.clone(),
    radius: view.radius,
    phi: view.phi,
    theta: view.theta,
  };

  state.topView = true;
  // 地图以场景中心为目标，缩放到刚好装下 A~C 三个区域
  view2d.target.copy(new THREE.Vector3(VIEW_CENTER.x, VIEW_CENTER.y, VIEW_CENTER.z));
  view2d.zoom = MAP_ENTER_ZOOM;

  syncUi();
  return true;
}

/**
 * 退出全屏地图，还原进地图前的 3D 视角。
 * @param {boolean} [fly] 是否用动画飞回去（地图点选跳转时用 false，直接落地更跟手）
 */
export function exitMap(fly = true) {
  if (!state.topView) return false;

  state.topView = false;
  stopFly();

  const saved = state.saved3dView;
  if (saved) {
    if (fly) {
      flyTo(saved.target, saved.radius, saved.phi, saved.theta, 700);
    } else {
      // 直接落到目标视角，避免"点一下要等两秒"
      view.target.copy(saved.target);
      view.radius = saved.radius;
      view.phi = saved.phi;
      view.theta = saved.theta;
    }
    state.saved3dView = null;
  }

  syncUi();
  return true;
}

/** 进出地图 */
export function toggleMap() {
  return state.topView ? exitMap() : enterMap();
}

/**
 * 把屏幕点击坐标换算成"地图上的世界坐标"。
 * 只在地图模式下有意义。
 *
 * 实现说明：不用手推正交公式，而是直接发射一条射线与地面（y=0）求交点。
 * 这样相机的 bounds、zoom、position、up 朝向无论怎么变，结果都自动正确，
 * 不会出现"改了相机参数忘了改公式"的隐性 bug。
 *
 * @param {number} clientX 屏幕 X（相对视口）
 * @param {number} clientY 屏幕 Y（相对视口）
 * @param {HTMLElement} host 画布容器
 * @returns {{x:number, z:number}|null}
 */
export function screenToGround(clientX, clientY, host) {
  if (!state.topView || !host) return null;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  // 屏幕坐标 → 归一化设备坐标（NDC），范围 [-1, 1]
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), topCam);

  // 与地面平面 y=0 求交点
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const ok = raycaster.ray.intersectPlane(plane, hit);

  return ok ? { x: hit.x, z: hit.z } : null;
}

/**
 * 在地图上点一下：
 *   1. 若正好点到某个有货的箱位 → 直接定位到它（最符合直觉）
 *   2. 否则落到点到的地面位置，平移到那里看
 * 两种情况都会退出地图回到 3D。
 * @returns {{x:number,z:number}|null} 换算出的世界坐标，换算失败返回 null
 */
export function pickOnMap(clientX, clientY, host) {
  if (!state.topView || !host) return null;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), topCam);

  // 先看有没有点中箱位。
  // 注意：俯视下同一排的三层箱子是垂直重叠的，射线必然只打到最上面那层，
  // 所以"点中箱位"只能确定到**哪一排**，定不到具体层。
  // 处理方式：在同一排里挑一个"有货的"箱位定位（优先选中该排最上层的有货箱），
  // 这样用户在地图上点一下就能落到正确的排，层由 3D 视图里显示。
  const occupied = state.slotMeshes.filter((m) => m.userData.occupied);
  const hits = raycaster.intersectObjects(occupied, false);
  if (hits.length) {
    const point = hits[0].point;
    // 该排（同一 zone + 同一 row）里所有有货箱位，取层号最大的
    const sameRow = hits[0].object.userData;
    const row = String(sameRow.boxId).split('-')[1];   // A-01-02 → '01'
    const zone = String(sameRow.boxId).split('-')[0];  // 'A'
    const inRow = state.items
      .filter((it) => it.zone === zone && String(it.row).padStart(2, '0') === row)
      .sort((a, b) => b.level - a.level);

    if (inRow.length && typeof onPickBox === 'function') {
      onPickBox(inRow[0].boxId);
      return { x: point.x, z: point.z };
    }
  }

  // 没点中箱位 → 落到地面位置
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ground = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, ground)) return null;

  focusGround(ground);

  return { x: ground.x, z: ground.z };
}

/** 点中箱位时的回调（由 main.js 注册为 emphasis.locateById，避免直接依赖 search/emphasis） */
let onPickBox = null;
export function setPickBoxHook(fn) {
  onPickBox = fn;
}

/** 把 3D 镜头平移到指定地面位置并退出地图 */
function focusGround(ground) {
  const saved = state.saved3dView;
  const radius = saved ? Math.min(saved.radius, 34) : 34;
  const phi = saved ? saved.phi : 1.05;
  const theta = saved ? saved.theta : 0.62;

  state.topView = false;
  stopFly();
  state.saved3dView = null;
  syncUi();

  const target = new THREE.Vector3(ground.x, VIEW_CENTER.y, ground.z);
  view.target.copy(target);
  flyTo(target, radius, phi, theta, 780);
}

/** 把地图状态同步到界面：body class + 按钮文字 + 提示条 */
function syncUi() {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('map-mode', state.topView);

  // 界面文字由 panel 负责，这里只做"通知"，避免 mapview 直接碰 DOM 文本
  if (typeof onMapUiChange === 'function') onMapUiChange(state.topView);
}

/** 界面同步回调（由 main.js 注册，指向 panel.setMapUi） */
let onMapUiChange = null;
export function setMapUiHook(fn) {
  onMapUiChange = fn;
}
