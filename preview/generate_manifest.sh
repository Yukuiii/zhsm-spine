#!/usr/bin/env bash
# 扫描 extracted/ 生成 manifest.json
# 路径相对于 zhsmxb 根（HTTP server 根目录）
set -u

ROOT="/d/game_assets/zhsmxb"
cd "$ROOT" || exit 1

OUT="$ROOT/preview/manifest.json"

count=0
{
  echo '{"items":['
  first=1
  while IFS= read -r atlas; do
    dir=${atlas%/*}
    dir=${dir#./}
    base=$(basename "$atlas" .atlas)

    # 找对应的 .skel 或 .json
    if [[ -f "$dir/$base.skel" ]]; then
      ext="skel"
    elif [[ -f "$dir/$base.json" ]]; then
      ext="json"
    else
      continue
    fi

    [[ -f "$dir/$base.png" ]] || continue

    # category = extracted/<这一层>
    category=${dir#extracted/}
    category=${category%%/*}
    name=$(basename "$dir")
    # path 相对于 server root，去掉前导 extracted/
    relpath=${dir#extracted/}

    [[ $first -eq 1 ]] && first=0 || echo ","
    printf '  {"cat":"%s","path":"%s","name":"%s","base":"%s","ext":"%s"}' \
      "$category" "$relpath" "$name" "$base" "$ext"
    count=$((count+1))
  done < <(find extracted -name '*.atlas' -type f | sort)
  echo ''
  echo ']}'
} > "$OUT"

# 用 awk 数一下条目
n=$(grep -c '"cat":' "$OUT")
echo "生成 $OUT，共 $n 个条目"
