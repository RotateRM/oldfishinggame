param(
    [Parameter(Position = 0)]
    [string]$ClientDirectory
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ClientDirectory)) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'FishingChamp.original.exe')) {
        $ClientDirectory = $PSScriptRoot
    } else {
        $ClientDirectory = Read-Host 'Path to the patched FishingChamp client folder'
    }
}
$ClientDirectory = [IO.Path]::GetFullPath($ClientDirectory.Trim('"'))
$Exe = Join-Path $ClientDirectory 'FishingChamp.exe'
$Backup = Join-Path $ClientDirectory 'FishingChamp.original.exe'
if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { throw "Backup not found: $Backup" }
$BackupHash = (Get-FileHash -LiteralPath $Backup -Algorithm SHA256).Hash
$Allowed = @(
    'F76A869B79BE6E0277641BCD1796119054580ED05028F8701611D5EDE7D51D63',
    'BE8D3147DBF73607D935B27D8780925D6E388288B6BE52D364A8037BB51FCA71'
)
if ($BackupHash -notin $Allowed) { throw "Backup verification failed ($BackupHash). Nothing was restored." }
Copy-Item -LiteralPath $Backup -Destination $Exe -Force
Write-Host 'Restored FishingChamp.exe from FishingChamp.original.exe.' -ForegroundColor Green
