# Creates (or removes) the printer queue the bench prints into.
#
# This points a Windows printer at 127.0.0.1:9100, where QrFakePrinter listens.
# It changes this machine's print configuration, so it is a script a person runs
# on purpose, not something the agent does itself.
#
#   add:    powershell -ExecutionPolicy Bypass -File setup-bench-printer.ps1
#   remove: powershell -ExecutionPolicy Bypass -File setup-bench-printer.ps1 -Remove
#
# Both need an elevated window. Start one with: Win+X → Terminal (Admin).
#Requires -RunAsAdministrator

[CmdletBinding()]
param(
    # Undo everything this script added.
    [switch]$Remove,

    # The queue name the dashboard and the CLI type when they pick a printer.
    [string]$Name = 'Bench 9100',

    [string]$Address = '127.0.0.1',

    # 9100 is the raw printing port every network printer on a counter uses.
    [int]$PortNumber = 9100,

    # Where to write a transcript. This normally runs in an elevated window that
    # closes the moment it finishes, so without it there is nothing to read after.
    [string]$Log
)

$ErrorActionPreference = 'Stop'
if ($Log) { Start-Transcript -Path $Log -Force | Out-Null }

# The port name is what the agent's classifier reads, and it decides whether a
# queue counts as a device or as a save-to-file dialog. "127.0.0.1:9100" is read
# as a network port, which is exactly what this queue pretends to be.
$PortName = "${Address}:${PortNumber}"

function Get-ExistingPort {
    Get-PrinterPort -Name $PortName -ErrorAction SilentlyContinue
}

if ($Remove) {
    Write-Output "removing bench printer '$Name'"

    if (Get-Printer -Name $Name -ErrorAction SilentlyContinue) {
        Remove-Printer -Name $Name
        Write-Output '  queue removed'
    }
    else {
        Write-Output '  queue was not there'
    }

    if (Get-ExistingPort) {
        Remove-PrinterPort -Name $PortName
        Write-Output "  port $PortName removed"
    }
    else {
        Write-Output "  port $PortName was not there"
    }

    Write-Output 'Done. Nothing else was touched — your real printers are unchanged.'
    if ($Log) { Stop-Transcript | Out-Null }
    return
}

# --- create ------------------------------------------------------------------

if (-not (Get-ExistingPort)) {
    Write-Output "creating port $PortName"
    # Windows PowerShell 5.1's Add-PrinterPort has no -PrinterPortNumber, and does
    # not need one: the Standard TCP/IP monitor it creates already listens on raw
    # 9100. Naming the port after the address is what makes it findable again.
    Add-PrinterPort -Name $PortName -PrinterHostAddress $Address
}
else {
    Write-Output "port $PortName already exists"
}

if (Get-Printer -Name $Name -ErrorAction SilentlyContinue) {
    Write-Output "printer '$Name' already exists — leaving it as it is"
}
else {
    # 'Generic / Text Only' is the classic bench driver and is not in every
    # Windows 11 install; 'Microsoft Print To PDF' is in-box and writes a real PDF
    # stream to the port, which makes the capture readable. The queue and the
    # bytes-on-the-wire path are identical either way.
    $placed = $null

    foreach ($driver in @('Generic / Text Only', 'Microsoft Print To PDF')) {
        try {
            Add-Printer -Name $Name -DriverName $driver -Port $PortName
            $placed = $driver
            break
        }
        catch {
            Write-Output "  no driver named '$driver' on this machine, trying the next"
        }
    }

    if (-not $placed) {
        Write-Output "neither driver is installed. Add one in Print Management, then run this again."
        if ($Log) { Stop-Transcript | Out-Null }
        exit 1
    }

    Write-Output "created '$Name' on $PortName with driver '$placed'"
}

Get-Printer -Name $Name | Format-List Name, PortName, DriverName, PrinterStatus

Write-Output ''
Write-Output 'Next, from the repo root:'
Write-Output '  1. dotnet run --project agent/tools/QrFakePrinter'
Write-Output '  2. dotnet run --project agent/tools/QrPrinter.MockServer'
Write-Output "  3. agent\src\QrPrinter.Agent\bin\Debug\net10.0\QrPrinterAgent.exe test-print '$Name' agent\bench-sample.pdf"
Write-Output ''
Write-Output 'Undo with: powershell -ExecutionPolicy Bypass -File setup-bench-printer.ps1 -Remove'

if ($Log) { Stop-Transcript | Out-Null }
