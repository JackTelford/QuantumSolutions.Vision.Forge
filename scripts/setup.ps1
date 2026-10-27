<#
.SYNOPSIS
Checks for the programs Vision.Forge needs on Windows and, with -Install, installs the missing ones.

.DESCRIPTION
Without switches the script finds Node.js (24.12 or newer), ffmpeg, a browser (Microsoft Edge or
Google Chrome) and Blender 5.2 LTS, prints a table, and when every required program is present runs
"npm ci --ignore-scripts" in the repository and then "node scripts\cli.ts doctor". With -Install each
missing program is installed through winget by its exact package id first. -CheckOnly prints the table
and stops. The script never asks for input; every message says what to do next.

.PARAMETER Install
Install the missing programs through winget before running npm ci and doctor.

.PARAMETER CheckOnly
Print the table and exit: 0 when every required program is present, 1 otherwise.

.PARAMETER SkipBlender
Do not install Blender; the html and three lanes work without it.

.PARAMETER DataDir
Passed to doctor as --data-dir so tools.json lands where the skill reads it.
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$CheckOnly,
    [switch]$SkipBlender,
    [string]$DataDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$minimumNode = [version]'24.12'
$blenderSeries = '5.2'
$blenderVersion = '5.2.3'

function Update-VfProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath;$env:Path"
}

function Find-VfExecutable([string]$Name, [string[]]$Candidates = @()) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -like '*.exe' } | Select-Object -First 1
    if ($null -ne $command) { return $command.Source }
    foreach ($candidate in $Candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $null
}

function Get-VfFirstLine([string[]]$Output) {
    foreach ($line in @($Output)) { if (-not [string]::IsNullOrWhiteSpace($line)) { return $line.Trim() } }
    return ''
}

function Find-VfNode {
    $path = Find-VfExecutable 'node.exe' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if ($null -eq $path) { return [pscustomobject]@{ Path = $null; Version = ''; Ok = $false } }
    $output = & $path --version
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Path = $path; Version = ''; Ok = $false } }
    $text = (Get-VfFirstLine $output).TrimStart('v')
    $parsed = $null
    $ok = [version]::TryParse($text, [ref]$parsed) -and $parsed -ge $minimumNode
    return [pscustomobject]@{ Path = $path; Version = $text; Ok = $ok }
}

function Find-VfFfmpeg {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:FFMPEG)) { $candidates += $env:FFMPEG }
    $candidates += (Join-Path $env:ProgramFiles 'ffmpeg\bin\ffmpeg.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')
    $candidates += 'C:\ffmpeg\bin\ffmpeg.exe'
    $path = $null
    if (-not [string]::IsNullOrWhiteSpace($env:FFMPEG) -and (Test-Path -LiteralPath $env:FFMPEG -PathType Leaf)) { $path = $env:FFMPEG }
    if ($null -eq $path) { $path = Find-VfExecutable 'ffmpeg.exe' $candidates }
    if ($null -eq $path) { return [pscustomobject]@{ Path = $null; Version = ''; Ok = $false } }
    $output = & $path -version
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ Path = $path; Version = ''; Ok = $false } }
    $version = ''
    if ((Get-VfFirstLine $output) -match '^ffmpeg version (\S+)') { $version = $Matches[1] }
    $probe = Join-Path (Split-Path -Parent $path) 'ffprobe.exe'
    $ok = $version -ne '' -and (Test-Path -LiteralPath $probe -PathType Leaf)
    return [pscustomobject]@{ Path = $path; Version = $version; Ok = $ok }
}

function Find-VfBrowser {
    $candidates = @()
    foreach ($root in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if (-not [string]::IsNullOrWhiteSpace($root)) { $candidates += (Join-Path $root 'Microsoft\Edge\Application\msedge.exe') }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:CHROME)) { $candidates += $env:CHROME }
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if (-not [string]::IsNullOrWhiteSpace($root)) { $candidates += (Join-Path $root 'Google\Chrome\Application\chrome.exe') }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $version = (Get-Item -LiteralPath $candidate).VersionInfo.ProductVersion
            if ($null -eq $version) { $version = '' }
            return [pscustomobject]@{ Path = $candidate; Version = $version; Ok = $true }
        }
    }
    return [pscustomobject]@{ Path = $null; Version = ''; Ok = $false }
}

