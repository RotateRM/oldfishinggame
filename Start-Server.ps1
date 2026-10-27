$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    $versionText = (& node --version 2>$null)
} catch {
    throw 'Node.js 24 or newer is required. Install Node.js, then run Start-Server.cmd again.'
}
if ($versionText -notmatch '^v(\d+)\.') { throw "Could not read the Node.js version: $versionText" }
if ([int]$Matches[1] -lt 24) { throw "Node.js 24 or newer is required. Installed: $versionText" }
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'captures'),(Join-Path $PSScriptRoot 'backups') | Out-Null
Write-Host 'Starting FishingChamp preservation server...' -ForegroundColor Cyan
Write-Host 'Keep this window open while playing. Press Ctrl+C to stop.'
& node (Join-Path $PSScriptRoot 'server.mjs') (Join-Path $PSScriptRoot 'config.json')
if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
