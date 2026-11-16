<#
.SYNOPSIS
    Vendores the SumatraPDF 64-bit print backend into agent/vendor/sumatra.

.DESCRIPTION
    SumatraPDF is the one genuine third-party runtime this project ships, and the
    GitHub release for it publishes no binary assets - the real builds are hosted
    by the project itself on sumatrapdfreader.org. This script fetches that build
    deliberately, once, at a pinned version and a pinned SHA-256, so the exe that
    ends up inside the signed installer is always a binary a human approved.

    It never writes an unverified binary into the tree: the zip is downloaded to a
    temp directory, hashed, and compared with the pin before anything is extracted.
    A changed pin means a human must confirm the new checksum first (see
    agent/vendor/README.md).

    The portable zip contains only the exe - it carries no licence text - so the
    licence files are fetched from the pinned GitHub tag and hashed too.

.PARAMETER Version
    The SumatraPDF release to vendor. Only versions present in $Pins can be
    fetched, because a version with no pin has no human-approved checksum.

.PARAMETER Force
    Re-download and re-verify even if the expected build is already in place.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File agent\tools\get-sumatra.ps1
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = '3.6.1',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
# The 5.1 progress bar makes Invoke-WebRequest crawl on a 10 MB download.
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Pins. Every value here was produced by a human running the script and
# reading the hash out of the transcript. Editing one is the point at which a
# second human must independently confirm the new checksum.
# ---------------------------------------------------------------------------
$Pins = @{
    '3.6.1' = @{
        # https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip
        # 301 -> www -> 307 -> files.sumatrapdfreader.org ; 10,031,830 bytes
        Zip             = '98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544'
        GitHubTag       = '3.6.1rel'
        # raw.githubusercontent.com/sumatrapdfreader/sumatrapdf/<tag>/COPYING
        License         = '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986'
        # .../COPYING.BSD (the BSD part of src/base and src/mui)
        LicenseBsd      = 'ff33648659aa06892ed13a731588a57006fafee2f848d35f70bf273a13cf9d27'
    }
}