function Get-VfRegistryCommand([string]$Key) {
    $item = Get-ItemProperty -LiteralPath $Key -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    $value = $item.PSObject.Properties['(default)']
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace($value.Value)) { return $null }
    if ($value.Value -match '^\s*"?([^"]*?\.exe)') {
        $exe = $Matches[1]
        if ((Split-Path -Leaf $exe) -ieq 'blender-launcher.exe') { $exe = Join-Path (Split-Path -Parent $exe) 'blender.exe' }
        return $exe
    }
    return $null
}

function Find-VfBlender {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:BLENDER)) { $candidates += $env:BLENDER }
    $candidates += (Join-Path $env:ProgramFiles "Blender Foundation\Blender $blenderSeries\blender.exe")
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Blender Foundation\Blender $blenderSeries\blender.exe")
    foreach ($hive in @('HKLM:', 'HKCU:')) {
        $fromRegistry = Get-VfRegistryCommand "$hive\SOFTWARE\Classes\blender.$blenderSeries\shell\open\command"
        if ($null -ne $fromRegistry) { $candidates += $fromRegistry }
    }
    $onPath = Get-Command 'blender.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $onPath) { $candidates += $onPath.Source }
    foreach ($candidate in $candidates) {
        if ($candidate -match '[\\/]WindowsApps[\\/]') { continue }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $output = & $candidate --version
        if ($LASTEXITCODE -ne 0) { continue }
        $version = ''
        foreach ($line in @($output)) { if ($line -match '^\s*Blender\s+(\d+\.\d+\.\d+)') { $version = $Matches[1]; break } }
        return [pscustomobject]@{ Path = $candidate; Version = $version; Ok = $version.StartsWith("$blenderSeries.") }
    }
    return [pscustomobject]@{ Path = $null; Version = ''; Ok = $false }
}

function Install-VfWingetPackage([string]$Id, [string]$Purpose, [string[]]$ExtraArguments = @()) {
    $winget = Find-VfExecutable 'winget.exe'
    if ($null -eq $winget) { throw "winget was not found. Install 'App Installer' from the Microsoft Store, or install $Id by hand, then run Setup-VisionForge.cmd again." }
    Write-Host "Installing $Purpose ($Id). Windows may ask you to approve the installer."
    & $winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity @ExtraArguments
    if ($LASTEXITCODE -ne 0) { throw "Installation of $Id failed (exit $LASTEXITCODE). Install it by hand, then run Setup-VisionForge.cmd again." }
    Update-VfProcessPath
}

function Get-VfStatus {
    return [pscustomobject]@{
        Node = Find-VfNode
        Ffmpeg = Find-VfFfmpeg
        Browser = Find-VfBrowser
        Blender = Find-VfBlender
    }
}

function Show-VfStatus($Status) {
    $rows = @(
        [pscustomobject]@{ Program = 'Node.js 24.12+'; Found = $Status.Node.Ok; Version = $Status.Node.Version; Path = $Status.Node.Path; Install = 'winget install --id OpenJS.NodeJS.LTS --exact' },
        [pscustomobject]@{ Program = 'ffmpeg + ffprobe'; Found = $Status.Ffmpeg.Ok; Version = $Status.Ffmpeg.Version; Path = $Status.Ffmpeg.Path; Install = 'winget install --id Gyan.FFmpeg --exact' },
        [pscustomobject]@{ Program = 'Edge or Chrome'; Found = $Status.Browser.Ok; Version = $Status.Browser.Version; Path = $Status.Browser.Path; Install = 'Edge ships with Windows 11; or install Google Chrome' },
        [pscustomobject]@{ Program = "Blender $blenderSeries LTS (optional)"; Found = $Status.Blender.Ok; Version = $Status.Blender.Version; Path = $Status.Blender.Path; Install = "winget install --id BlenderFoundation.Blender --version $blenderVersion --exact" }
    )
    Write-Host ('{0,-28} {1,-7} {2,-32} {3}' -f 'Program', 'Found', 'Version', 'Path')
    foreach ($row in $rows) {
        $found = if ($row.Found) { 'yes' } else { 'no' }
        $path = if ($null -eq $row.Path) { '-' } else { $row.Path }
        $version = if ([string]::IsNullOrWhiteSpace($row.Version)) { '-' } else { $row.Version }
        Write-Host ('{0,-28} {1,-7} {2,-32} {3}' -f $row.Program, $found, $version, $path)
        if (-not $row.Found) { Write-Host ('{0,-28} install: {1}' -f '', $row.Install) }
    }
    if ($null -ne $Status.Blender.Path -and -not $Status.Blender.Ok) {
        Write-Host "Blender $($Status.Blender.Version) at $($Status.Blender.Path) is not supported; only $blenderSeries.x is. Install $blenderVersion with the command above (two versions can coexist)."
    }
}

