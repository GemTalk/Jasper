# Usage: ./gs-download-windows-gci-client.ps1 <version>
#
# Downloads and extracts the native Windows GemStone GCI client for
# <version>, and creates a native Windows lock/log directory for the GCI
# library. Writes "dll-path" and "global-dir" to $env:GITHUB_OUTPUT: values
# only the native Windows side can produce, needed by the "Setup test
# environment" step in setup-gemstone-in-windows/action.yml, which runs
# inside a WSL guest with no way to compute either itself.
#
# Arguments:
#   version   GemStone version (e.g. 3.7.5)

param(
    [Parameter(Mandatory = $true)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'

# The client distribution's name: also its zip's filename stem, and its own
# top-level folder once extracted (Expand-Archive has no flag to flatten
# that away, so $dllPath below still has to walk into it).
$clientFilename = "GemStone64BitClient${Version}-x86.Windows_NT"
$clientZipFile = "$clientFilename.zip"
$downloadUrl = "https://downloads.gemtalksystems.com/pub/GemStone64/${Version}/$clientZipFile"
$clientZipFilePath = Join-Path $env:RUNNER_TEMP $clientZipFile
$extractPath = Join-Path $env:RUNNER_TEMP 'gemstone-windows-client'
$dllPath = Join-Path $extractPath "$clientFilename\bin\libgcits-${Version}-64.dll"

# $extractPath is restored by the caller's "Cache GemStone Windows client
# download" actions/cache step, keyed on $Version; a hit means both the
# download and extraction below are a no-op, same as gs-install.sh's cache
# check for the server archive.
if (Test-Path $dllPath) {
    Write-Host "GCI client already extracted at $dllPath, skipping download."
} else {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $clientZipFilePath
    Expand-Archive -Path $clientZipFilePath -DestinationPath $extractPath
}

if (-not (Test-Path $dllPath)) { throw "Expected GCI DLL not found at $dllPath" }
echo "dll-path=$dllPath" >> $env:GITHUB_OUTPUT

$globalDir = Join-Path $env:RUNNER_TEMP 'gemstone-global'
New-Item -ItemType Directory -Force -Path $globalDir | Out-Null
echo "global-dir=$globalDir" >> $env:GITHUB_OUTPUT
