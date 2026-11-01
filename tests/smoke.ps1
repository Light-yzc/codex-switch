# Compatibility entry point. The same Node.js suite now runs on all platforms.
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    & npm.cmd test
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
