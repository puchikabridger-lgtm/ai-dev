$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $root "AI Dev.cmd"
$electron = Join-Path $root "desktop\node_modules\electron\dist\electron.exe"
$appDir = Join-Path $root "desktop"
$icon = Join-Path $root "desktop\assets\app-icon.ico"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "AI Dev.lnk"
$startMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) "AI Dev"
$startMenuShortcut = Join-Path $startMenuDir "AI Dev.lnk"

if (!(Test-Path $launcher)) {
  throw "Launcher not found: $launcher"
}
if (!(Test-Path $electron)) {
  throw "Electron executable not found: $electron"
}

New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

$shell = New-Object -ComObject WScript.Shell

foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $electron
  $shortcut.Arguments = "`"$appDir`""
  $shortcut.WorkingDirectory = $root
  $shortcut.Description = "AI Dev"
  $shortcut.IconLocation = $icon
  $shortcut.Save()
}

$commandKey = "HKCU:\Software\Classes\Directory\shell\AI Dev"
$commandSubKey = Join-Path $commandKey "command"
New-Item -Force -Path $commandKey | Out-Null
New-Item -Force -Path $commandSubKey | Out-Null
Set-ItemProperty -Path $commandKey -Name "(default)" -Value "Open in AI Dev"
Set-ItemProperty -Path $commandKey -Name "Icon" -Value $icon
Set-ItemProperty -Path $commandSubKey -Name "(default)" -Value "`"$electron`" `"$appDir`" --project `"%1`""

Write-Host "Installed AI Dev shortcuts:"
Write-Host "Desktop: $desktopShortcut"
Write-Host "Start Menu: $startMenuShortcut"
Write-Host "Explorer folder menu: Open in AI Dev"
