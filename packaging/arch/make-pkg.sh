#!/usr/bin/env bash
# Builds the Arch package from release/*.tar.gz (run `npm run dist:linux` first).
set -euo pipefail
cd "$(dirname "$0")"
version=$(node -p "require('../../package.json').version")
tarball=$(ls ../../release/*-"$version"-linux-x64.tar.gz 2>/dev/null | head -1 || true)
[ -n "$tarball" ] || { echo "No release/*-$version-linux-x64.tar.gz: run npm run dist:linux first." >&2; exit 1; }
work=build && rm -rf "$work" && mkdir -p "$work"
name="makerstudio-ai-$version-linux-x64.tar.gz"   # no spaces in PKGBUILD sources
cp "$tarball" "$work/$name"
cp makerstudio-ai.desktop makerstudio-ai.xml "$work/"
cp ../../build/icon.png "$work/icon.png"
top=$( (tar -tzf "$tarball" || true) | head -1 | cut -d/ -f1)
sha=$(sha256sum "$tarball" | cut -d' ' -f1)
sed -e "s|@VERSION@|$version|" -e "s|@TARBALL@|$name|" -e "s|@SHA256@|$sha|" -e "s|@TOPDIR@|$top|" PKGBUILD.in > "$work/PKGBUILD"
cd "$work" && makepkg -f --nodeps
ls -la ./*.pkg.tar.zst
