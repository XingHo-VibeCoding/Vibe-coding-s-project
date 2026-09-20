// 仓库空间布局：单一数据源，场景渲染与演示数据生成共用，避免坐标不一致。
// 坐标系：X = 区域(Zone)方向，Z = 排(Row)方向，Y = 层(Level)方向（向上）。

export const ZONES = ['A', 'B', 'C'];

// 每个区域的排/层范围（用于生成货架骨架与空箱位）
export const ZONE_SLOTS = {
  A: { rows: 3, levels: 3 },
  B: { rows: 3, levels: 3 },
  C: { rows: 3, levels: 3 },
};

// 枚举所有箱位槽（用于渲染空位与统计）
export function allSlots() {
  const slots = [];
  for (const zone of ZONES) {
    const { rows, levels } = ZONE_SLOTS[zone];
    for (let r = 1; r <= rows; r++) {
      for (let l = 1; l <= levels; l++) {
        slots.push({ zone, row: r, level: l, boxId: boxIdFor(zone, r, l) });
      }
    }
  }
  return slots;
}

// 每个区域在 X 轴上的起点（区域之间留出通道）
const ZONE_X0 = { A: -22, B: 0, C: 22 };
const ROW_SPACING = 5;   // 排间距（沿 Z）
const LEVEL_SPACING = 2.4; // 层间距（沿 Y）
const BOX_SIZE = 1.8;     // 箱位立方体边长
const FLOOR_Y = 0;        // 地面

// 区域相对起点（该区域内排/层相对偏移）
export function zoneOriginX(zone) {
  return ZONE_X0[zone] ?? 0;
}

export function rowZ(row) {
  return (row - 1) * ROW_SPACING;
}

export function levelY(level) {
  return FLOOR_Y + 1.0 + (level - 1) * LEVEL_SPACING;
}

// 计算箱位世界坐标（箱位中心）
export function positionFor(zone, row, level) {
  return {
    x: zoneOriginX(zone) + 0, // 区域整体沿 X 偏移，箱位在区域内居中（row 用 Z 表达）
    y: levelY(level),
    z: rowZ(row),
  };
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// 箱位编号：区域-排(2位)-层(2位)，例如 A-01-02
export function boxIdFor(zone, row, level) {
  return `${zone}-${pad2(row)}-${pad2(level)}`;
}

export function zoneLabel(zone) {
  return `${zone}区`;
}

// 面包屑路径文本：福州校区 > A区 > 第2排 > 第3层 > 箱A-02-03
export function breadcrumbFor(item) {
  return [
    item.campus,
    zoneLabel(item.zone),
    `第${item.row}排`,
    `第${item.level}层`,
    `箱${boxIdFor(item.zone, item.row, item.level)}`,
  ].join(' > ');
}

// 场景中心（用于默认相机与目标）
export const SCENE_CENTER = { x: 0, y: 3, z: 5 };
