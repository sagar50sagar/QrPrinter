#requires -Version 5.1
<#
.SYNOPSIS
    Builds the Windows agent as a folder a shop PC can run.

.DESCRIPTION
    Publishes QrPrinterAgent.exe and puts the print backend beside it, because
    the agent looks for SumatraPDF.exe in its own folder. The result is the
    thing to copy to a customer machine.

.PARAMETER FrameworkDependent
    Ships a ~50 KB exe that needs the .NET 10 runtime installed first. Use it
    when you control the machine; leave it out for shops, where a self-contained
    exe is bigger and needs nothing.

.PARAMETER OutDir
    Where the folder lands. Defaults to agent\dist\QrPrinterAgent.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File agent\tools\build-agent.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File agent\tools\build-agent.ps1 -FrameworkDependent
#>
[CmdletBinding()]
param (
    [switch]$FrameworkDependent,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$project = Join-Path $repoRoot 'agent\src\QrPrinter.Agent\QrPrinter.Agent.csproj'
$sidecar = Join-Path $repoRoot 'agent\vendor\sumatra\SumatraPDF.exe'

if (-not (Test-Path -LiteralPath $project)) { throw "no agent project at $project" }
if (-not (Test-Path -LiteralPath $sidecar)) {
    throw "no print backend at $sidecar. Run agent\tools\get-sumatra.ps1 first."
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $repoRoot 'agent\dist\QrPrinterAgent'
}

# dotnet is usually absent from PATH on a dev box that got it from the installer.
$dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
if ($null -eq $dotnet) {
    $candidate = Join-Path ${env:ProgramFiles} 'dotnet\dotnet.exe'
    if (-not (Test-Path -LiteralPath $candidate)) {
        throw 'dotnet.exe not found. Install the .NET 10 SDK from dotnet.microsoft.com.'
    }
    $dotnet = $candidate
} else { $dotnet = $dotnet.Source }

$selfContained = -not $FrameworkDependent
Write-Output "building  $project"
Write-Output "runtime   win-x64, self-contained=$selfContained"

& $dotnet publish $project `
    -c Release `
    -r win-x64 `
    --self-contained:$selfContained `
    -p:PublishSingleFile=$selfContained `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=none `
    -o $OutDir

if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }

Copy-Item -LiteralPath $sidecar -Destination $OutDir -Force

# Left behind by Sumatra builds before -appdata; it holds the dev box's recent files.
Remove-Item -LiteralPath (Join-Path $OutDir 'SumatraPDF-settings.txt') -Force -ErrorAction SilentlyContinue

$exe = Join-Path $OutDir 'QrPrinterAgent.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "publish produced no $exe" }

Write-Output ''
Write-Output ("folder    {0}  ({1:N1} MB)" -f $OutDir, ((Get-ChildItem $OutDir -File | Measure-Object Length -Sum).Sum / 1MB))
foreach ($file in Get-ChildItem $OutDir -File | Sort-Object Length -Descending) {
    Write-Output ("  {0,-22} {1,8:N1} MB" -f $file.Name, ($file.Length / 1MB))
}

Write-Output ''
Write-Output ('check it    & "{0}" version' -f $exe)
Write-Output ('            & "{0}" doctor' -f $exe)
Write-Output 'on a shop   copy the folder to C:\Program Files\QrPrinter Agent, then in an admin PowerShell:'
Write-Output 'pc            QrPrinterAgent.exe pair <code>'
Write-Output '              QrPrinterAgent.exe service install'
