#!/usr/bin/env bash
# 批量解包 Spine 资源
# - 找到 spine_main 下所有含 *.atlas 的目录（894 个 spine 资源单元）
# - 用 AssetStudioModCLI 提取每个目录的 TextAsset (.skel/.atlas) + Texture2D (.png)
# - 输出到 extracted/，保持原目录层级
# - 已完成的目录会跳过（断点续传）
# - 失败目录记录到 extract.failed.txt

set -u
# 不要禁用 MSYS_NO_PATHCONV：脚本内全是本地路径，需要交给 .NET CLI 时手动 cygpath -w

# === 配置 ===
ROOT="/d/game_assets/zhsmxb"
CLI="$ROOT/tools/AssetStudioModCLI_net472_win32_64/AssetStudioModCLI.exe"
SRC="$ROOT/spine_main"
DST="$ROOT/extracted"
LOG="$ROOT/extract.log"
FAILED="$ROOT/extract.failed.txt"

# === 颜色 ===
C_RESET=$'\e[0m'
C_GREEN=$'\e[32m'
C_RED=$'\e[31m'
C_YELLOW=$'\e[33m'
C_DIM=$'\e[2m'

# === 检查环境 ===
[[ -f "$CLI" ]] || { echo "${C_RED}找不到 CLI: $CLI${C_RESET}"; exit 1; }
[[ -d "$SRC" ]] || { echo "${C_RED}找不到源目录: $SRC${C_RESET}"; exit 1; }
mkdir -p "$DST"
> "$LOG"
> "$FAILED"

# === 收集所有需要解包的目录 ===
echo "扫描 Spine 资源目录..."
mapfile -t DIRS < <(find "$SRC" -name '*.atlas' -type f 2>/dev/null \
                     | xargs -I{} dirname {} 2>/dev/null \
                     | sort -u)

# 可选：用 LIMIT=N 只处理前 N 个（测试用），FILTER=正则 只处理匹配的
if [[ -n "${FILTER:-}" ]]; then
    mapfile -t DIRS < <(printf '%s\n' "${DIRS[@]}" | grep -E "$FILTER")
fi
if [[ -n "${LIMIT:-}" ]]; then
    DIRS=("${DIRS[@]:0:$LIMIT}")
fi

TOTAL=${#DIRS[@]}
SUCCESS=0
FAIL=0
SKIP=0

echo "${C_GREEN}找到 $TOTAL 个 Spine 资源单元${C_RESET}"
echo "源:   $SRC"
echo "目标: $DST"
echo "日志: $LOG"
echo ""

START=$(date +%s)

for i in "${!DIRS[@]}"; do
    dir="${DIRS[$i]}"
    rel="${dir#$SRC/}"
    out="$DST/$rel"
    n=$((i+1))

    # 断点续传：输出目录已有 .atlas 或 .skel 或 .png 就跳过
    if [[ -d "$out" ]] && \
       compgen -G "$out/*.atlas" > /dev/null 2>&1 || \
       compgen -G "$out/*.skel" > /dev/null 2>&1 || \
       compgen -G "$out/*.png" > /dev/null 2>&1; then
        if [[ -d "$out" ]] && \
           { compgen -G "$out/*.atlas" > /dev/null 2>&1 || \
             compgen -G "$out/*.skel" > /dev/null 2>&1; }; then
            SKIP=$((SKIP+1))
            printf "\r${C_DIM}[%4d/%d] SKIP %-60s${C_RESET}" "$n" "$TOTAL" "${rel:0:60}"
            continue
        fi
    fi

    printf "\r${C_DIM}[%4d/%d]${C_RESET} %-60s" "$n" "$TOTAL" "${rel:0:60}"

    mkdir -p "$out"

    # 转 Windows 路径给 .NET CLI（避免 /d/... 被解释成 D:\d\...）
    dir_w=$(cygpath -w "$dir")
    out_w=$(cygpath -w "$out")

    {
        echo "===== [$n/$TOTAL] $rel ====="
        "$CLI" "$dir_w" \
            -t textAsset,tex2d \
            -g none \
            -o "$out_w" \
            -r \
            --image-format png \
            --log-level warning \
            --log-output console
        echo "exit=$?"
    } >> "$LOG" 2>&1

    # 验证输出（必须至少有 .atlas 或 .skel）
    if compgen -G "$out/*.atlas" > /dev/null 2>&1 || compgen -G "$out/*.skel" > /dev/null 2>&1; then
        SUCCESS=$((SUCCESS+1))
    else
        FAIL=$((FAIL+1))
        echo "$rel" >> "$FAILED"
    fi
done

END=$(date +%s)
ELAPSED=$((END-START))

echo ""
echo ""
echo "${C_GREEN}=== 完成 ===${C_RESET}"
printf "  总计:   %d\n" "$TOTAL"
printf "  ${C_GREEN}成功:   %d${C_RESET}\n" "$SUCCESS"
printf "  ${C_DIM}跳过:   %d (已有结果)${C_RESET}\n" "$SKIP"
printf "  ${C_RED}失败:   %d${C_RESET}\n" "$FAIL"
printf "  耗时:   %dm%ds\n" $((ELAPSED/60)) $((ELAPSED%60))

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "${C_YELLOW}失败的目录列表保存在: $FAILED${C_RESET}"
    echo "${C_YELLOW}详细错误见: $LOG${C_RESET}"
    echo "（重新运行脚本会自动跳过已成功的，只重试失败的）"
fi

# 简要统计输出
if [[ $SUCCESS -gt 0 ]]; then
    echo ""
    echo "=== 输出统计 ==="
    SKEL=$(find "$DST" -name '*.skel' 2>/dev/null | wc -l)
    ATLAS=$(find "$DST" -name '*.atlas' 2>/dev/null | wc -l)
    PNG=$(find "$DST" -name '*.png' 2>/dev/null | wc -l)
    SIZE=$(du -sh "$DST" 2>/dev/null | cut -f1)
    printf "  .skel:  %d\n" "$SKEL"
    printf "  .atlas: %d\n" "$ATLAS"
    printf "  .png:   %d\n" "$PNG"
    printf "  总大小: %s\n" "$SIZE"
fi
