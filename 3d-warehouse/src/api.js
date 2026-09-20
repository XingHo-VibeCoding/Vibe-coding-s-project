// ============================================================================
// api.js —— 对外测试接口（依赖 state / scene / emphasis / search / camera）
// ----------------------------------------------------------------------------
// 职责：把内部能力暴露成 window.__diag / window.__api，供自动化测试与调试使用。
// 单独成文件的原因：这是"给机器用的接口"，不是产品功能，混在主流程里会干扰阅读。
// ============================================================================

import { state, view } from './state.js';
import { camera, topCam, outline } from './scene.js';
import { search } from './search.js';
import { resetView, locate } from './emphasis.js';
import { isMinimapActive } from './minimap.js';

const round2 = (arr) => arr.map((n) => +n.toFixed(2));

/** 挂载调试与自动化接口到 window */
export function exposeApi() {
  window.__diag = {
    ready: true,
    totalSlots: state.slotMeshes.length,
    occupiedCount: state.meshes.size,
    itemCount: state.items.length,
    cameraPos: () => round2(camera.position.toArray()),
    topCamPos: () => round2(topCam.position.toArray()),
    target: () => round2(view.target.toArray()),
    topView: () => state.topView,
    labelsVisible: () => state.labelsVisible,
    nohit: () => state.nohit,
    minimapVisible: () => {
      const mm = document.getElementById('minimap');
      return !!mm && !mm.classList.contains('hidden');
    },
    highlight: () => {
      if (!state.highlightBoxId) return null;
      const m = state.meshes.get(state.highlightBoxId);
      return {
        boxId: state.highlightBoxId,
        hex: m ? m.material.color.getHexString() : null,
        outline: outline.selectedObjects.length,
      };
    },
  };

  window.__api = {
    search,
    reset: resetView,
    locateById: (id) => {
      const it = state.byId.get(id);
      if (it) locate(it);
      return !!it;
    },
    toggleLabels: () => document.getElementById('btn-labels')?.click(),
    toggleView: () => document.getElementById('btn-view')?.click(),
    toggleMinimap: () => document.getElementById('btn-minimap')?.click(),
    minimapActive: isMinimapActive,
    getState: () => {
      const hi = window.__diag.highlight();
      return {
        ready: true,
        highlightBoxId: state.highlightBoxId,
        nohit: state.nohit,
        topView: state.topView,
        labelsVisible: state.labelsVisible,
        minimapVisible: window.__diag.minimapVisible(),
        cameraPos: window.__diag.cameraPos(),
        target: window.__diag.target(),
        highlightHex: hi ? hi.hex : null,
        outlineCount: hi ? hi.outline : 0,
      };
    },
  };
}

/** 启动失败时也要挂一个可被测试读到的错误对象 */
export function exposeError(err) {
  window.__diag = { ready: false, error: String((err && err.message) || err) };
}
