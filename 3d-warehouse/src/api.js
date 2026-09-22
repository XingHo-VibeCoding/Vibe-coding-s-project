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
import { isMapMode, enterMap, exitMap, toggleMap, screenToGround } from './mapview.js';
import { isSelInfoExpanded, toggleSelInfo, setMapUi, setLoading, setLoadError, clearLoadError, setDrawerLevel, getDrawerLevel, revealResults } from './panel.js';
import { defaultRadiusFor, PHI_MIN, PHI_MAX } from './config.js';
import { haltInertia } from './controls.js';

const round2 = (arr) => arr.map((n) => +n.toFixed(2));

/** 挂载调试与自动化接口到 window */
export function exposeApi(joystick) {
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
    mapMode: () => isMapMode(),
    mapRadius: () => defaultRadiusFor(camera.aspect),
    mapBounds: () => ({
      left: +topCam.left.toFixed(2), right: +topCam.right.toFixed(2),
      top: +topCam.top.toFixed(2), bottom: +topCam.bottom.toFixed(2),
      zoom: +topCam.zoom.toFixed(3),
    }),
    selExpanded: () => isSelInfoExpanded(),
    // 俯仰角边界（供测试断言"能转到接近垂直"）
    phiRange: () => ({ min: PHI_MIN, max: PHI_MAX }),
    /** 结果面板当前处于哪一态：'loading' | 'error' | 'empty' | 'list' */
    panelState: () => {
      if (state.loading) return 'loading';
      if (state.loadError) return 'error';
      return document.querySelectorAll('#results .result-item.is-card').length
        ? 'list' : 'empty';
    },
    /** 面板里实际渲染出来的物资卡片数（骨架块不算） */
    cardCount: () => document.querySelectorAll('#results .result-item.is-card').length,
    loading: () => state.loading === true,
    /**
     * 结果面板抽屉的当前状态。
     * height 取的是**实际渲染高度**而不是 CSS 变量 ——
     * 变量只是"想要多高"，真正生效还要过层叠/媒体查询，
     * 测试要验的是"用户看到多高"，所以读盒子。
     */
    drawer: () => {
      const p = document.getElementById('panel');
      if (!p) return null;
      const grip = document.getElementById('panel-grip');
      const gripShown = grip ? getComputedStyle(grip).display !== 'none' : false;
      return {
        level: getDrawerLevel(),
        attr: p.dataset.drawer ?? null,
        varH: p.style.getPropertyValue('--drawer-h') || null,
        height: Math.round(p.getBoundingClientRect().height),
        gripVisible: gripShown,
      };
    },
    /** 每个档位对应的 CSS 变量值（供测试断言"档位 → 高度"的映射） */
    drawerRatios: () => ({ peek: 0.27, half: 0.5, full: 0.82 }),
    /**
     * 左下虚拟摇杆的状态。
     *
     * visible 读的是**实际渲染结果**（display 计算值），不是 body 上的 class ——
     * class 只说明"这台设备该有摇杆"，地图模式下 CSS 会把它藏起来，
     * 测试要验的是"用户看不看得见"。
     */
    joystick: () => {
      const el = document.getElementById('joystick');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // left / bottom 取的是**相对定位父元素**（.stage）的偏移，
      // 而不是相对视口 —— 竖屏下面板占着屏幕下方一大块，
      // 相对视口算出来的 bottom 会是两百多像素，看着像"跑到中间去了"。
      // CSS 的 left/bottom 本来就是相对定位父元素的，这里对齐同一个口径。
      const host = el.offsetParent ? el.offsetParent.getBoundingClientRect() : null;
      return {
        visible: getComputedStyle(el).display !== 'none',
        hasClass: document.body.classList.contains('has-joystick'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        left: host ? Math.round(r.left - host.left) : Math.round(r.left),
        bottom: host ? Math.round(host.bottom - r.bottom) : 0,
        vec: joystick.getVec(),
      };
    },
  };

  window.__api = {
    search,
    reset: resetView,
    /**
     * 停掉旋转惯性。
     * 惯性会自己一直跑 rAF，测试若不停掉就读不到确定的 theta。
     * 页面内的手势测试都应该在"读取结果前"先调一次。
     */
    haltInertia,
    locateById: (id) => {
      const it = state.byId.get(id);
      if (it) locate(it);
      return !!it;
    },
    // ---- 地图相关（供自动化测试与调试） ----
    enterMap: () => { const r = enterMap(); setMapUi(isMapMode()); return r; },
    exitMap: () => { const r = exitMap(); setMapUi(isMapMode()); return r; },
    toggleMap: () => { const r = toggleMap(); setMapUi(isMapMode()); return r; },
    screenToGround: (x, y) => screenToGround(x, y, document.getElementById('canvas-host')),
    toggleSelInfo,
    // ---- 结果面板抽屉（供自动化测试直接切档，不用模拟拖拽） ----
    setDrawer: (level) => { setDrawerLevel(level); return getDrawerLevel(); },
    getDrawer: getDrawerLevel,
    revealResults,
    // ---- 左下虚拟摇杆（供自动化测试直接推摇杆，不用模拟一整套指针坐标） ----
    setJoystick: (x, y) => { joystick.setVec(x, y); return joystick.getVec(); },
    getJoystick: () => joystick.getVec(),
    resetJoystick: () => { joystick.reset(); return joystick.getVec(); },
    toggleLabels: () => document.getElementById('btn-labels')?.click(),
    toggleView: () => document.getElementById('btn-view')?.click(),
    toggleMinimap: () => document.getElementById('btn-minimap')?.click(),
    minimapActive: isMinimapActive,
    /** 手动切加载态（供自动化测试直接验证三态，不用真去卡网络） */
    setLoading,
    setLoadError,
    clearLoadError,
    getState: () => {
      const hi = window.__diag.highlight();
      return {
        ready: true,
        highlightBoxId: state.highlightBoxId,
        nohit: state.nohit,
        topView: state.topView,
        mapMode: isMapMode(),
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
