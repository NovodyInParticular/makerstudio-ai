#!/usr/bin/env bash
# Install MakerStudio AI for this user on Linux: a stable copy of the packaged app, an app-menu
# entry with its icon, and the .msproj file type. Run again after updating to install the new build.
#
#   scripts/install-desktop.sh            build and install
#   scripts/install-desktop.sh --remove   uninstall (your projects are not touched)
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="$HOME/.local/share/makerstudio-ai"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
MIME="$HOME/.local/share/mime"

if [[ "${1:-}" == "--remove" ]]; then
  rm -rf "$DEST" "$APPS/makerstudio-ai.desktop" "$ICONS/makerstudio-ai.png" "$MIME/packages/makerstudio-ai.xml"
  rm -f "$HOME/.local/bin/makerstudio-ai"
  update-desktop-database "$APPS" 2>/dev/null || true
  update-mime-database "$MIME" 2>/dev/null || true
  echo "MakerStudio AI removed (projects in ~/Documents/MakerStudio are untouched)."
  exit 0
fi

echo "Building..."
npm run build >/dev/null
rm -rf release/linux-unpacked
ELECTRON_BUILDER_7ZIP_PATH="${ELECTRON_BUILDER_7ZIP_PATH:-/usr/bin/7za}" npx electron-builder --linux dir >/dev/null

echo "Installing to $DEST ..."
mkdir -p "$DEST" "$APPS" "$ICONS" "$MIME/packages" "$HOME/.local/bin"
rm -rf "$DEST/app.new"
cp -a release/linux-unpacked "$DEST/app.new"
rm -rf "$DEST/app"
mv "$DEST/app.new" "$DEST/app"
install -m 644 build/icon.png "$ICONS/makerstudio-ai.png"
ln -sf "$DEST/app/makerstudio-ai" "$HOME/.local/bin/makerstudio-ai"

cat > "$APPS/makerstudio-ai.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=MakerStudio AI
GenericName=Engineering and robotics workshop
Comment=3D design, circuits, robot faces and robotics, with AI help
Exec=$DEST/app/makerstudio-ai %f
Icon=makerstudio-ai
Terminal=false
Categories=Development;Engineering;
Keywords=cad;3d;print;circuit;robot;arduino;esp32;stl;step;
MimeType=application/x-makerstudio-project;
StartupWMClass=MakerStudio AI
DESKTOP

cat > "$MIME/packages/makerstudio-ai.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-makerstudio-project">
    <comment>MakerStudio AI project</comment>
    <glob pattern="*.msproj"/>
  </mime-type>
</mime-info>
XML

update-mime-database "$MIME" 2>/dev/null || true
update-desktop-database "$APPS" 2>/dev/null || true
xdg-mime default makerstudio-ai.desktop application/x-makerstudio-project 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
echo "Installed. Find \"MakerStudio AI\" in the app menu (or run makerstudio-ai)."
