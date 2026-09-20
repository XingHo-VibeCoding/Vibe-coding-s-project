// ============================================================================
// minimap.js —— 小地图（独立模块，当前界面已停用）
// ----------------------------------------------------------------------------
// 为什么单独拆一个文件：小地图是"可选装饰件"，跟核心找货流程无关。
// 拆出来后，主流程完全不依赖它，将来要删要改只要删这一个文件 + 一处调用。
//
// 停用说明：index.html 里已移除 #minimap 结构，因此 initMinimap() 会直接返回。
//           日后想恢复，把 HTML 结构加回来即可，本模块代码无需改动。
// ============================================================================

import * as THREE from 'three';
import { VIEW_CENTER } from './config.js';
import { scene } from './scene.js';
import { flyTo } from './camera.js';

/** 小地图渲染器（未启用时为 null） */
let miniRenderer = null;
let miniHost = null;
/** 俯视正交相机：从高处往下拍，得到"平面图"效果 */
const miniCam = new THREE.OrthographicCamera(-28, 28, 14, -4, 0.1, 200);

/** 小地图是否已启用 */
export function isMinimapActive() {
  return !!miniRenderer;
}

/** 初始化小地图。容器不存在时静默跳过（这就是"停用"的方式）。 */
export function initMinimap() {
  miniHost = document.getElementById('minimap-canvas');
  if (!miniHost) return;

  miniRenderer = new THREE.WebGLRenderer({ antialias: true });
  miniRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  miniHost.appendChild(miniRenderer.domElement);

  miniCam.position.set(0, 60, 5);
  miniCam.up.set(0, 0, -1);
  miniCam.lookAt(0, 0, 5);

  // 点击小地图 = 快速跳到该位置
  miniHost.addEventListener('pointerdown', (e) => {
    const rect = miniHost.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const wx = miniCam.left + nx * (miniCam.right - miniCam.left);
    const wz = miniCam.bottom + (1 - ny) * (miniCam.top - miniCam.bottom);
    flyTo(new THREE.Vector3(wx, VIEW_CENTER.y, wz), null, null, null, 600);
  });
}

/** 尺寸变化时重算小地图视口（未启用则跳过） */
export function sizeMinimap() {
  if (!miniRenderer || !miniHost) return;
  const w = miniHost.clientWidth || 208;
  const h = miniHost.clientHeight || 150;
  miniRenderer.setSize(w, h, false);

  const halfH = 12;
  const halfW = halfH * (w / h);
  miniCam.left = -halfW;
  miniCam.right = halfW;
  miniCam.top = 5 + halfH;
  miniCam.bottom = 5 - halfH;
  miniCam.updateProjectionMatrix();
}

/** 每帧渲染小地图（未启用则跳过） */
export function renderMinimap() {
  if (!miniRenderer) return;
  miniRenderer.render(scene, miniCam);
}
