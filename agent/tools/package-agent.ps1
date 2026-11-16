#requires -Version 5.1
<#
.SYNOPSIS
    Packs the built agent into the zip a shop downloads from the panel.

.DESCRIPTION
    Takes the folder build-agent.ps1 produced and adds the three things that
    make it self-service: a config.json already pointing at this server, a
    double-click installer, and plain-language instructions. The shop then
    only ever types a pairing code.

.PARAMETER ServerUrl
    The address shops reach this server on. Must be https, except for a
    loopback address used in testing. The websocket address is derived from it.

.PARAMETER OutFile
    Where the zip lands. Defaults to server\var\agent\QrPrinterAgent.zip,
    which is what GET /download/agent serves.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File agent\tools\package-agent.ps1 -ServerUrl https://print.example.in
#>
[CmdletBinding()]
param (
    [string]$ServerUrl = 'http://127.0.0.1:8787',
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist     = Join-Path $repoRoot 'agent\dist\QrPrinterAgent'
$installer = Join-Path $PSScriptRoot 'installer'

if ([string]::IsNullOrWhiteSpace($OutFile)) {
    $OutFile = Join-Path $repoRoot 'server\var\agent\QrPrinterAgent.zip'
}

foreach ($file in 'QrPrinterAgent.exe', 'SumatraPDF.exe') {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $file))) {
        throw "no $file in $dist. Run agent\tools\build-agent.ps1 first."
    }
}

# Apply the agent's own rule here, so a bad address fails on the dev box rather
# than on a shop PC after the zip has already been handed out.
$uri = $null
if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$uri)) {
    throw "ServerUrl is not an absolute URL: $ServerUrl"
}
$isLoopback = $uri.Host -eq 'localhost' -or $uri.Host -eq '[::1]' -or $uri.Host.StartsWith('127.')
if ($uri.Scheme -eq 'https') { $socketScheme = 'wss' }
elseif ($uri.Scheme -eq 'http' -and $isLoopback) { $socketScheme = 'ws' }
else { throw "ServerUrl must be https (http is only allowed for a loopback test address): $ServerUrl" }

$apiBase = $ServerUrl.TrimEnd('/')
$socketUrl = '{0}://{1}{2}/agent/channel' -f $socketScheme, $uri.Authority, $uri.AbsolutePath.TrimEnd('/')

$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ('qrprinter-pack-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $stageRoot 'QrPrinterAgent'
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
    Copy-Item -LiteralPath (Join-Path $dist 'QrPrinterAgent.exe') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $dist 'SumatraPDF.exe') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $installer 'Install QrPrinter Agent.bat') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $installer 'install.ps1') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $installer 'READ ME.txt') -Destination $stage

    # Only the two addresses the agent requires; every other setting keeps the
    # agent's own default, so a future default change is not frozen into a zip.
    $config = [ordered]@{ api_base_url = $apiBase; agent_socket_url = $socketUrl }
    $config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'config.json') -Encoding UTF8

    New-Item -ItemType Directory -Path (Split-Path -Parent $OutFile) -Force | Out-Null
    if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
    # Both Compress-Archive and ZipFile.CreateFromDirectory on .NET Framework
    # write backslashes into entry names, which the zip format forbids and
    # non-Explorer extractors mis-read as part of the filename. Naming each
    # entry by hand is the only way to get conforming forward slashes here.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($OutFile, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $stage -File) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, 'QrPrinterAgent/' + $file.Name,
                [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }

    $zip = Get-Item -LiteralPath $OutFile
    Write-Output ''
    Write-Output ('zip       {0}  ({1:N1} MB)' -f $zip.FullName, ($zip.Length / 1MB))
    Write-Output "server    $apiBase"
    Write-Output "socket    $socketUrl"
    Write-Output ''
    Write-Output 'contents  QrPrinterAgent.exe, SumatraPDF.exe, config.json,'
    Write-Output '          Install QrPrinter Agent.bat, install.ps1, READ ME.txt'
    Write-Output ''
    Write-Output 'serve it  the running server exposes this at GET /download/agent'
}
finally {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}