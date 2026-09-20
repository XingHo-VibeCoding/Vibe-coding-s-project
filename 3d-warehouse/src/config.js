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

/**
 * 俯仰角（phi）的可动范围。
 *
 * 为什么是 0.05 ~ 1.52（接近 0° ~ 87°）而不是 -90° ~ +90°：
 * phi 是相机与"正上方"的夹角。phi=0 时相机在正上方垂直俯视，
 * 此时 lookAt 的"上方向"退化成奇点，画面会翻转、抖动；
 * phi 到 90° 时相机落到地平线高度，会钻进地面以下看到货架背面。
 * 所以两端各留 0.05 弧度（约 3°）的余量。
 *
 * 关于"无限拖拽"：**偏航（theta）是无限的**，横向可以一直转下去、永远不到头。
 * 纵向不可能真正无限——这是球坐标相机的固有性质，转到头顶再往上就没有"更上面"了，
 * 任何 3D 软件都是到两端停住。能做的是把范围开到接近垂直、并且在两端平滑减速，
 * 让手感是"转到顶了"而不是"卡住不动"（见 camera.js 的 rotateBy）。
 */
export const PHI_MIN = 0.05;
export const PHI_MAX = Math.PI / 2 - 0.02;

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
 * 全景视角的自适应距离。
 *
 * 需要覆盖的世界范围：A 区在 x=-22、C 区在 x=+22，货架本身还占约 ±3，
 * 所以横向要看到约 **±25 个单位**（`OVERVIEW_HALF_W`）。
 *
 * 为什么不能写死距离：相机垂直 FOV 固定 50°，能看到的水平半宽
 * = 距离 × tan(25°) × aspect。手机竖屏 aspect≈0.75 时水平半宽只有
 * 距离的 0.35 倍 —— 距离 52 只能看到 ±18，A~C 里必然有一头被切掉
 * （真机截图里就是 C 区标签被右边缘切掉）。
 *
 * 所以这里**反算**：距离 = 需要的半宽 ÷ (tan(一半FOV) × aspect)，
 * 再对宽屏取基准值兜底（宽屏本来就看得很全，没必要因为反算而推远）。
 * 反算的好处是任何屏幕比例都自动正确，不用维护一张分档表。
 */
export const CAMERA_FOV_DEG = 50;          // 与 scene.js 里透视相机的 fov 保持一致
export const OVERVIEW_HALF_W = 27;         // 全景要看到的横向半宽（世界单位，含一点余量）

export function defaultRadiusFor(aspect) {
  const a = aspect && aspect > 0 ? aspect : 1.6;
  const halfFovRad = (CAMERA_FOV_DEG / 2) * (Math.PI / 180);
  // 距离 = 目标半宽 / (tan(半FOV) × aspect)
  const need = OVERVIEW_HALF_W / (Math.tan(halfFovRad) * a);
  // 向上取整 + 不低于基准：宽屏时反算值可能小于 52，那就用 52，别把画面推近
  return Math.max(DEFAULT_VIEW.radius, Math.ceil(need));
}

/**
 * 惯性轻扫（flick）参数 —— 抬手后让镜头继续转一会儿。
 *
 * 为什么需要：没有惯性时，想转 180° 得把手指在屏幕上倒腾两三回，
 * 这是真机反馈"大角度要划好多下"的来源之一。加了惯性，
 * 快速一扫就能转过一个大角度，符合手机上"拨一下转盘"的直觉。
 *
 * FLICK_MS     判定"这一下算不算轻扫"的回看时间窗。
 *              超过这个时长还在慢慢挪 → 不算轻扫，不触发惯性。
 * FLICK_MIN_PX 窗口内至少要移动这么多像素才算轻扫（防手抖误触）。
 *              设成 12 而不是更大：手机上"轻轻一拨"的位移本来就不大，
 *              门槛太高会让大部分轻扫都不生效。
 */
export const FLICK_MS = 110;
export const FLICK_MIN_PX = 12;
