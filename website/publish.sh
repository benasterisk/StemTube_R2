#!/usr/bin/env bash
# Publish website/ to the gh-pages branch (GitHub Pages serves from there).
#
# GitHub Actions is disabled for this account, so the deploy-website.yml
# workflow never runs. This script does the same thing locally: rsyncs
# website/ to a gh-pages worktree, commits, and pushes.
#
# Usage: ./website/publish.sh ["commit message"]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WEBSITE_DIR="$REPO_ROOT/website"
WORKTREE_DIR="$(mktemp -d -t stemtube-gh-pages-XXXXXX)"
MSG="${1:-chore: sync website to gh-pages}"

cleanup() {
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
    rm -rf "$WORKTREE_DIR"
}
trap cleanup EXIT

git -C "$REPO_ROOT" fetch origin gh-pages
git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" gh-pages

rsync -a --delete \
    --exclude='.git' \
    --exclude='.nojekyll' \
    "$WEBSITE_DIR/" "$WORKTREE_DIR/"

cd "$WORKTREE_DIR"
git add -A

if git diff --cached --quiet; then
    echo "Nothing to publish — gh-pages already up to date."
    exit 0
fi

git commit -m "$MSG"
git push origin gh-pages
echo "Published to https://benasterisk.github.io/StemTube_R2/ (CDN cache up to ~10 min)."
