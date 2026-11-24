#!/usr/bin/env bash
# Validates the Factur-X samples with veraPDF (PDF/A-3B), the CEN EN 16931 CII Schematron and Mustang.
# Usage: scripts/validate-einvoice.sh <work-dir>   (needs bun, java 17+, curl, unzip; tools are cached in <work-dir>)
set -euo pipefail

WORK="$(mkdir -p "${1:?work directory}" && cd "$1" && pwd)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

VERAPDF_URL=https://software.verapdf.org/rel/1.30/verapdf-greenfield-1.30.4-installer.zip
VERAPDF_SHA=04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23
MUSTANG_URL=https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/2.26.0/Mustang-CLI-2.26.0.jar
MUSTANG_SHA=42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736
CEN_URL=https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-1.3.17/en16931-cii-1.3.17.zip
CEN_SHA=e5f3235824b6b38454b1d54cf3f14e01efb5b33971fbefc4e64997d0ef619e89

# Downloads a file once and checks its SHA-256.
fetch() {
  local url=$1 sha=$2 file=$3
  [ -f "$file" ] || curl -fsSL "$url" -o "$file"
  echo "$sha  $file" | sha256sum -c --quiet -
}

fetch "$VERAPDF_URL" "$VERAPDF_SHA" "$WORK/verapdf.zip"
fetch "$MUSTANG_URL" "$MUSTANG_SHA" "$WORK/mustang.jar"
fetch "$CEN_URL" "$CEN_SHA" "$WORK/cen-cii.zip"

if [ ! -x "$WORK/verapdf/verapdf" ]; then
  unzip -qo "$WORK/verapdf.zip" -d "$WORK/verapdf-installer"
  cat > "$WORK/verapdf-auto.xml" <<EOF
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
<com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
<com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$WORK/verapdf</installpath></com.izforge.izpack.panels.target.TargetPanel>
<com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
<pack index="0" name="veraPDF GUI" selected="true"/>
<pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
<pack index="2" name="veraPDF Validation model" selected="true"/>
<pack index="3" name="veraPDF Documentation" selected="false"/>
<pack index="4" name="veraPDF Sample Plugins" selected="false"/>
</com.izforge.izpack.panels.packs.PacksPanel>
<com.izforge.izpack.panels.install.InstallPanel id="install"/>
<com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
EOF
  "$WORK"/verapdf-installer/verapdf-greenfield-*/verapdf-install "$WORK/verapdf-auto.xml" > /dev/null
fi
[ -d "$WORK/cen-cii" ] || unzip -qo "$WORK/cen-cii.zip" -d "$WORK/cen-cii"

VERAPDF="$WORK/verapdf/verapdf" \
MUSTANG_JAR="$WORK/mustang.jar" \
CEN_CII_XSLT="$WORK/cen-cii/xslt/EN16931-CII-validation.xslt" \
  bun "$ROOT/apps/server/src/cli/einvoice-validate.ts" "$WORK/samples"
