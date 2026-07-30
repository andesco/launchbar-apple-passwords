#!/bin/zsh

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  print -u2 "Usage: bun run publish -- X.Y.Z"
  exit 64
fi

version=${1#v}
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  print -u2 "Version must use X.Y.Z format."
  exit 64
fi

repo_root=${0:A:h:h}
plist_path="$repo_root/Apple Passwords.lbaction/Contents/Info.plist"
tag="v$version"
archive_path="$repo_root/dist/Apple-Passwords-v${version}.lbaction.zip"

cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  print -u2 "The working tree must be clean before publishing a release."
  exit 1
fi

if ! command -v bun >/dev/null; then
  print -u2 "Bun is required."
  exit 69
fi

if ! command -v gh >/dev/null; then
  print -u2 "GitHub CLI is required: https://cli.github.com/"
  exit 69
fi

if ! gh auth status >/dev/null 2>&1; then
  print -u2 "Authenticate GitHub CLI first with: gh auth login"
  exit 77
fi

package_version=$(bun -e 'console.log(require("./package.json").version)')
bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist_path")
if [[ "$version" != "$package_version" || "$version" != "$bundle_version" ]]; then
  print -u2 \
    "Version mismatch: requested=$version, package.json=$package_version, bundle=$bundle_version"
  exit 1
fi

if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  print -u2 "Local tag $tag does not exist. Run: bun run release -- $version"
  exit 1
fi

if [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
  print -u2 "Tag $tag does not point to the current commit."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  print -u2 "No origin remote is configured. Add the GitHub repository as origin first."
  exit 1
fi

bun run build

git push -u origin HEAD
git push origin "$tag"

if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" "$archive_path" --clobber
else
  gh release create "$tag" "$archive_path" \
    --title "Apple Passwords LaunchBar Action $version" \
    --generate-notes
fi

release_url=$(gh release view "$tag" --json url --jq '.url')

print
print "Published Apple Passwords LaunchBar Action $version:"
print "  $release_url"
