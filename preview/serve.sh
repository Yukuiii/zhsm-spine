#!/usr/bin/env bash
# 启动本地 HTTP server 浏览 Spine 资源画廊
# 访问 http://localhost:8000/preview/

ROOT="/d/game_assets/zhsmxb"
PORT="${PORT:-8000}"

cd "$ROOT" || exit 1

# 优先重新生成 manifest（确保是最新的）
if [[ -x "$ROOT/preview/generate_manifest.sh" ]]; then
    bash "$ROOT/preview/generate_manifest.sh"
fi

echo ""
echo "🎬 Spine 资源画廊"
echo ""
echo "  本地访问: http://localhost:$PORT/preview/"
echo "  停止服务: Ctrl+C"
echo ""

# 优先用 python（已安装最常见），降级 PowerShell（Windows 自带）
if command -v python > /dev/null 2>&1; then
    python -m http.server "$PORT"
elif command -v python3 > /dev/null 2>&1; then
    python3 -m http.server "$PORT"
elif command -v py > /dev/null 2>&1; then
    py -m http.server "$PORT"
else
    echo "未找到 Python，请安装 Python（或自行用其他静态文件服务器）"
    echo "替代方案 (Node.js):  npx serve -l $PORT ."
    exit 1
fi
