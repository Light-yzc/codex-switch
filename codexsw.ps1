# Compatibility entry point for the original PowerShell script.
$runtime = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $runtime) {
    [Console]::Error.WriteLine('codexsw requires Node.js 20 or newer on PATH.')
    exit 1
}
& $runtime.Source (Join-Path $PSScriptRoot 'bin\codexsw.js') @args
exit $LASTEXITCODE
