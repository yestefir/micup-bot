#!/usr/bin/env bash
# dev'in üretim kodunu main'in üstüne tek commit olarak koyan bir PR dalı hazırlar.
# Testler, scripts/ ve test workflow'u (dev'e özel dosyalar) dahil edilmez.
# Kullanım: scripts/release-branch.sh "Commit mesajı" [dal-adı]
set -euo pipefail

message="${1:?Kullanım: scripts/release-branch.sh \"Commit mesajı\" [dal-adı]}"
branch="${2:-release/$(date +%Y%m%d-%H%M)}"
git check-ref-format "refs/heads/$branch"

cd "$(git rev-parse --show-toplevel)"
dev=$(git rev-parse --verify refs/heads/dev)
git fetch origin refs/heads/main:refs/remotes/origin/main
main=$(git rev-parse --verify refs/remotes/origin/main)

# Dal değiştirmeden dev'in commit'lenmiş içeriğini geçici bir index'e al.
tmp_dir=$(mktemp -d)
trap 'rm -f -- "$tmp_dir/index" "$tmp_dir/index.lock"; rmdir -- "$tmp_dir"' EXIT
export GIT_INDEX_FILE="$tmp_dir/index"
git read-tree "$dev"
git ls-files -z -- test scripts .github/workflows/test.yml |
  git update-index --force-remove -z --stdin

manifest=$(git show "$dev:package.json" | node -e '
  const fs = require("fs");
  const source = fs.readFileSync(0, "utf8");
  const pkg = JSON.parse(source);
  if (Object.hasOwn(pkg.scripts ?? {}, "test")) {
    delete pkg.scripts.test;
    process.stdout.write(JSON.stringify(pkg, null, 2) + "\n");
  } else {
    process.stdout.write(source);
  }
' | git hash-object -w --stdin)
git update-index --cacheinfo "100644,$manifest,package.json"
tree=$(git write-tree)

if [ "$tree" = "$(git rev-parse "$main^{tree}")" ]; then
  echo "main ile aynı, yapılacak değişiklik yok."
  exit 0
fi

release=$(git commit-tree "$tree" -p "$main" -m "$message")
git branch -- "$branch" "$release"
echo
echo "Hazır: $branch (main'e göre tek commit)."
git diff --shortstat "$main" "$release"
echo
echo "Sonraki adım:"
echo "  git push -u origin $branch"
echo "  gh pr create --base main --head $branch"
