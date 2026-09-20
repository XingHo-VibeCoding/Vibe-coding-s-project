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
  /** 是否处于 2D 俯视模式（精简版已移除切换入口，保留状态位以防恢复） */
  topView: false,
  /** 区域标签是否可见 */
  labelsVisible: true,
  /** 上次搜索是否无结果 */
  nohit: false,
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