function Get-Sha256 {
    param([string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Invoke-SecureDownload {
    param([string]$Uri, [string]$OutFile)
    # 5.1 does not enable TLS 1.2 by default on every machine.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # Note: no -SkipCertificateCheck here - that is a 7.x-only parameter and we
    # would never want it anyway; an untrusted cert is a reason to stop.
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -MaximumRedirection 10 -TimeoutSec 300
}

$zipTmp     = $null
$extractTmp = $null

try {
    if (-not $Pins.ContainsKey($Version)) {
        throw "no checksum is pinned for SumatraPDF $Version. Add one to `$Pins only after a human has independently confirmed the new SHA-256."
    }
    $pin = $Pins[$Version]

    # agent/tools -> agent/, then agent/vendor/sumatra
    $agentDir  = Split-Path -Parent $PSScriptRoot
    $vendorDir = Join-Path $agentDir 'vendor\sumatra'

    $zipUrl    = "https://www.sumatrapdfreader.org/dl/rel/$Version/SumatraPDF-$Version-64.zip"
    $manifest  = Join-Path $vendorDir 'RELEASE.json'
    $targetExe = Join-Path $vendorDir 'SumatraPDF.exe'

    # --- idempotency -----------------------------------------------------
    if (-not $Force -and (Test-Path -LiteralPath $targetExe) -and (Test-Path -LiteralPath $manifest)) {
        try { $have = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json } catch { $have = $null }
        if ($have -and "$($have.version)" -eq $Version -and "$($have.zip_sha256)".ToLowerInvariant() -eq $pin.Zip) {
            Write-Host "SumatraPDF $Version is already vendored at $targetExe (nothing to do; -Force to refetch)."
            Write-Host "  exe sha256 : $($have.exe_sha256)"
            Write-Host "  signature  : $($have.authenticode_status) - $($have.authenticode_signer)"
            exit 0
        }
    }

    New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null

    # --- download the zip and verify it BEFORE touching the tree ---------
    $work     = Join-Path $env:TEMP ("get-sumatra-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $zipTmp     = Join-Path $work "SumatraPDF-$Version-64.zip"
    $extractTmp = Join-Path $work 'extracted'

    Write-Host "Downloading $zipUrl"
    Invoke-SecureDownload -Uri $zipUrl -OutFile $zipTmp

    $size = (Get-Item -LiteralPath $zipTmp).Length
    $zipHash = Get-Sha256 $zipTmp
    Write-Host ("  {0:N0} bytes, sha256 {1}" -f $size, $zipHash)

    if ($zipHash -ne $pin.Zip) {
        throw "checksum MISMATCH for the downloaded zip. Pinned: $($pin.Zip) Actual: $zipHash. Refusing to write an unverified binary. If the upstream build really changed, a human must confirm the new hash and update `$Pins."
    }
    Write-Host '  checksum matches the pin.'

    # --- extract ---------------------------------------------------------
    Expand-Archive -LiteralPath $zipTmp -DestinationPath $extractTmp -Force

    # The 64-bit portable zip holds a single, version-named exe; match it
    # robustly rather than hard-coding the inner filename.
    $exe = Get-ChildItem -LiteralPath $extractTmp -Recurse -Filter '*.exe' |
           Where-Object { $_.Name -match 'SumatraPDF.*-64(\.exe)?$' } |
           Select-Object -First 1
    if (-not $exe) { throw "no SumatraPDF 64-bit exe found inside the verified zip." }

    Copy-Item -LiteralPath $exe.FullName -Destination $targetExe -Force
    Write-Host "Installed $($exe.Name) -> $targetExe"

    # --- licence ---------------------------------------------------------
    # Keep the licence beside the binary: both GPL-3.0 and the BSD part apply,
    # and a redistributor must ship the notices. The zip itself has no licence
    # file, so fall back to the pinned GitHub tag.
    $licTxt  = Join-Path $vendorDir 'LICENSE.txt'
    $licBsd  = Join-Path $vendorDir 'LICENSE.BSD.txt'
    $zipLic  = Get-ChildItem -LiteralPath $extractTmp -Recurse -File |
               Where-Object { $_.Name -match '^(COPYING|LICENSE|LICEN[CS]E)' } |
               Select-Object -First 1

    if ($zipLic) {
        Copy-Item -LiteralPath $zipLic.FullName -Destination $licTxt -Force
        Write-Host "Licence taken from the archive ($($zipLic.Name))."
        $licHash = Get-Sha256 $licTxt
    } else {
        $rawBase = "https://raw.githubusercontent.com/sumatrapdfreader/sumatrapdf/$($pin.GitHubTag)"
        $tmpCop     = Join-Path $work 'COPYING'
        $tmpCopBsd  = Join-Path $work 'COPYING.BSD'
        Invoke-SecureDownload -Uri "$rawBase/COPYING"     -OutFile $tmpCop
        Invoke-SecureDownload -Uri "$rawBase/COPYING.BSD" -OutFile $tmpCopBsd

        $licHash = Get-Sha256 $tmpCop
        $bsdHash = Get-Sha256 $tmpCopBsd
        if ($licHash -ne $pin.License) {
            throw "licence COPYING checksum mismatch. Pinned: $($pin.License) Actual: $licHash"
        }
        if ($bsdHash -ne $pin.LicenseBsd) {
            throw "licence COPYING.BSD checksum mismatch. Pinned: $($pin.LicenseBsd) Actual: $bsdHash"
        }

        # The zip carries no licence at all, so this text file is the only
        # notice that travels with the binary - say where it came from.
        $header = @(
            "SumatraPDF $Version - licence terms as vendored by agent/tools/get-sumatra.ps1",
            "Source archive : $zipUrl (no licence file is present inside it)",
            "Licence text   : $rawBase/COPYING and $rawBase/COPYING.BSD",
            "Upstream states the code is under the (A)GPLv3 licence with parts of",
            "src/base and src/mui under a BSD licence. Full texts follow.",
            '',
            '=========================================================================',
            'COPYING (GNU General Public License version 3)',
            '========================================================================='
        ) -join "`r`n"
        Set-Content -LiteralPath $licTxt -Value ($header + "`r`n" + (Get-Content -LiteralPath $tmpCop -Raw)) -Encoding UTF8
        Copy-Item -LiteralPath $tmpCopBsd -Destination $licBsd -Force
        Write-Host 'Licence fetched from the pinned GitHub tag and hash-verified.'
    }

    # --- Authenticode ----------------------------------------------------
    # A sidecar we ship inside a signed installer should be signed by upstream.
    $sig = Get-AuthenticodeSignature -LiteralPath $targetExe
    $signer = '(none)'
    if ($sig.SignerCertificate) { $signer = $sig.SignerCertificate.Subject }
    Write-Host "Authenticode: $($sig.Status) - $($sig.StatusMessage)"
    Write-Host "  signer : $signer"
    if ($sig.SignerCertificate) {
        Write-Host "  issuer : $($sig.SignerCertificate.Issuer)"
        Write-Host "  sha1   : $($sig.SignerCertificate.Thumbprint)  valid to: $($sig.SignerCertificate.NotAfter)"
    }
    if ($sig.Status -eq 'HashMismatch') {
        # This is not 'verification unavailable' - the file is not what it was signed as.
        throw "Authenticode hash mismatch on ${targetExe}: the binary does not match its signature. Do not ship it."
    }
    if ($sig.Status -ne 'Valid') {
        # NotSigned / UnknownError (e.g. no network for revocation lookups) are
        # reported but must not fail a build on a machine that cannot check.
        Write-Warning "Authenticode status is '$($sig.Status)' - recorded, not treated as fatal."
    }

    # --- provenance record ----------------------------------------------
    $exeHash = Get-Sha256 $targetExe
    $info = $exe.VersionInfo
    $record = [ordered]@{
        version             = $Version
        zip_url             = $zipUrl
        zip_sha256          = $zipHash
        exe_name            = $exe.Name
        exe_sha256          = $exeHash
        exe_size_bytes      = (Get-Item -LiteralPath $targetExe).Length
        file_version        = "$($info.FileVersion)"
        license             = '(A)GPLv3, with src/base and src/mui under BSD; see LICENSE.txt'
        license_sha256      = $licHash
        authenticode_status = "$($sig.Status)"
        authenticode_signer = $signer
        authenticode_issuer = "$(if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { '' })"
        fetched_utc         = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        fetched_by          = 'agent/tools/get-sumatra.ps1'
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding UTF8
    Write-Host "Provenance written to $manifest"

    # --- what the developer does next ------------------------------------
    Write-Host ''
    Write-Host 'SumatraPDF is vendored. To point the agent at it, either copy'
    Write-Host "  $targetExe"
    Write-Host 'next to QrPrinter.Agent.exe (the default location the agent looks in), or add to'
    Write-Host '  %PROGRAMDATA%\QrPrinter Agent\config.json'
    Write-Host ('  "sumatra_pdf_path": "' + $targetExe + '"')
    Write-Host 'Then confirm with: QrPrinterAgent doctor'
    exit 0
}
catch {
    Write-Host ''
    Write-Host ("get-sumatra FAILED: " + $_.Exception.Message)
    Write-Host 'Nothing was written into the tree unless the line above says otherwise.'
    exit 1
}
finally {
    if ($zipTmp -and (Test-Path -LiteralPath $zipTmp)) {
        Remove-Item -LiteralPath (Split-Path -Parent $zipTmp) -Recurse -Force -ErrorAction SilentlyContinue
    } elseif ($extractTmp -and (Test-Path -LiteralPath $extractTmp)) {
        Remove-Item -LiteralPath (Split-Path -Parent $extractTmp) -Recurse -Force -ErrorAction SilentlyContinue
    }
}
