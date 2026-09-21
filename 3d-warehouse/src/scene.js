// ============================================================================
// scene.js —— 渲染基建与场景构建（依赖 config / state / layout）
// ----------------------------------------------------------------------------
// 职责（三件事，彼此内聚）：
//   1. 创建渲染器、场景、两台相机、后处理管线（EffectComposer + OutlinePass）
//   2. 构建仓库静态几何：区域地台、立柱、箱位立方体、区域标签、目标标记环
//   3. 对外暴露 outline（高亮用）与 resize 方法
//
// 不负责：相机怎么动（→ camera.js）、搜索逻辑（→ search.js）、
//        鼠标键盘输入（→ controls.js）、界面 DOM（→ panel.js）
// ============================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { COLORS, BOX_SIZE, VIEW_CENTER } from './config.js';
import { state } from './state.js';
import {
  ZONES, ZONE_SLOTS, allSlots, positionFor, zoneLabel, SCENE_CENTER,
} from './layout.js';

/**
 * 俯视地图的视野半宽 / 半高（世界坐标）。
 * 半高固定 14，保证三排货架纵向完整入画；
 * 半宽取 30，保证 A~C 三个区域（X 跨度 44±，留边）横向完整入画。
 */
const SCENE_HALF_W = 30;
const SCENE_HALF_H = 14;

// ---------------------------------------------------------------------------
// 1. 渲染基建
// ---------------------------------------------------------------------------
const host = document.getElementById('canvas-host');

export const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(host.clientWidth, host.clientHeight);
host.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);

/** 3D 透视相机（主视图） */
export const camera = new THREE.PerspectiveCamera(
  50, host.clientWidth / host.clientHeight, 0.1, 1000
);

/** 2D 俯视正交相机（全屏地图）。视野由 syncTopCamBounds() 按画布比例维护。 */
export const topCam = new THREE.OrthographicCamera(-28, 28, 14, -4, 0.1, 200);

// 后处理：RenderPass（主渲染）+ OutlinePass（高亮发光轮廓）+ FXAA（抗锯齿）
export const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
composer.setSize(host.clientWidth, host.clientHeight);

export const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

/** 高亮轮廓通道：定位到某个箱位时，由 emphasis.js 设置 selectedObjects */
export const outline = new OutlinePass(
  new THREE.Vector2(host.clientWidth, host.clientHeight), scene, camera
);
outline.edgeStrength = 3.4;
outline.edgeGlow = 0.5;
outline.edgeThickness = 1.3;
outline.pulsePeriod = 0;            // 保持静止、克制，不闪烁
outline.visibleEdgeColor.set('#ff6a4d');
outline.hiddenEdgeColor.set('#ffd28a');
composer.addPass(outline);

export const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);

/** 主 3D 相机当前是否可见（供 __diag 使用） */
export const canvasHost = host;

// ---------------------------------------------------------------------------
// 2. 灯光与地面网格
// ---------------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.78));

const dir = new THREE.DirectionalLight(0xffffff, 0.65);
dir.position.set(30, 50, 25);
scene.add(dir);

const dir2 = new THREE.DirectionalLight(0xffffff, 0.22);
dir2.position.set(-25, 30, -20);
scene.add(dir2);

const grid = new THREE.GridHelper(120, 60, COLORS.grid, COLORS.grid);
grid.position.y = 0;
scene.add(grid);

// ---------------------------------------------------------------------------
// 3. 场景构建
// ---------------------------------------------------------------------------
/** 构建整个仓库：地台 + 立柱 + 箱位 + 区域标签 + 标记环。启动时调用一次。 */
export function buildWarehouse() {
  buildZoneFloors();
  buildSlots();
  buildZoneLabels();
  buildMarker();
}

/** 每个区域一块地台 + 四根立柱（纯装饰，建立"区域"的空间感） */
function buildZoneFloors() {
  for (const zone of ZONES) {
    const { rows, levels } = ZONE_SLOTS[zone];
    const x = positionFor(zone, 1, 1).x;
    const depth = (rows - 1) * 5 + BOX_SIZE + 1.2;
    const height = (levels - 1) * 2.4 + BOX_SIZE + 1.2;

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(BOX_SIZE + 1.4, 0.2, depth),
      new THREE.MeshStandardMaterial({ color: COLORS.zoneFloor, roughness: 0.95 })
    );
    floor.position.set(x, 0.1, ((rows - 1) * 5) / 2);
    scene.add(floor);

    const postGeo = new THREE.BoxGeometry(0.18, height, 0.18);
    const postMat = new THREE.MeshStandardMaterial({ color: COLORS.post, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.position.set(
          x + sx * (BOX_SIZE / 2 + 0.5),
          height / 2,
          ((rows - 1) * 5) / 2 + sz * (depth / 2 - 0.2)
        );
        scene.add(p);
      }
    }
  }
}

