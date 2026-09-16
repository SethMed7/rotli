# Rotli Helper installer - Windows (PowerShell).
#
#   irm https://rotli.co/helper/install.ps1 | iex
#
# Downloads the prebuilt rotli-helper.exe for this computer into
# %USERPROFILE%\.rotli\bin, checks its SHA-256 against the release's checksum
# file, and starts it, which prints the pairing code Rotli Web asks for. No
# PATH edits, no admin rights, no services. Run
# & "$HOME\.rotli\bin\rotli-helper.exe" later to start it again; delete the
# file to uninstall.
$ErrorActionPreference = "Stop"

$version = if ($env:ROTLI_HELPER_VERSION) { $env:ROTLI_HELPER_VERSION } else { "1.0.0" }
$releases = if ($env:ROTLI_HELPER_RELEASES) { $env:ROTLI_HELPER_RELEASES } else { "https://github.com/SethMed7/rotli-releases/releases/download" }
$destDir = Join-Path $HOME ".rotli\bin"
$dest = Join-Path $destDir "rotli-helper.exe"

$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$asset = "rotli-helper-windows-$arch.exe"
$url = "$releases/helper-v$version/$asset"
$sumsUrl = "$releases/helper-v$version/SHA256SUMS"

if ($env:ROTLI_HELPER_DRY_RUN -eq "1") {
  Write-Host "would download $url"
  Write-Host "would install to $dest"
  return
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("rotli-helper-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading Rotli Helper $version for windows/$arch..."
  try {
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $asset) -UseBasicParsing
  } catch {
    throw "rotli-helper: no download at $url - this version may not be published for your computer yet."
  }
  $sumsPath = Join-Path $tmp "SHA256SUMS"
  $haveSums = $true
  try {
    Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsPath -UseBasicParsing
  } catch {
    $haveSums = $false
  }
  if ($haveSums) {
    # a release that ships checksums must verify: no matching line is a refusal
    $line = Get-Content $sumsPath | Where-Object { $_ -match " $([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $line) { throw "rotli-helper: the release's checksum file has no entry for $asset - not installing." }
    $expected = ($line -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "rotli-helper: the download did not match the published checksum - not installing." }
    Write-Host "Checksum verified."
  } else {
    Write-Host "This release publishes no checksum file; installing unverified."
  }
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  Move-Item -Force (Join-Path $tmp $asset) $dest
  Write-Host "Installed to $dest"
  Write-Host "Starting it now - keep this window open while you chat (Ctrl+C stops it)."
  Write-Host ""
  & $dest
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
