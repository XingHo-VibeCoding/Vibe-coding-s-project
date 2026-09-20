// ============================================================================
// config.js —— 全局配置常量（无依赖，最底层模块）
// ----------------------------------------------------------------------------
// 职责：集中放置所有"可调参数"。
// 这样做的意义：想调颜色、改视角、切数据源，只改这一个文件，不用翻其他代码。
// ============================================================================

import * as THREE from 'three';
import { SCENE_CENTER } from './layout.js';

/**
 * 数据源开关：
 *   'demo'    = 前端直接读本地 data/demo-data.json（离线可用，默认）
 *   'api'     = 经后端 API 取数（方案 X，推荐；见 backend/server.py）
 *   'tencent' = 前端直连腾讯文档（已否决，调用即抛错，仅留作说明）
 */
export const DATA_SOURCE = 'demo';

/** 场景配色 */
export const COLORS = {
  bg: 0xeceff3,
  ground: 0xdfe5ec,
  grid: 0xc4ccd6,
  boxByZone: { A: 0x4a90c2, B: 0x57a99f, C: 0xc2a14a },
  boxEmpty: 0xaab4c0,
  highlight: 0xe8543b,
  post: 0x9aa6b2,
  zoneFloor: 0xd2d9e2,
  marker: 0xe8543b,
};

/** 箱位立方体边长（世界坐标单位） */
export const BOX_SIZE = 1.8;

/** 场景中心点（默认相机与视角目标的参考点） */
export const VIEW_CENTER = new THREE.Vector3(SCENE_CENTER.x, SCENE_CENTER.y, SCENE_CENTER.z);

/** 默认视角参数（球坐标：半径 / 俯仰角 / 偏航角） */
export const DEFAULT_VIEW = { radius: 52, phi: 0.95, theta: 0.62, target: VIEW_CENTER.clone() };

/** 相机动画默认时长（毫秒） */
export const FLY_DURATION = 850;

/** 缩放半径的安全区间（防止穿模或过远） */
export const RADIUS_MIN = 6;
export const RADIUS_MAX = 120;

/** 全屏地图的缩放区间（比 3D 模式更需要"看得全"） */
export const MAP_ZOOM_MIN = 0.4;
export const MAP_ZOOM_MAX = 6;

/** 进入全屏地图时的默认缩放（越小看得越全） */
export const MAP_ENTER_ZOOM = 0.62;

/**
 * 旋转灵敏度（每像素位移对应的弧度）。
 * 为什么分设备：手机屏幕窄，一次滑动撑死 200px 左右，
 * 用鼠标的系数会显得"划好多下才转一点"；触摸屏给更大的系数才跟手。
 */
export const ROTATE_SENSITIVITY = {
  mouse: 0.005,
  touch: 0.011,
};

/**
 * 全景视角的自适应半径。
 *
 * 为什么需要：手机竖屏的水平可视角度远小于宽屏。以 50° 垂直 FOV 算，
 * 竖屏（aspect≈0.5）时水平 FOV 只有约 23°，固定 52 的距离装不下
 * A~C 三个区域（X 方向跨度 44 单位），C 区会被切出画面。
 *
 * 为什么用分档而不是连续插值：连续插值会对 1.27 这种"其实够宽"的比例
 * 也做放大，桌面端会被无谓地推远。分档保证只有真正窄的画面才拉远。
 */
export function defaultRadiusFor(aspect) {
  const a = aspect && aspect > 0 ? aspect : 1.6;
  if (a < 0.75) return 66;   // 手机竖屏：必须拉到能装下 A~C
  if (a < 0.95) return 60;   // 窄竖屏 / 平板竖屏
  return DEFAULT_VIEW.radius; // 其余（含接近方形的桌面窗口）：保持基准 52
}

/** 手机长按判定为"平移模式"的时长（毫秒） */
export const LONG_PRESS_MS = 350;