/** 所有箱位立方体：有货 = 实心着色，空箱 = 半透明灰 */
function buildSlots() {
  const occupied = new Set(state.items.map((it) => it.boxId));

  for (const slot of allSlots()) {
    const pos = positionFor(slot.zone, slot.row, slot.level);
    const isOcc = occupied.has(slot.boxId);
    const color = isOcc ? COLORS.boxByZone[slot.zone] : COLORS.boxEmpty;

    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.62, metalness: 0.05,
      transparent: !isOcc, opacity: isOcc ? 1 : 0.14,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE), mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.userData = { boxId: slot.boxId, occupied: isOcc, baseColor: color };
    scene.add(mesh);

    state.slotMeshes.push(mesh);
    if (isOcc) state.meshes.set(slot.boxId, mesh);
  }
}

/** 区域悬浮标签（A 区 / B 区 / C 区） */
function buildZoneLabels() {
  state.labelGroup = new THREE.Group();
  for (const zone of ZONES) {
    const x = positionFor(zone, 1, 1).x;
    const sprite = makeLabel(zoneLabel(zone), x, 7.6, ((ZONE_SLOTS[zone].rows - 1) * 5) / 2);
    state.labelGroup.add(sprite);
  }
  scene.add(state.labelGroup);
}

/** 目标箱位脚下的地面标记环（主视图与小地图共用） */
function buildMarker() {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.0, 1.35, 32),
    new THREE.MeshBasicMaterial({
      color: COLORS.marker, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthTest: false,
    })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(VIEW_CENTER.x, 0.06, VIEW_CENTER.z);
  marker.renderOrder = 5;
  // 初始就隐藏：这个环的语义是"目标箱位在这里"，没有任何目标时它不该出现。
  // 之前是建好就 visible，且 resetView() 只把它挪回场景中央而不隐藏 ——
  // 于是页面一打开空地正中间就杵着一个红圈，看着像个错误提示，
  // 用户会以为是"哪里坏了"（真机截图反馈确认过）。
  // 显示时机由 emphasis.js 的 locate()/resetView() 决定。
  marker.visible = false;
  scene.add(marker);
  state.marker = marker;
}

/** 生成一张带圆角底板的文字精灵（用 canvas 画好后贴到 Sprite 上） */
function makeLabel(text, x, y, z) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'rgba(34,46,58,0.92)';
  roundRect(ctx, 28, 34, 200, 60, 12);
  ctx.fill();

  ctx.fillStyle = '#eaf2f9';
  ctx.font = 'bold 44px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;

  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sp.scale.set(5, 2.5, 1);
  sp.position.set(x, y, z);
  return sp;
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

// ---------------------------------------------------------------------------
// 4. 尺寸变化
// ---------------------------------------------------------------------------
/** 窗口或容器尺寸变化时，同步渲染器 / 相机 / 后处理管线 */
export function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;

  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  syncTopCamBounds(w, h);
  composer.setSize(w, h);
  outline.setSize(w, h);

  const dpr = renderer.getPixelRatio();
  fxaa.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
}

/**
 * 让俯视正交相机的视野随画布宽高比变化。
 * 为什么必须做：topCam 的 bounds 是固定的（-28~28 宽、-4~14 高），
 * 竖屏时画布又窄又高，固定 bounds 会把左右两边裁掉，地图上就看不到 C 区。
 * 这里保证"横向始终能看到 SCENE_HALF_W"，纵向按比例自然延伸。
 */
export function syncTopCamBounds(w = host.clientWidth, h = host.clientHeight) {
  const aspect = h > 0 ? w / h : 1;

  const halfH = SCENE_HALF_H;
  const halfW = Math.max(SCENE_HALF_W, halfH * aspect);

  topCam.left = -halfW;
  topCam.right = halfW;
  topCam.top = halfH;
  topCam.bottom = -halfH;
  topCam.updateProjectionMatrix();
}

/**
 * 摆放俯视相机。
 * 为什么单独抽出来：相机在 y=90 往下看，up 设成 (0,0,-1) 才能让"屏幕上方 = 场景北侧"；
 * 如果只在 camera.js 每帧设置，地图刚切换的第一帧可能还是旧朝向。
 */
export function placeTopCam() {
  topCam.position.set(0, 90, SCENE_CENTER.z);
  topCam.up.set(0, 0, -1);
  topCam.lookAt(0, 0, SCENE_CENTER.z);
}
