param(
    [Parameter(Position = 0)]
    [string]$ClientDirectory
)

$ErrorActionPreference = 'Stop'
$OriginalHash = 'F76A869B79BE6E0277641BCD1796119054580ED05028F8701611D5EDE7D51D63'
$LocalhostHash = 'BE8D3147DBF73607D935B27D8780925D6E388288B6BE52D364A8037BB51FCA71'
$FixedHash = 'B01B5D39D7B841D19E7B60B25333B84CA0044FA461F6626F268AF767EE92C6BB'

if ([string]::IsNullOrWhiteSpace($ClientDirectory)) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'FishingChamp.exe')) {
        $ClientDirectory = $PSScriptRoot
    } else {
        $ClientDirectory = Read-Host 'Path to the clean FishingChamp client folder'
    }
}
$ClientDirectory = [IO.Path]::GetFullPath($ClientDirectory.Trim('"'))
$Exe = Join-Path $ClientDirectory 'FishingChamp.exe'
$Backup = Join-Path $ClientDirectory 'FishingChamp.original.exe'
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "FishingChamp.exe was not found in: $ClientDirectory" }

$CurrentHash = (Get-FileHash -LiteralPath $Exe -Algorithm SHA256).Hash
if ($CurrentHash -eq $FixedHash) {
    Write-Host 'The fixed localhost + windowed-mode client is already installed.' -ForegroundColor Green
    exit 0
}
if ($CurrentHash -ne $OriginalHash -and $CurrentHash -ne $LocalhostHash) {
    throw "Unsupported FishingChamp.exe build ($CurrentHash). No files were changed."
}
if (-not (Test-Path -LiteralPath $Backup)) {
    Copy-Item -LiteralPath $Exe -Destination $Backup
    Write-Host 'Saved backup: FishingChamp.original.exe'
}

[byte[]]$Bytes = [IO.File]::ReadAllBytes($Exe)
function Set-VerifiedBytes([int]$Offset, [string]$ExpectedHex, [string]$ReplacementHex) {
    [byte[]]$Expected = for ($i = 0; $i -lt $ExpectedHex.Length; $i += 2) { [Convert]::ToByte($ExpectedHex.Substring($i, 2), 16) }
    [byte[]]$Replacement = for ($i = 0; $i -lt $ReplacementHex.Length; $i += 2) { [Convert]::ToByte($ReplacementHex.Substring($i, 2), 16) }
    if ($Expected.Length -ne $Replacement.Length) { throw "Internal patch length mismatch at 0x$($Offset.ToString('X'))" }
    for ($i = 0; $i -lt $Expected.Length; $i++) {
        if ($Bytes[$Offset + $i] -ne $Expected[$i]) { throw "Unexpected bytes at 0x$($Offset.ToString('X')); no patched executable was written." }
    }
    [Array]::Copy($Replacement, 0, $Bytes, $Offset, $Replacement.Length)
}

if ($CurrentHash -eq $OriginalHash) {
    Set-VerifiedBytes 0x64F624 '3231382E3134352E35352E31363400' '3132372E302E302E31000000000000'
}
Set-VerifiedBytes 0x1FFD6 '6800030000' '6827030000'
Set-VerifiedBytes 0x1FFDB '6800040000' '6810040000'
Set-VerifiedBytes 0x1FFE2 '6800000090' '680000CA10'
Set-VerifiedBytes 0x16F40F '8BCEE86A080000' 'E95CBA04009090'
Set-VerifiedBytes 0x1BAE70 '00000000000000000000000000000000000000' 'C686B0000000018BCEE8024EFBFFE99345FBFF'
Set-VerifiedBytes 0x238 '65' '90'

$Temporary = "$Exe.patching"
[IO.File]::WriteAllBytes($Temporary, $Bytes)
$PatchedHash = (Get-FileHash -LiteralPath $Temporary -Algorithm SHA256).Hash
if ($PatchedHash -ne $FixedHash) {
    Remove-Item -LiteralPath $Temporary -Force
    throw "Patched file verification failed ($PatchedHash). The installed executable was not changed."
}
Move-Item -LiteralPath $Temporary -Destination $Exe -Force
Write-Host 'Installed the fixed localhost + windowed-mode FishingChamp client.' -ForegroundColor Green
Write-Host "Client folder: $ClientDirectory"
