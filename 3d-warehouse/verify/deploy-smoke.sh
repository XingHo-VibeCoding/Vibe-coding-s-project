#!/usr/bin/env bash
# ============================================================================
# 发布副本冒烟测试
#   起本地静态服务 -> 对 _deploy_3d/（**发布出去的那一份**）跑完整手机端验收
#   -> 关服务 -> 清理临时文件
#
# 为什么要在发布前跑这一遍：
#   验收脚本平时跑的是 3d-warehouse/ 源码目录；而真正上线的是 _deploy_3d/ 这个
#   派生副本。两者靠一次 cp 同步 —— 漏拷一个文件、或改完源码忘了同步，源码目录
#   全绿、线上却是坏的。所以**发之前必须对副本本身再跑一遍**。
#
# 前置条件：
#   1. 已重建 _deploy_3d/（见 RUN.md 第 9 节）
#   2. 已安装 playwright 与 chromium（见 web-verify-screenshot skill 的环境准备）
#
# 用法（在 3d-warehouse/ 下执行）：
#   bash verify/deploy-smoke.sh
#
#   解释器默认取 PATH 里的 python3 / node；需要指定时用环境变量覆盖：
#   PY=/path/to/python NODE=/path/to/node bash verify/deploy-smoke.sh
#
# 它不会自己发布。跑绿了再让 AI 发布，是两步分开的动作。
# ============================================================================
set -u

# ---- 路径全部从脚本自身位置推导，不写死绝对路径 ----
# （写死会导致：换台机器/换个人就跑不起来，还会把本机用户名带进公开仓库）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"          # <root>/3d-warehouse
ROOT="$(cd "$SRC_DIR/.." && pwd)"                # <root>
DEPLOY_DIR="$ROOT/_deploy_3d"

PY="${PY:-python3}"
command -v "$PY" >/dev/null 2>&1 || PY=python
NODE="${NODE:-node}"
PORT="${PORT:-8020}"

# 临时产物统一加 _smoke 前缀，跑完即删（.gitignore 里也忽略了）
TMP_NAME="_smoke_mobile.mjs"
TMP_SCRIPT="$SRC_DIR/$TMP_NAME"
TMP_SHOTS="$SRC_DIR/_smoke_shots"
TMP_LOG="$SRC_DIR/_smoke.log"

cleanup() {
  [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
  rm -f "$TMP_SCRIPT" "$TMP_LOG"
  rm -rf "$TMP_SHOTS"
}
trap cleanup EXIT

# ---- 0. 前置检查：副本得存在，且必须是纯静态版 ----
if [ ! -f "$DEPLOY_DIR/index.html" ]; then
  echo "找不到 $DEPLOY_DIR/index.html —— 先重建发布副本（见 RUN.md 第 9 节）"
  exit 1
fi
if ! grep -q "DATA_SOURCE = 'demo'" "$DEPLOY_DIR/src/config.js"; then
  echo "副本的 DATA_SOURCE 不是 'demo' —— 静态发布版没有后端，必须用 demo"
  exit 1
fi
if [ -e "$DEPLOY_DIR/backend" ] || [ -e "$DEPLOY_DIR/verify" ]; then
  echo "副本里混进了 backend/ 或 verify/ —— 这些不该公开"
  exit 1
fi

# ---- 1. 从**权威**验收脚本派生一份指向 $PORT 的临时副本 ----
# 每次现派生，而不是把派生结果存成文件：
# 否则验收脚本加了新断言，冒烟测试还停在旧版本，等于白跑（静默失效最危险）。
sed -e "s|127.0.0.1:8010|127.0.0.1:$PORT|" \
    -e "s|verify/shots/|_smoke_shots/|g" \
    "$SRC_DIR/verify/verify-mobile-ux.mjs" > "$TMP_SCRIPT"
mkdir -p "$TMP_SHOTS"

# ---- 2. 起服务 ----
# ⚠️ 起服务与跑测试必须落在**同一条命令**里。沙箱会回收上一条命令留下的后台进程，
#    分两次调用的话，第二次 curl 会拿到 000（连接被拒）。
#
# ⚠️ 这里用「子壳里 cd 进副本目录」而不是 `--directory "$DEPLOY_DIR"`，是踩过的坑：
#    Git Bash 推导出来的路径是 MSYS 形式（/d/Vibe coding.../），Windows 版 Python
#    不认这种路径，`--directory` 会静默失效 -> 服务起得来但一律 404。
#    （早先为绕开它写死了 Windows 形式的绝对路径，结果是脚本换台机器就跑不了、
#      还把本机用户名带进了公开仓库 —— 两害相权，还是子壳 cd 干净。）
#    子壳只影响后台服务进程，主壳的 cwd 仍是 $SRC_DIR，截图仍落在 3d-warehouse/ 下。
cd "$SRC_DIR" || exit 1
( cd "$DEPLOY_DIR" && exec "$PY" -m http.server "$PORT" --bind 127.0.0.1 ) >/dev/null 2>&1 &
SRV=$!
sleep 3

# curl 本地要加 --noproxy '*'，否则被 http_proxy 环境变量拦掉
CODE=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")
echo "本地服务 http://127.0.0.1:$PORT/ -> $CODE"
if [ "$CODE" != "200" ]; then
  echo "服务没起来，中止"
  exit 1
fi

# ---- 3. 跑完整验收 ----
# ⚠️ 这里传**裸文件名**、不传绝对路径，同样是上面那个 MSYS 路径坑的另一面：
#    Git Bash 给的 /d/... 形式 Windows 版 Node 认不出，会报 MODULE_NOT_FOUND。
#    此时 cwd 已是 $SRC_DIR，裸文件名正好能被解析到；
#    Node 也就能顺着 cwd 找到 node_modules/playwright。
"$NODE" "$TMP_NAME"
RC=$?

echo ""
if [ "$RC" -eq 0 ]; then
  echo "✅ 发布副本冒烟测试通过，可以发布了"
else
  echo "❌ 发布副本冒烟测试失败 —— 别发，先修"
fi
exit $RC
