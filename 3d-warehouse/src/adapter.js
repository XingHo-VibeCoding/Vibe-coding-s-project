// ============================================================================
// adapter.js —— 数据适配层（把外部数据翻译成前端标准结构）
// ----------------------------------------------------------------------------
// 这是"翻译官"：不管数据来自腾讯文档、后端 API 还是别的什么，
// 都先在这里翻成同一套标准结构，main.js 只认标准结构。
//
// 两种数据源：
//   1. loadFromApi()          —— 经后端取数（方案 X，推荐；凭据不进浏览器）
//   2. loadFromTencentDocs()  —— 前端直连（已否决，仅保留说明，调用即抛错）
//
// 标准记录结构（与 data/demo-data.json 对齐）：
//   { materialId, materialName, campus, zone, row, level,
//     boxId, position:{x,y,z}, dataStatus }
// ============================================================================

import { positionFor, boxIdFor } from './layout.js';

/** 后端地址。可用 window.__API_BASE 覆盖（部署到别的机器时有用）。 */
const API_BASE = (typeof window !== 'undefined' && window.__API_BASE) || 'http://127.0.0.1:8011';

/**
 * 把一条原始记录翻译成标准结构。
 * 同时兼容「英文键」和「中文键」两种来源 —— 后端现在给英文键，
 * 但早期演示数据和人工整理的数据可能是中文键。
 */
export function normalizeRecord(raw) {
  const zone = String(raw.zone ?? raw.区域 ?? '').trim().toUpperCase();
  const row = Number(raw.row ?? raw.排 ?? 0);
  const level = Number(raw.level ?? raw.层 ?? 1);
  const pos = positionFor(zone, row, level);

  return {
    materialId: String(raw.materialId ?? raw.物资编号 ?? '').trim(),
    materialName: String(raw.materialName ?? raw.物资名称 ?? '').trim(),
    campus: String(raw.campus ?? raw.校区 ?? '福州校区').trim(),
    zone,
    row,
    level,
    boxId: String(raw.boxId ?? raw.箱子编号 ?? boxIdFor(zone, row, level)).trim(),
    position: pos,
    // 后端已标好"真实"，这里兜底为"演示数据"
    dataStatus: String(raw.dataStatus ?? '演示数据').trim(),
  };
}

/**
 * 从后端 API 取物资列表（方案 X）。
 * 失败时抛出明确错误，由 main.js 决定是否退回演示数据。
 * @returns {Promise<object[]>} 标准结构数组
 */
export async function loadFromApi() {
  const res = await fetch(`${API_BASE}/api/items`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`[adapter] 后端返回 ${res.status}，请确认 backend/server.py 是否已启动`);
  }
  const json = await res.json();
  const raw = json.items ?? [];
  return raw.map(normalizeRecord).filter((it) => it.materialId && it.zone);
}

/** 查询后端健康状态（用于界面显示数据来源） */
export async function apiHealth() {
  const res = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

/**
 * 前端直连腾讯文档 —— **已否决，不实现**。
 *
 * 为什么不实现：直连需要把文档访问凭据放进浏览器，而本仓库是公开仓库，
 * 凭据会随代码泄露；且字段翻译、脏数据处理等业务规则会前移到前端。
 * 正确做法是走 loadFromApi()，让后端持有凭据。详见 TECH_DESIGN.md 第 3 节。
 */
export async function loadFromTencentDocs() {
  throw new Error(
    '[adapter] 前端直连腾讯文档的方案已否决（凭据会进浏览器 + 违反公开仓库红线）。' +
    '请改用 DATA_SOURCE="api"，由 backend/server.py 持有凭据并转发数据。'
  );
}
