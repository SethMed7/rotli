# Rotli Helper installer - Windows (PowerShell).
#
#   & ([scriptblock]::Create((irm https://rotli.co/helper/install.ps1))) -Open https://rotli.co/app/
#
# Downloads the prebuilt rotli-helper.exe for this computer into
# %USERPROFILE%\.rotli\bin, checks its SHA-256 against the release's checksum
# file, and adds a shortcut to your Startup folder so it starts when you log
# in (the vault Rotli Web opens through it stays connected across reboots).
# With -Open, it then opens Rotli Web with the pairing code in the URL
# fragment (#pair=...), which the browser never sends to any server. No PATH
# edits, no admin rights. It listens on 127.0.0.1 only and touches only the
# vault folder you choose. -Uninstall stops it and removes it.
param([string]$Open = "", [switch]$Uninstall)
$ErrorActionPreference = "Stop"

# the pairing code only ever goes to Rotli's own page
if ($Open -and $Open -cnotmatch '\A(https://(dev\.)?rotli\.co|http://(localhost|127\.0\.0\.1):1437)/app/\z') {
  throw "rotli-helper: -Open only accepts Rotli Web's own address, not $Open"
}
$startup = Join-Path ([Environment]::GetFolderPath("Startup")) "Rotli Helper.lnk"

$version = if ($env:ROTLI_HELPER_VERSION) { $env:ROTLI_HELPER_VERSION } else { "1.4.0" }
$releases = if ($env:ROTLI_HELPER_RELEASES) { $env:ROTLI_HELPER_RELEASES } else { "https://github.com/SethMed7/rotli-releases/releases/download" }
$destDir = Join-Path $HOME ".rotli\bin"
$dest = Join-Path $destDir "rotli-helper.exe"

$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$asset = "rotli-helper-windows-$arch.exe"
$url = "$releases/helper-v$version/$asset"
$sumsUrl = "$releases/helper-v$version/SHA256SUMS"

if ($Uninstall) {
  Get-Process -Name "rotli-helper" -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item -Force $startup, $dest -ErrorAction SilentlyContinue
  Write-Host "Rotli Helper is stopped and removed. Your vault folder is untouched."
  Write-Host "Its pairing code and vault choice stay in $HOME\.rotli-helper; delete that folder to forget them too."
  return
}

if ($env:ROTLI_HELPER_DRY_RUN -eq "1") {
  Write-Host "would add $startup and open $(if ($Open) { $Open } else { 'nothing' })"
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
  # an upgrade replaces a running helper
  Get-Process -Name "rotli-helper" -ErrorAction SilentlyContinue | Stop-Process -Force
  Move-Item -Force (Join-Path $tmp $asset) $dest
  Write-Host "Installed to $dest"

  # start at login (a minimized window), and now
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($startup)
  $link.TargetPath = $dest
  $link.WindowStyle = 7
  $link.Save()
  Start-Process -FilePath $dest -WindowStyle Hidden
  Write-Host "Rotli Helper starts when you log in (Startup folder shortcut)."

  $ready = $false
  for ($i = 0; $i -lt 50 -and -not $ready; $i++) {
    try { Invoke-WebRequest -Uri "http://127.0.0.1:43111/health" -UseBasicParsing -TimeoutSec 1 | Out-Null; $ready = $true }
    catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $ready) { throw "rotli-helper: it didn't start." }
  $code = ((& $dest --print-code) -replace '^Pairing code: ', '').Trim()
  Write-Host ""
  Write-Host "Pairing code: $code"
  if ($Open) {
    Write-Host "Opening Rotli Web to pair..."
    Start-Process "$Open#pair=$code"
  }
  Write-Host "Done. Rotli Web pairs with it automatically; if it asks, paste the code above."
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
