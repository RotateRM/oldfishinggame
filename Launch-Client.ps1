param(
    [Parameter(Position = 0)]
    [string]$ClientDirectory
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ClientDirectory)) {
    $ClientDirectory = Read-Host 'Path to your patched FishingChamp client folder'
}
$ClientDirectory = [IO.Path]::GetFullPath($ClientDirectory.Trim('"'))
$ClientExe = Join-Path $ClientDirectory 'FishingChamp.exe'
if (-not (Test-Path -LiteralPath $ClientExe -PathType Leaf)) { throw "FishingChamp.exe was not found in: $ClientDirectory" }
$ExpectedHash = 'B01B5D39D7B841D19E7B60B25333B84CA0044FA461F6626F268AF767EE92C6BB'
$ActualHash = (Get-FileHash -LiteralPath $ClientExe -Algorithm SHA256).Hash
if ($ActualHash -ne $ExpectedHash) {
    throw "The client is not the supported fixed/windowed build ($ActualHash). Run client-patch\Apply-Patch.cmd first."
}
$username = Read-Host 'Account name (blank for temporary guest)'
if (-not [string]::IsNullOrWhiteSpace($username)) {
    $securePassword = Read-Host 'Password (a new account name is created automatically)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $body = @{ username = $username; password = $password } | ConvertTo-Json -Compress
        $result = Invoke-RestMethod -Uri 'http://127.0.0.1:19000/session' -Method Post -ContentType 'application/json' -Body $body
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        Remove-Variable password, body -ErrorAction SilentlyContinue
    }
    if ($result.created) { Write-Host "Created account $($result.username)." -ForegroundColor Green }
    else { Write-Host "Signed in as $($result.username)." -ForegroundColor Green }
} else {
    Write-Host 'Using the temporary guest account.'
}
Start-Process -FilePath $ClientExe -WorkingDirectory $ClientDirectory
