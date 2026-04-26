param(
  [string]$OutputDir = "dist",
  [switch]$NoZip
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktopDir = Join-Path $repoRoot "desktop"
$electronDist = Join-Path $desktopDir "node_modules\electron\dist"
$iconPath = Join-Path $desktopDir "assets\app-icon.ico"

if (!(Test-Path (Join-Path $electronDist "electron.exe"))) {
  throw "Electron runtime was not found. Run: cd desktop; npm install"
}

$distRoot = Join-Path $repoRoot $OutputDir
$portableRoot = Join-Path $distRoot "AI-Dev-portable-win"
$appRoot = Join-Path $portableRoot "app"
$runtimeRoot = Join-Path $portableRoot "electron"

$resolvedDist = [System.IO.Path]::GetFullPath($distRoot)
$resolvedPortable = [System.IO.Path]::GetFullPath($portableRoot)
if (!$resolvedPortable.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside dist folder: $resolvedPortable"
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
if (Test-Path $portableRoot) {
  Remove-Item -LiteralPath $portableRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $portableRoot, $appRoot, $runtimeRoot | Out-Null

Copy-Item -Path (Join-Path $electronDist "*") -Destination $runtimeRoot -Recurse -Force
Copy-Item -Path $desktopDir -Destination (Join-Path $appRoot "desktop") -Recurse -Force
Copy-Item -Path (Join-Path $repoRoot "aidev.py") -Destination (Join-Path $appRoot "aidev.py") -Force
Copy-Item -Path (Join-Path $repoRoot "USAGE.md") -Destination (Join-Path $appRoot "USAGE.md") -Force -ErrorAction SilentlyContinue

$launcherVbs = @'
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(WScript.ScriptFullName)
electron = root & "\electron\electron.exe"
appdir = root & "\app\desktop"
cmd = """" & electron & """ """ & appdir & """"
shell.Run cmd, 1, False
'@
Set-Content -Path (Join-Path $portableRoot "AI Dev.vbs") -Value $launcherVbs -Encoding ASCII

$launcherCmd = @'
@echo off
set "ROOT=%~dp0"
start "" "%ROOT%electron\electron.exe" "%ROOT%app\desktop"
'@
Set-Content -Path (Join-Path $portableRoot "AI Dev.cmd") -Value $launcherCmd -Encoding ASCII

$readme = @'
AI Dev portable for Windows

How to run:
1. Unzip this folder.
2. Double-click "AI Dev.vbs".
3. If Windows blocks the file, right-click it, choose Properties, and press Unblock.

What is included:
- Electron runtime, so Node/Electron does not need to be installed.
- AI Dev desktop UI.
- aidev.py supervisor script.

What is still required for real AI work:
- Codex CLI must be installed and logged in, or the app must be configured to use an API provider.
- Python must be available if you use Supervisor mode.

This portable build is intended for quick sharing with another Windows computer.
For macOS you need a separate macOS build; this Windows package will not run on a MacBook unless the Mac uses a Windows VM.
'@
Set-Content -Path (Join-Path $portableRoot "README-FIRST.txt") -Value $readme -Encoding ASCII

if (Test-Path $iconPath) {
  Copy-Item -Path $iconPath -Destination (Join-Path $portableRoot "AI Dev.ico") -Force
}

if (!$NoZip) {
  $zipPath = Join-Path $distRoot "AI-Dev-portable-win.zip"
  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $zipPath -Force
  Write-Host "Portable ZIP created: $zipPath"
} else {
  Write-Host "Portable folder created: $portableRoot"
}
