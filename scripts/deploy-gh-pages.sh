#!/usr/bin/env bash
# ============================================================
# 部署战斗模拟器 → GitHub Pages
# 用法: bash scripts/deploy-gh-pages.sh
# 产物: https://ybytlai78-dev.github.io/stzb-battle-sim/
# 注意: vite base 必须带仓库名前缀，否则 GitHub Pages 下资源 404
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER="ybytlai78-dev"
REPO="stzb-battle-sim"
BASE="/stzb-battle-sim"
# 仓库外临时 worktree，避免污染源码目录。
# git-bash 坑：git 不认 /c/ MSYS 路径（会拼成 C:/c/...），git 侧必须传 Windows 原生路径
WORK_POSIX="$(dirname "$PWD")/.gh-pages-work"
WORK_GIT="$(cygpath -w "$WORK_POSIX")"

echo "==> 1/3 构建（base=${BASE}）"
# ⚠️ git-bash 坑 2（2026-09-19 线上事故）：MSYS 会把以斜杠开头的参数当 POSIX 路径转换成 Windows 路径，
#    实测 `--base=/stzb-battle-sim/` 被改写成 `C:/Program Files/Git/stzb-battle-sim/`
#    → dist/index.html 里资源变成 `/Program Files/Git/stzb-battle-sim/assets/...`，线上全站 404。
#    MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL 关掉参数转换（不同 MSYS 版本认的变量不同，两个都设）。
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' npx vite build --base="${BASE}/"

# 产物自检：base 不对就拒绝部署，别把坏包推上线
if ! grep -q "src=\"${BASE}/assets/" dist/index.html; then
  echo "✗ 构建产物自检失败：dist/index.html 未引用 ${BASE}/assets/，拒绝部署" >&2
  grep -o 'src="[^"]*"' dist/index.html >&2 || true
  exit 1
fi
echo "    ✓ 产物自检通过：$(grep -o 'src="[^"]*"' dist/index.html | head -1)"

echo "==> 2/3 生成 gh-pages 分支内容"
git worktree remove "$WORK_GIT" --force 2>/dev/null || true
rm -rf "$WORK_POSIX"
git worktree add "$WORK_GIT" --detach || git worktree add "$WORK_GIT" -b gh-pages
pushd "$WORK_POSIX" >/dev/null
git rm -rf --quiet . 2>/dev/null || true
rm -rf ./*
cp -r "$OLDPWD/dist/." .
touch .nojekyll   # 防 GitHub Pages 的 Jekyll 处理
git add -A
if git commit --quiet -m "deploy: $(date '+%Y-%m-%d %H:%M')"; then
  # 凭据坑：本机 GCM 存的是 Lai990603 账号（对仓库无权限），
  # 必须用 gh CLI（ybytlai78-dev）的 token 内嵌 URL 推送，绕开所有 credential helper
  git branch -f gh-pages HEAD
  TOKEN="$(gh auth token)"
  git push "https://ybytlai78-dev:${TOKEN}@github.com/${OWNER}/${REPO}.git" gh-pages --force
else
  echo "(dist 无变更，跳过推送)"
fi
popd >/dev/null

echo "==> 3/3 完成"
echo "线上地址: https://${OWNER}.github.io/${REPO}/"
