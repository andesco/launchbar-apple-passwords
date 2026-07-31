#!/bin/zsh

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  print -u2 "Usage: bun run release -- X.Y.Z"
  exit 64
fi

version=${1#v}
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  print -u2 "Version must use X.Y.Z format."
  exit 64
fi

repo_root=${0:A:h:h}
plist_path="$repo_root/Apple Passwords.lbaction/Contents/Info.plist"
verification_plist_path="$repo_root/Enter verification code.lbaction/Contents/Info.plist"
tag="v$version"

cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  print -u2 "The working tree must be clean before publishing a release."
  exit 1
fi

if ! command -v bun >/dev/null; then
  print -u2 "Bun is required."
  exit 69
fi

VERSION="$version" bun -e '
  const fs = require("node:fs");
  const path = "package.json";
  const packageJson = JSON.parse(fs.readFileSync(path, "utf8"));
  packageJson.version = process.env.VERSION;
  fs.writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);

  const readmePath = "README.md";
  const readme = fs.readFileSync(readmePath, "utf8");
  const latestDownload =
    `https://github.com/andesco/launchbar-apple-passwords/releases/download/v${process.env.VERSION}/Apple-Passwords-v${process.env.VERSION}.lbaction.zip`;
  const releaseDownloadPattern =
    /https:\/\/github\.com\/andesco\/launchbar-apple-passwords\/releases\/download\/v[^/]+\/Apple-Passwords-v[^/]+\.lbaction\.zip/g;
  const updatedReadme = readme.replace(releaseDownloadPattern, latestDownload);
  if (updatedReadme === readme) {
    throw new Error("README latest release download link was not found");
  }
  fs.writeFileSync(readmePath, updatedReadme);
'

/usr/bin/plutil -replace CFBundleVersion -string "$version" "$plist_path"
/usr/bin/plutil -replace CFBundleVersion -string "$version" "$verification_plist_path"
bun run build

git add README.md package.json "$plist_path" "$verification_plist_path"
if ! git diff --cached --quiet; then
  git commit -m "Release $tag"
fi

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  if [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
    print -u2 "Tag $tag already exists on a different commit."
    exit 1
  fi
else
  git tag "$tag"
fi

print
print "Prepared Apple Passwords LaunchBar Action $version locally."
print "Review tag $tag and dist/Apple-Passwords-v${version}.lbaction.zip, then run:"
print "  bun run publish -- $version"
