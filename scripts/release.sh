#!/bin/zsh

set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  print -u2 "Usage: npm run release -- X.Y.Z"
  exit 64
fi

version=${1#v}
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  print -u2 "Version must use X.Y.Z format."
  exit 64
fi

repo_root=${0:A:h:h}
plist_path="$repo_root/Apple Passwords.lbaction/Contents/Info.plist"

cd "$repo_root"

VERSION="$version" node <<'NODE'
const fs = require("node:fs");
const path = "package.json";
const packageJson = JSON.parse(fs.readFileSync(path, "utf8"));
packageJson.version = process.env.VERSION;
fs.writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
NODE

/usr/bin/plutil -replace CFBundleVersion -string "$version" "$plist_path"
"$repo_root/scripts/package.sh"

print
print "Prepared version $version."
print "Review and commit the version changes, tag v$version, then upload:"
print "  dist/Apple-Passwords-v${version}.lbaction.zip"
