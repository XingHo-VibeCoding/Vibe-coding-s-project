# -*- coding: utf-8 -*-
"""3D 可视化搜索 · 轻量后端（Day 7 / 方案乙）。

作用
----
把"物资数据"从一个 HTTP 接口发给前端，替代前端直接读本地 JSON。
这样前端就不需要知道数据到底存在哪里（腾讯文档 / 数据库 / 文件）。

为什么要有这一层（对齐 TECH_DESIGN.md 方案 X）
----------------------------------------------
1. 凭据不进浏览器：访问腾讯文档的密钥只留在服务端。
2. 业务规则前移：字段翻译、层级推导、脏数据处理都在这层完成，前端只管显示。
3. 前端可替换：以后换数据源，前端一行都不用改。

两种运行模式
------------
- seed 模式（默认，无需任何凭据）：读取 data/seed.json 快照，供开发与演示。
- tencent 模式（需要环境变量）：通过 tdoc_bridge 拉腾讯文档智能表真实数据。

两种模式对外提供的接口完全一致，前端感知不到差异 —— 这就是"适配层"的价值。

启动
----
    python backend/server.py                  # seed 模式，端口 8011
    TDOC_FILE_ID=xxx WORKBUDDY_TDOC_PLUGIN=yyy python backend/server.py --source tencent

接口
----
    GET /api/health    健康检查（含当前数据源、条数）
    GET /api/items     全部物资（标准结构，前端直接消费）
"""

import argparse
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # 3d-warehouse/
SEED_FILE = os.path.join(ROOT, "data", "seed.json")
DEMO_FILE = os.path.join(ROOT, "data", "demo-data.json")
PORT = 8011

# 当前数据源：'seed' | 'tencent'
SOURCE = "seed"


# ============================================================================
# 数据源一：seed 快照（无凭据，随时可跑）
# ============================================================================
def load_seed():
    """读取本地快照。没有 seed.json 时退回 demo-data.json，保证开箱可用。"""
    path = SEED_FILE if os.path.exists(SEED_FILE) else DEMO_FILE
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    items = data.get("items", [])
    src = os.path.basename(path)
    return items, "快照（%s）" % src


# ============================================================================
# 数据源二：腾讯文档（真实数据，需要凭据）
# ============================================================================
def load_tencent():
    """从腾讯文档智能表拉取并翻译成前端要的标准结构。

    这里用的是"就地翻译"而不是直接复制 adapter.js 的逻辑，
    因为 Python 与 JS 无法共享代码；两边都用同一套字段约定（见下方 FIELD_MAP）。
    """
    sys.path.insert(0, HERE)
    from tdoc_bridge import call_tool, FILE_ID   # noqa: E402

    def api(name, args):
        res, err = call_tool(name, args)
        if err:
            raise RuntimeError("MCP %s 失败: %s" % (name, err))
        return json.loads(res["result"]["content"][0]["text"])

    def get_all(sheet):
        out, off = [], 0
        while True:
            r = api("smartsheet.list_records",
                    {"file_id": FILE_ID, "sheet_id": sheet, "limit": 100, "offset": off})
            page = r.get("records", [])
            out.extend(page)
            if not page or not r.get("has_more"):
                break
            off += len(page)
        return out

    def fv(rec, title):
        """从记录里取某个字段的值（兼容文本/数字/选项等多种类型）。"""
        for it in rec.get("field_values", []):
            if it.get("field") != title:
                continue
            if "number_value" in it:
                return it["number_value"]
            if "text_value" in it:
                its = it["text_value"].get("items", [])
                return its[0]["text"] if its else None
            if "option_value" in it:
                its = it["option_value"].get("items", [])
                return its[0]["text"] if its else None
            if "string_value" in it:
                return it["string_value"]
        return None

    sheet_mat = os.environ.get("TDOC_SHEET_MAT", "")
    if not sheet_mat:
        raise RuntimeError("tencent 模式需要设置环境变量 TDOC_SHEET_MAT（物资档案表 sheet_id）")

    raw = get_all(sheet_mat)
    items = []
    for r in raw:
        it = normalize(fv(r, "物资编号"), fv(r, "物资名称"), fv(r, "校区"),
                       fv(r, "区域"), fv(r, "排"), fv(r, "箱子编号"))
        if it:
            items.append(it)
    return items, "腾讯文档（真实）"


