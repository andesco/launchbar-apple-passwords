#!/bin/zsh

set -euo pipefail

repo_root=${0:A:h:h}
bundle_name='Apple Passwords.lbaction'
bundle_path="$repo_root/$bundle_name"
plist_path="$bundle_path/Contents/Info.plist"
dist_path="$repo_root/dist"

cd "$repo_root"

package_version=$(bun -e 'console.log(require("./package.json").version)')
bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist_path")

if [[ "$package_version" != "$bundle_version" ]]; then
  print -u2 "Version mismatch: package.json=$package_version, bundle=$bundle_version"
  exit 1
fi

/usr/bin/plutil -lint "$plist_path"
bun run test

/bin/mkdir -p "$dist_path"
archive_path="$dist_path/Apple-Passwords-v${package_version}.lbaction.zip"
/bin/rm -f "$archive_path"

(
  cd "$repo_root"
  /usr/bin/zip -r -X "$archive_path" "$bundle_name" \
    -x '*.DS_Store' \
    >/dev/null
)

print "Built $archive_path"
