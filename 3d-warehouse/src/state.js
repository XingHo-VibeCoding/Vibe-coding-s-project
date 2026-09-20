// ============================================================================
// state.js —— 共享运行时状态（无依赖，最底层模块）
// ----------------------------------------------------------------------------
// 职责：集中放置所有"会变化的数据"。
// 设计说明：用可变对象（而非到处散落的 let 变量）+ getter 访问，
//          这样任何模块都能安全读取，且不需要在各文件之间反复传递引用。
// ============================================================================

import { DEFAULT_VIEW } from './config.js';

/** 场景与数据状态 */
export const state = {
  /** 全部物资记录（标准结构数组） */
  items: [],
  /** materialId -> 记录，用于快速查找 */
  byId: new Map(),
  /** boxId -> mesh（已占用箱位的网格） */
  meshes: new Map(),
  /** 全部箱位网格（含空箱位） */
  slotMeshes: [],
  /** 区域标签组 */
  labelGroup: null,
  /** 目标箱位的标记物 */
  marker: null,
  /** 当前高亮的箱位 ID，null 表示无高亮 */
  highlightBoxId: null,
  /** 是否处于 2D 俯视模式（全屏地图） */
  topView: false,
  /** 进入地图前的 3D 视角快照，用于"返回 3D 视角"时还原 */
  saved3dView: null,
  /** 区域标签是否可见 */
  labelsVisible: true,
  /** 上次搜索是否无结果 */
  nohit: false,
  /**
   * 是否正在加载数据。
   *
   * 三种界面状态里最容易漏掉的一个 —— 因为 demo 模式读的是本地 JSON，
   * 快到"好像根本不需要加载态"，于是很自然就不写了。
   * 但两种情况下它会真的露出来：
   *   1) 换成后端（DATA_SOURCE='api'）后，网络慢的时候会有肉眼可见的等待
   *   2) 页面在手机上首次打开，光解析 three.js（约 1.2MB）就要一会儿，
   *      这时右侧面板会先渲染出"输入…开始定位"的提示语 —— 而那其实是**空态**，
   *      会给用户"页面已经就绪、数据已经在了"的错觉，然后 3D 场景迟迟不出来。
   * 所以加载态不是给 demo 用的，是给"将来一定会变慢"用的。
   */
  loading: false,
  /** 数据加载失败时的错误信息，null 表示没出错 */
  loadError: null,
};

/** 3D 透视视角（球坐标） */
export const view = {
  radius: DEFAULT_VIEW.radius,
  phi: DEFAULT_VIEW.phi,
  theta: DEFAULT_VIEW.theta,
  target: DEFAULT_VIEW.target.clone(),
};

/** 2D 俯视视角（精简版未使用切换入口，保留结构以防恢复） */
export const view2d = { zoom: 1, target: DEFAULT_VIEW.target.clone() };
