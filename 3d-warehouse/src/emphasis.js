// ============================================================================
// emphasis.js —— 高亮、定位与视角复位（依赖 config / state / scene / camera / panel）
// ----------------------------------------------------------------------------
// 职责：回答"当前该强调哪个箱位"这个问题。
//   定位某条物资 → 聚焦镜头 + 打高亮轮廓 + 压暗其他 + 写面包屑 + 刷新侧栏
//   取消选中     → 一切恢复默认
// ============================================================================

import * as THREE from 'three';
import { VIEW_CENTER, FLY_DURATION } from './config.js';
import { state, view2d } from './state.js';
import { outline } from './scene.js';
import { flyTo, flyToOverview } from './camera.js';
import { exitMap } from './mapview.js';
import { positionFor, breadcrumbFor } from './layout.js';
import {
  showSelInfo, hideSelInfo, hideBreadcrumb, hideNoHit,
  setBreadcrumb, renderResults, setResultCount, clearInput,
  clearActiveResult, markActiveResult,
} from './panel.js';

/**
 * 调整所有箱位的视觉权重。
 * @param {string|null} activeBoxId 要突出的箱位；null = 全部恢复常规
 */
export function setEmphasis(activeBoxId) {
  for (const mesh of state.slotMeshes) {
    const m = mesh.material;

    if (activeBoxId && mesh.userData.occupied && mesh.userData.boxId !== activeBoxId) {
      // 有货但非目标 → 压暗，让目标跳出来
      m.color.setHex(mesh.userData.baseColor);
      m.opacity = 0.2;
      m.transparent = true;
    } else if (mesh.userData.occupied) {
      // 目标箱位 → 实心原色
      m.color.setHex(mesh.userData.baseColor);
      m.opacity = 1;
      m.transparent = false;
    } else {
      // 空箱位 → 半透明
      m.opacity = 0.12;
      m.transparent = true;
    }
  }
}

/**
 * 定位到一条物资记录：镜头飞过去 + 高亮 + 侧栏 + 面包屑。
 * @param {object} item 标准结构的物资记录（含 boxId / zone / row / level）
 */
export function locate(item) {
  // 如果正在看全屏地图，先退出——用户明确点了某一条，就是要落到 3D 细看
  if (state.topView) exitMap(false);

  state.highlightBoxId = item.boxId;
  state.nohit = false;
  setEmphasis(item.boxId);

  // 高亮轮廓只作用于当前目标（meshes 里只有"已占用"箱位）
  const mesh = state.meshes.get(item.boxId);
  outline.selectedObjects = mesh ? [mesh] : [];

  const pos = positionFor(item.zone, item.row, item.level);
  const target = new THREE.Vector3(pos.x, pos.y, pos.z);

  // 地面标记环挪到目标脚下，并让它现身（它的语义就是"目标在这里"）
  state.marker.position.set(pos.x, 0.06, pos.z);
  state.marker.visible = true;

  // 俯视模式下顺手把 2D 缩放拉近一点（至少 1.6），透视模式传 null 表示不动
  const z2 = state.topView ? Math.max(1.6, view2d.zoom) : null;
  flyTo(target, 11, 1.12, -0.5, FLY_DURATION, z2);

  setBreadcrumb('定位路径：' + breadcrumbFor(item));
  hideNoHit();
  showSelInfo(item);
  markActiveResult(item.materialId);
}

/** 复位：清除高亮、镜头飞回默认全景、清空搜索与侧栏 */
export function resetView() {
  state.highlightBoxId = null;
  state.nohit = false;
  setEmphasis(null);
  outline.selectedObjects = [];

  // 如果正在看全屏地图，先退出（否则全景会飞到看不见的地方）
  if (state.topView) exitMap(false);

  // 掐掉旋转惯性：复位是"强制回到全景"的指令，
  // 若惯性还在跑，它会和 flyToOverview 的动画互相覆盖，镜头落不到全景上。
  if (typeof onResetHook === 'function') onResetHook();

  // 复位 = 清掉一切指向某个箱位的标记，所以标记环要**藏起来**，
  // 而不是像以前那样只挪回场景中央 —— 那样会留下一个没有任何指代的红圈。
  // 位置仍一起归位，是为了下次 locate() 时它是从中央出发，动画连贯。
  state.marker.visible = false;
  state.marker.position.set(VIEW_CENTER.x, 0.06, VIEW_CENTER.z);

  // 按当前画布比例选全景距离：手机竖屏要站远一点，否则 C 区会被切出画面
  flyToOverview();

  hideBreadcrumb();
  hideNoHit();
  hideSelInfo();
  clearInput();
  renderResults([], locate);
  setResultCount(0);
  clearActiveResult();
}

/** 复位前的额外清理回调（由 main.js 注册为"停掉惯性"），避免反向依赖 controls */
let onResetHook = null;
export function setResetHook(fn) { onResetHook = fn; }