# ============================================================================
# 字段翻译（唯一规则出口）
# ============================================================================
ZONE_SLOTS = {"A": {"rows": 3, "levels": 3},
              "B": {"rows": 3, "levels": 3},
              "C": {"rows": 3, "levels": 3}}
SCENE_CENTER = {"x": 0.0, "y": 1.0, "z": 5.0}


def box_id_for(zone, row, level):
    return "%s-%02d-%02d" % (zone, row, level)


def position_for(zone, row, level):
    """与前端 layout.js 保持同一套坐标公式（两端必须一致，否则箱子会错位）。"""
    zx = {"A": -22.0, "B": 0.0, "C": 22.0}
    return {
        "x": zx.get(zone, 0.0),
        "y": (level - 1) * 2.4 + 1.0,
        "z": (row - 1) * 5.0,
    }


def normalize(material_id, name, campus, zone, row_raw, box_raw):
    """把一条智能表记录翻译成标准结构；信息不足则返回 None（跳过而非报错）。

    ⚠️ 已知数据缺口：物资档案表【没有"层"字段】。
    当前从【箱子编号】(形如 A-01-02) 的第 3 段反推层号。
    若现场实际不使用该编号规则，需要补列或改用人工盘点数据 —— 见 backend/README.md。
    """
    material_id = (str(material_id).strip() if material_id else "")
    name = (str(name).strip() if name else "")
    zone = (str(zone).strip().upper() if zone else "")
    if not material_id or not name or zone not in ZONE_SLOTS:
        return None

    # 排号：优先用【排】字段，失败则从箱子编号第 2 段取
    box = (str(box_raw).strip().upper() if box_raw else "")
    parts = box.split("-") if box else []

    row = None
    try:
        row = int(str(row_raw).strip()) if row_raw not in (None, "") else None
    except (TypeError, ValueError):
        row = None
    if row is None and len(parts) >= 2:
        try:
            row = int(parts[1])
        except ValueError:
            row = None
    if not row:
        return None

    # 层号：档案无此字段，从箱子编号第 3 段反推；推不出则默认第 1 层
    level = 1
    if len(parts) >= 3:
        try:
            level = int(parts[2])
        except ValueError:
            level = 1

    limits = ZONE_SLOTS[zone]
    if not (1 <= row <= limits["rows"]) or not (1 <= level <= limits["levels"]):
        # 超出货架范围的数据是脏数据，记录后跳过，避免前端渲染到画布外
        sys.stderr.write("[skip] 越界记录 %s %s 区-%s排-%s层\n" % (material_id, zone, row, level))
        return None

    return {
        "materialId": material_id,
        "materialName": name,
        "campus": (str(campus).strip() if campus else "福州校区"),
        "zone": zone,
        "row": row,
        "level": level,
        "boxId": box_id_for(zone, row, level),
        "position": position_for(zone, row, level),
        "dataStatus": "真实",
    }


# ============================================================================
# HTTP 服务
# ============================================================================
class Handler(BaseHTTPRequestHandler):
    def _send(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path)
        try:
            if p.path == "/api/health":
                self._send({"ok": True, "source": SOURCE, "items": len(_CACHE[0])})
            elif p.path == "/api/items":
                self._send({"source": SOURCE, "label": _CACHE[1], "items": _CACHE[0]})
            else:
                self._send({"error": "unknown path", "path": p.path}, 404)
        except Exception as e:
            self._send({"error": str(e), "trace": traceback.format_exc()[:600]}, 500)

    def log_message(self, *a):
        pass


_CACHE = ([], "")


def main():
    global SOURCE, _CACHE
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["seed", "tencent"], default="seed")
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()
    SOURCE = args.source

    try:
        items, label = load_tencent() if SOURCE == "tencent" else load_seed()
    except Exception as e:
        print("[错误] 加载数据失败（%s 模式）：%s" % (SOURCE, e), file=sys.stderr)
        print("[提示] 若只想先跑起来，用默认的 seed 模式：python backend/server.py", file=sys.stderr)
        sys.exit(1)

    _CACHE = (items, label)
    print("3D 搜索后端已启动  http://127.0.0.1:%d" % args.port)
    print("  数据源: %s  条数: %d" % (label, len(items)))
    print("  接口:   GET /api/health  GET /api/items")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
