# Copies the mod files into every Zen profile where it is installed via Sine,
# so a browser restart picks up local changes without reinstalling the mod.
$ErrorActionPreference = "Stop"

$repo = $PSScriptRoot
$files = @(
  "zen-proxy-divider.uc.mjs",
  "chrome.css",
  "theme.json",
  "preferences.json",
  "README.md"
)

$profilesRoot = Join-Path $env:APPDATA "zen\Profiles"
if (-not (Test-Path $profilesRoot)) {
  Write-Error "Zen profiles directory not found: $profilesRoot"
}

$deployed = 0
foreach ($profile in Get-ChildItem $profilesRoot -Directory) {
  $modDir = Join-Path $profile.FullName "chrome\sine-mods\zen-proxy-divider"
  if (-not (Test-Path $modDir)) {
    continue
  }
  foreach ($file in $files) {
    Copy-Item (Join-Path $repo $file) $modDir -Force
  }
  Write-Host "Deployed to $modDir"
  $deployed++
}

if ($deployed -eq 0) {
  Write-Warning "Mod is not installed in any profile (chrome\sine-mods\zen-proxy-divider not found)."
} else {
  Write-Host "Done. Restart Zen to apply."
}