Write-Host "Vision.Forge setup (repository: $repositoryRoot)"
$status = Get-VfStatus
Show-VfStatus $status

if ($CheckOnly) {
    if ($status.Node.Ok -and $status.Ffmpeg.Ok -and $status.Browser.Ok) { exit 0 }
    Write-Host 'A required program is missing. Run Setup-VisionForge.cmd -Install to install it, or use the command listed above.'
    exit 1
}

if ($Install) {
    if (-not $status.Node.Ok) { Install-VfWingetPackage 'OpenJS.NodeJS.LTS' 'Node.js 24 to run the command-line program' }
    if (-not $status.Ffmpeg.Ok) { Install-VfWingetPackage 'Gyan.FFmpeg' 'ffmpeg to assemble and check video' }
    if (-not $status.Blender.Ok -and -not $SkipBlender -and $null -eq $status.Blender.Path) {
        Install-VfWingetPackage 'BlenderFoundation.Blender' "Blender $blenderSeries LTS for the blender lane (optional; skipped with -SkipBlender)" @('--version', $blenderVersion)
    }
    $status = Get-VfStatus
    Write-Host ''
    Show-VfStatus $status
}

$missing = @()
if (-not $status.Node.Ok) { $missing += 'Node.js 24.12 or newer' }
if (-not $status.Ffmpeg.Ok) { $missing += 'ffmpeg with ffprobe' }
if (-not $status.Browser.Ok) { $missing += 'Microsoft Edge or Google Chrome' }
if ($missing.Count -gt 0) {
    if ($Install) {
        Write-Host "Still missing after installation: $($missing -join ', '). Open a new terminal (PATH is refreshed at logon) and run Setup-VisionForge.cmd again; if it persists, install with the commands above."
    } else {
        Write-Host "Missing: $($missing -join ', '). Run Setup-VisionForge.cmd -Install to install them, or use the commands above and run setup again."
    }
    exit 1
}
if (-not $status.Blender.Ok) {
    if ($null -ne $status.Blender.Path) {
        Write-Host "Blender $($status.Blender.Version) at $($status.Blender.Path) is not $blenderSeries.x; -Install leaves an existing Blender alone. Install $blenderVersion by hand with: winget install --id BlenderFoundation.Blender --version $blenderVersion --exact (two versions can coexist)."
    } else {
        Write-Host "Blender $blenderSeries LTS is not available; the blender lane is off until it is installed (Setup-VisionForge.cmd -Install, or the command above)."
    }
}

$npm = Join-Path (Split-Path -Parent $status.Node.Path) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { throw "npm was not found next to node at $npm. Reinstall Node.js 24 (winget install --id OpenJS.NodeJS.LTS --exact) and run setup again." }
Write-Host 'Installing the pinned dependencies with npm ci --ignore-scripts.'
Push-Location -LiteralPath $repositoryRoot
try {
    & $npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE). Check the network, delete node_modules, and run setup again." }
    $doctorArguments = @('doctor')
    if (-not [string]::IsNullOrWhiteSpace($DataDir)) { $doctorArguments += @('--data-dir', $DataDir) }
    Write-Host 'Running doctor.'
    & $status.Node.Path (Join-Path $repositoryRoot 'scripts\cli.ts') @doctorArguments
    if ($LASTEXITCODE -ne 0) { throw "doctor exited with code $LASTEXITCODE. Read its message above, fix what it names, and run setup again." }
}
finally {
    Pop-Location
}
Write-Host 'Vision.Forge is ready. Run node scripts\cli.ts doctor any time to see which lanes are available.'
exit 0
