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

$version = (Get-Content (Join-Path $repo "theme.json") -Raw | ConvertFrom-Json).version

$deployed = 0
foreach ($profile in Get-ChildItem $profilesRoot -Directory) {
  $modDir = Join-Path $profile.FullName "chrome\sine-mods\zen-proxy-divider"
  if (-not (Test-Path $modDir)) {
    continue
  }
  foreach ($file in $files) {
    Copy-Item (Join-Path $repo $file) $modDir -Force
  }
  Copy-Item (Join-Path $repo "src") $modDir -Recurse -Force
  # Keep the version Sine shows in its settings dialog in sync.
  $modsJsonPath = Join-Path $profile.FullName "chrome\sine-mods\mods.json"
  if (Test-Path $modsJsonPath) {
    try {
      $mods = Get-Content $modsJsonPath -Raw | ConvertFrom-Json
      if ($mods.'zen-proxy-divider') {
        $mods.'zen-proxy-divider'.version = $version
        # NB: not Set-Content -Encoding utf8 — PS 5.1 writes a UTF-8 BOM,
        # which breaks strict JSON parsers.
        [IO.File]::WriteAllText(
          $modsJsonPath,
          ($mods | ConvertTo-Json -Depth 10 -Compress),
          (New-Object System.Text.UTF8Encoding($false))
        )
      }
    } catch {
      Write-Warning "Could not update version in ${modsJsonPath}: $_"
    }
  }
  Write-Host "Deployed to $modDir (v$version)"
  $deployed++
}

if ($deployed -eq 0) {
  Write-Warning "Mod is not installed in any profile (chrome\sine-mods\zen-proxy-divider not found)."
} else {
  Write-Host "Done. Restart Zen to apply."
}
