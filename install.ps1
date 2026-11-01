[CmdletBinding()]
param([string]$InstallDirectory = (Join-Path $env:USERPROFILE '.local\bin'))

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
if ($null -eq $npmCommand -or $null -eq (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 20 or newer (with npm), then run this installer again.'
}
& node -e 'process.exit(Number(process.versions.node.split(''.'')[0]) >= 20 ? 0 : 1)'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 20 or newer is required.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('codexsw-install-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($temporary)
$backups = @()
try {
    $packOutput = & $npmCommand.Source pack --silent --json --pack-destination $temporary $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed; existing commands were not changed.' }
    $metadata = ($packOutput -join "`n") | ConvertFrom-Json
    $tarball = Join-Path $temporary $metadata[0].filename
    $null = [IO.Directory]::CreateDirectory($InstallDirectory)
    foreach ($name in @('codexsw', 'codexsw.cmd', 'codexsw.ps1')) {
        $destination = Join-Path $InstallDirectory $name
        if ([IO.File]::Exists($destination)) {
            $backup = $destination + '.bak-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff')
            Copy-Item -LiteralPath $destination -Destination $backup
            $backups += [PSCustomObject]@{ Original = $destination; Backup = $backup }
        }
    }
    & $npmCommand.Source install --global --prefix $InstallDirectory --offline --ignore-scripts --no-audit --no-fund --force $tarball
    if ($LASTEXITCODE -ne 0) {
        foreach ($entry in $backups) { Copy-Item -LiteralPath $entry.Backup -Destination $entry.Original -Force }
        throw 'Installation failed. Previous launchers were restored.'
    }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if ($InstallDirectory.TrimEnd('\') -notin @($entries | ForEach-Object { $_.TrimEnd('\') })) {
        $pathBackup = Join-Path $temporary 'previous-user-path.txt'
        [IO.File]::WriteAllText($pathBackup, [string]$userPath)
        Copy-Item -LiteralPath $pathBackup -Destination (Join-Path $InstallDirectory ('path-before-codexsw-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff') + '.txt'))
        [Environment]::SetEnvironmentVariable('Path', (($entries + $InstallDirectory) -join ';'), 'User')
    }
    if ($InstallDirectory.TrimEnd('\') -notin @($env:Path -split ';' | ForEach-Object { $_.TrimEnd('\') })) {
        $env:Path += ';' + $InstallDirectory
    }
    Write-Host "Installed: $(Join-Path $InstallDirectory 'codexsw.cmd')"
    Write-Host 'Use codexsw 1 / codexsw 2. Existing Windows DPAPI account backups are retained.'
} finally {
    $absolute = [IO.Path]::GetFullPath($temporary)
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\codexsw-install-'
    if ($absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $absolute)) {
        Remove-Item -LiteralPath $absolute -Recurse -Force
    }
}
