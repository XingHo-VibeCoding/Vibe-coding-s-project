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
# 用法（在 3d-warehouse/ 下执行）：
#   bash verify/deploy-smoke.sh
#
# 它不会自己发布。跑绿了再让 AI 发布，是两步分开的动作。
# ============================================================================
set -u

ROOT="D:/Vibe coding打卡/workbuddy工作区"
SRC_DIR="$ROOT/3d-warehouse"
DEPLOY_DIR="$ROOT/_deploy_3d"
PY="C:/Users/12478/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
NODE="C:/Users/12478/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe"
PORT=8020

# 临时产物统一加 _smoke 前缀，跑完即删（.gitignore 里也忽略了）
TMP_SCRIPT="$SRC_DIR/_smoke_mobile.mjs"
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

# ---- 1. 从**权威**验收脚本派生一份指向 8020 的临时副本 ----
# 每次现派生，而不是把派生结果存成文件：
# 否则验收脚本加了新断言，冒烟测试还停在旧版本，等于白跑（静默失效最危险）。
sed -e "s|127.0.0.1:8010|127.0.0.1:$PORT|" \
    -e "s|verify/shots/|_smoke_shots/|g" \
    "$SRC_DIR/verify/verify-mobile-ux.mjs" > "$TMP_SCRIPT"
mkdir -p "$TMP_SHOTS"

# ---- 2. 起服务 ----
# ⚠️ 起服务与跑测试必须落在**同一条命令**里。沙箱会回收上一条命令留下的后台进程，
#    分两次调用的话，第二次 curl 会拿到 000（连接被拒）。
cd "$SRC_DIR" || exit 1
"$PY" -m http.server "$PORT" --directory "$DEPLOY_DIR" --bind 127.0.0.1 >/dev/null 2>&1 &
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
"$NODE" "$TMP_SCRIPT"
RC=$?

echo ""
if [ "$RC" -eq 0 ]; then
  echo "✅ 发布副本冒烟测试通过，可以发布了"
else
  echo "❌ 发布副本冒烟测试失败 —— 别发，先修"
fi
exit $RC
