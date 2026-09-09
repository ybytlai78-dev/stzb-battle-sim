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
npx vite build --base="${BASE}/"

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
