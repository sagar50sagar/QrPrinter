#requires -Version 5.1
<#
    Shop-side setup, launched by "Install QrPrinter Agent.bat".

    Copies the agent into Program Files, places the server address in
    %PROGRAMDATA%, asks for the pairing code shown in the shop's panel, then
    installs the Windows service. The shop never types a URL or a command.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$source   = $PSScriptRoot
$target   = Join-Path $env:ProgramFiles 'QrPrinter Agent'
$dataRoot = if ($env:QPRINTER_AGENT_HOME) { $env:QPRINTER_AGENT_HOME }
            else { Join-Path $env:ProgramData 'QrPrinter Agent' }
$exe      = Join-Path $target 'QrPrinterAgent.exe'

# The alphabet the server actually issues: no 0/O, 1/I/L, so a code read aloud
# or typed from a screenshot cannot fail on a look-alike glyph.
$codePattern = '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'

function Step($text)  { Write-Host "`n$text" -ForegroundColor Cyan }
function Good($text)  { Write-Host "  $text" -ForegroundColor Green }
function Warn($text)  { Write-Host "  $text" -ForegroundColor Yellow }
function Fail($text)  { Write-Host "  $text" -ForegroundColor Red }

Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ' QrPrinter agent setup' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Fail 'This needs administrator rights. Right-click the installer and choose "Run as administrator".'
    exit 1
}

Step '1 of 4  Copying the agent into Program Files'
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($file in 'QrPrinterAgent.exe', 'SumatraPDF.exe') {
    $from = Join-Path $source $file
    if (-not (Test-Path -LiteralPath $from)) {
        Fail "$file is missing from this folder. Download the zip again and extract every file."
        exit 1
    }
    Copy-Item -LiteralPath $from -Destination (Join-Path $target $file) -Force
}
Good "installed to $target"

Step '2 of 4  Setting the server address'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$shippedConfig = Join-Path $source 'config.json'
$liveConfig    = Join-Path $dataRoot 'config.json'
if (-not (Test-Path -LiteralPath $shippedConfig)) {
    Fail 'config.json is missing from this folder. Download the zip again.'
    exit 1
}
Copy-Item -LiteralPath $shippedConfig -Destination $liveConfig -Force
$server = (Get-Content -LiteralPath $liveConfig -Raw | ConvertFrom-Json).api_base_url
Good "server $server"

Step '3 of 4  Pairing this PC with your shop'
$deviceFile = Join-Path $dataRoot 'device.json'
$paired = $null
if (Test-Path -LiteralPath $deviceFile) {
    try { $paired = (Get-Content -LiteralPath $deviceFile -Raw | ConvertFrom-Json).device_id } catch { $paired = $null }
}
$wasRunning = (Get-Service -Name 'QrPrinterAgent' -ErrorAction SilentlyContinue).Status -eq 'Running'

# device.json alone is not proof of a working pairing. Rebuilding the server
# database leaves the file behind holding a token the server no longer knows,
# and the service then runs while every job is refused. So a code is always
# offered, even on a PC that looks paired.
if ($paired) {
    Warn "This PC is already paired as $paired."
    Warn 'If the panel shows it offline, or the server was reinstalled, enter a new code below.'
}

$code = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
    Write-Host ''
    Write-Host '  In your QrPrinter panel open Settings and press "Generate pairing code".'
    $prompt = if ($paired) { '  New code, or press Enter to keep the existing pairing' }
              else { '  Type the 6-character code here' }
    $typed = Read-Host $prompt
    $candidate = ($typed -replace '\s', '').ToUpperInvariant()
    if ($candidate -eq '' -and $paired) { Good "keeping $paired"; break }
    if ($candidate -match $codePattern) { $code = $candidate; break }
    Fail "That is not a valid code. It is 6 letters/digits, without 0, O, 1, I or L. (attempt $attempt of 3)"
}
if (-not $code -and -not $paired) {
    Fail 'No valid code entered. Nothing was paired. Run this installer again with a code from the panel.'
    exit 1
}

if ($code) {
    & $exe pair $code
    if ($LASTEXITCODE -ne 0) {
        Fail 'Pairing failed. Generate a fresh code in the panel and run this installer again.'
        exit 1
    }
    Good 'paired'
}

Step '4 of 4  Starting the agent with Windows'
& $exe service install
if ($LASTEXITCODE -ne 0) {
    Fail 'The service could not be installed. The agent is paired, so you can start it by hand with: QrPrinterAgent run'
    exit 1
}
# A service that was already running keeps the previous token in memory, so
# installing over it is not enough to make a new pairing take effect.
if ($code -and $wasRunning) { & $exe service restart }

Write-Host ''
Write-Host '==========================================' -ForegroundColor Green
Write-Host ' Done. The agent now starts with this PC.' -ForegroundColor Green
Write-Host '==========================================' -ForegroundColor Green
Write-Host ''
Write-Host 'Your panel should show this device online within a few seconds.'
Write-Host 'If it does not, run: QrPrinterAgent doctor'
Write-Host ''
& $exe service status
exit 0