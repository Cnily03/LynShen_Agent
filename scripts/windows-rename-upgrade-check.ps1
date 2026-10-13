<#
Checks that an installer built from this tree takes over a released "LynShen"
install: one entry in "Apps & features", the old install directory, shortcuts
and registry entries gone, shortcuts and autostart carried over, user data
untouched. See docs/rename-aogiri-notes.md.

It installs and removes software for the current user and writes to the
registry, so run it only on a throwaway Windows machine (the "Rename upgrade"
workflow runs it on a GitHub runner):

  pwsh scripts/windows-rename-upgrade-check.ps1 `
    -OldSetup LynShen_0.5.0_x64-setup.exe -NewSetup Aogiri_0.5.1_x64-setup.exe `
    -OldMsi LynShen_0.5.0_x64_en-US.msi -NewMsi Aogiri_0.5.1_x64_en-US.msi

The MSI parameters are optional; the MSI scenarios need an elevated shell.
#>
param(
  [Parameter(Mandatory)] [string]$OldSetup,
  [Parameter(Mandatory)] [string]$NewSetup,
  [string]$OldMsi,
  [string]$NewMsi,
  [string]$OldName = 'LynShen',
  [string]$NewName = 'Aogiri',
  [string]$Publisher = 'LynShen Innovations INC.',
  # The version the new installers carry; checked against the uninstall entry.
  [string]$NewVersion,
  # Only these scenarios (default: all that the given installers allow).
  [string[]]$Only
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$OldSetup = (Resolve-Path $OldSetup).Path
$NewSetup = (Resolve-Path $NewSetup).Path
if ($OldMsi) { $OldMsi = (Resolve-Path $OldMsi).Path }
if ($NewMsi) { $NewMsi = (Resolve-Path $NewMsi).Path }

$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$ApprovedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$UninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$VendorKey = "HKCU:\Software\$Publisher"
$StartMenu = [Environment]::GetFolderPath('Programs')
$Desktop = [Environment]::GetFolderPath('Desktop')
$CommonStartMenu = [Environment]::GetFolderPath('CommonPrograms')
$CommonDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$TaskbarPins = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$DefaultOldDir = Join-Path $env:LOCALAPPDATA $OldName
$DefaultNewDir = Join-Path $env:LOCALAPPDATA $NewName
$TestRoot = 'C:\RenameTest'

$script:Failures = @()
$script:Scenario = ''

function Check([bool]$Condition, [string]$What) {
  if ($Condition) {
    Write-Host "  ok    $What"
  } else {
    Write-Host "  FAIL  $What" -ForegroundColor Red
    $script:Failures += "[$script:Scenario] $What"
  }
}

function Note([string]$Text) { Write-Host "  note  $Text" }

# The entries "Apps & features" would list for either product name.
function Get-AppEntries {
  foreach ($root in $UninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if (-not $props) { continue }
      $names = $props.PSObject.Properties.Name
      if ($names -notcontains 'DisplayName') { continue }
      if ($props.DisplayName -ne $OldName -and $props.DisplayName -ne $NewName) { continue }
      if ($names -contains 'SystemComponent' -and $props.SystemComponent -eq 1) { continue }
      [pscustomobject]@{
        Key = $key.Name
        KeyName = $key.PSChildName
        DisplayName = $props.DisplayName
        DisplayVersion = if ($names -contains 'DisplayVersion') { $props.DisplayVersion } else { '' }
        UninstallString = if ($names -contains 'UninstallString') { $props.UninstallString } else { '' }
        InstallLocation = if ($names -contains 'InstallLocation') { $props.InstallLocation } else { '' }
      }
    }
  }
}

function Get-RegValue([string]$Key, [string]$Name) {
  if (-not (Test-Path $Key)) { return $null }
  $item = Get-ItemProperty -LiteralPath $Key -ErrorAction SilentlyContinue
  if ($item -and ($item.PSObject.Properties.Name -contains $Name)) { return $item.$Name }
  return $null
}

function Get-RegDefault([string]$Key) {
  if (-not (Test-Path $Key)) { return $null }
  return (Get-Item -LiteralPath $Key).GetValue('')
}

function Get-ShortcutTarget([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $shell = New-Object -ComObject WScript.Shell
  return $shell.CreateShortcut($Path).TargetPath
}

function New-Shortcut([string]$Path, [string]$Target) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Save()
}

# The executable a Run-key command line starts: quoted, or up to ".exe".
function Get-CommandExe([string]$Command) {
  if ($Command -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($Command -match '^\s*(.+?\.exe)(\s|$)') { return $Matches[1] }
  return $Command
}

function Stop-App {
  foreach ($name in @($OldName, $NewName)) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object {
      try { $_.Kill(); $_.WaitForExit(15000) | Out-Null } catch { }
    }
  }
}

# Runs a program as the updater does (ShellExecute) and waits for that one
# process only: an installer with /R starts the app, which stays running.
function Invoke-Program([string]$File, [string[]]$Arguments, [int]$TimeoutSeconds = 600) {
  Write-Host "  run   $File $($Arguments -join ' ')"
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  $null = $process.Handle # without this PowerShell loses the exit code
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill() } catch { }
    throw "Timed out after $TimeoutSeconds s: $File"
  }
  return $process.ExitCode
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds = 60) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Condition) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return [bool](& $Condition)
}

# Files standing in for what a user has: the installers must leave them alone.
$UserData = @(
  (Join-Path $HOME '.lynshen\rename-check.txt'),
  (Join-Path $HOME '.lynshen\bin\rename-check.txt'),
  (Join-Path $env:APPDATA 'com.lynshen.desktop\rename-check.txt'),
  (Join-Path $env:LOCALAPPDATA 'com.lynshen.desktop\EBWebView\rename-check.txt'),
  (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'LynShen\rename-check.txt')
)

function Set-UserData {
  foreach ($file in $UserData) {
    New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
    Set-Content -LiteralPath $file -Value "user data at $file" -NoNewline
  }
}

function Check-UserData {
  foreach ($file in $UserData) {
    $intact = (Test-Path -LiteralPath $file) -and ((Get-Content -LiteralPath $file -Raw) -eq "user data at $file")
    Check $intact "user data intact: $file"
  }
}

# Removes every trace of both products, so each scenario starts clean.
function Reset-Machine {
  Stop-App
  foreach ($entry in @(Get-AppEntries)) {
    if ($entry.UninstallString -match 'msiexec') {
      Invoke-Program 'msiexec.exe' @('/x', $entry.KeyName, '/quiet', '/norestart') | Out-Null
    } elseif ($entry.UninstallString) {
      $uninstaller = $entry.UninstallString.Trim('"')
      if (Test-Path -LiteralPath $uninstaller) {
        $dir = Split-Path $uninstaller
        # _?= keeps the uninstaller in place, so this waits until it is done.
        Invoke-Program $uninstaller @('/S', "_?=$dir") | Out-Null
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  foreach ($root in $UninstallRoots) {
    foreach ($name in @($OldName, $NewName)) {
      Remove-Item -LiteralPath (Join-Path $root $name) -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $VendorKey -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($name in @($OldName, $NewName)) {
    Remove-ItemProperty -LiteralPath $RunKey -Name $name -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $ApprovedKey -Name $name -ErrorAction SilentlyContinue
    foreach ($folder in @($StartMenu, $Desktop, $TaskbarPins, $CommonDesktop)) {
      Remove-Item -LiteralPath (Join-Path $folder "$name.lnk") -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath (Join-Path $CommonStartMenu $name) -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA $name) -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath 'HKCU:\Software\Classes\lynshen' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
  $left = @(Get-AppEntries)
  if ($left.Count -ne 0) { throw "Could not reset: $($left | ForEach-Object Key)" }
}

function Install-Old([string]$Directory) {
  $arguments = @('/S')
  # /D must be last and is never quoted, even with spaces in it.
  if ($Directory) { $arguments += "/D=$Directory" }
  $code = Invoke-Program $OldSetup $arguments
  if ($code -ne 0) { throw "The $OldName installer returned $code" }
  $dir = if ($Directory) { $Directory } else { $DefaultOldDir }
  if (-not (Test-Path -LiteralPath (Join-Path $dir "$OldName.exe"))) { throw "$OldName did not install to $dir" }
  $entries = @(Get-AppEntries)
  if ($entries.Count -ne 1 -or $entries[0].DisplayName -ne $OldName) { throw "Expected one $OldName entry after installing it" }
  return $dir
}

# What the app writes when "start at login" is turned on (tauri-plugin-autostart
# with the argument --autostart): the Run value and Task Manager's switch.
function Enable-OldAutostart([string]$Directory, [bool]$TurnedOffInTaskManager = $false) {
  $exe = Join-Path $Directory "$OldName.exe"
  New-ItemProperty -Path $RunKey -Name $OldName -Value "$exe --autostart" -PropertyType String -Force | Out-Null
  if (-not (Test-Path $ApprovedKey)) { New-Item -Path $ApprovedKey -Force | Out-Null }
  [byte[]]$state = 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  if ($TurnedOffInTaskManager) {
    # 03, then the time it was switched off
    [byte[]]$state = [byte[]](0x03, 0, 0, 0) + [BitConverter]::GetBytes((Get-Date).ToFileTime())
  }
  New-ItemProperty -Path $ApprovedKey -Name $OldName -Value $state -PropertyType Binary -Force | Out-Null
}

# The state every scenario must end in: one app, registered under the new name.
function Check-Installed([string]$Directory, [string]$Hive = 'HKEY_CURRENT_USER') {
  $entries = @(Get-AppEntries)
  Check ($entries.Count -eq 1) "one entry in Apps & features (found $($entries.Count): $(($entries | ForEach-Object { $_.DisplayName + ' in ' + $_.Key }) -join '; '))"
  if ($entries.Count -ge 1) {
    $entry = $entries | Where-Object DisplayName -eq $NewName | Select-Object -First 1
    Check ($null -ne $entry) "the entry is $NewName"
    if ($entry) {
      Check ($entry.Key.StartsWith($Hive)) "the entry is under $Hive ($($entry.Key))"
      if ($NewVersion) { Check ($entry.DisplayVersion -eq $NewVersion) "the entry has version $NewVersion (is $($entry.DisplayVersion))" }
    }
  }
  $exe = Join-Path $Directory "$NewName.exe"
  Check (Test-Path -LiteralPath $exe) "new executable present: $exe"
  if (Test-Path -LiteralPath $exe) {
    $info = (Get-Item -LiteralPath $exe).VersionInfo
    Check ($info.ProductName -eq $NewName) "its product name is $NewName (is $($info.ProductName))"
  }
  Check (-not (Test-Path -LiteralPath (Join-Path $Directory "$OldName.exe"))) "no $OldName.exe beside it"
}

function Check-OldGone([string]$OldDirectory, [bool]$DirectoryReused = $false) {
  if (-not $DirectoryReused) {
    Check (-not (Test-Path -LiteralPath $OldDirectory)) "old install directory gone: $OldDirectory"
  }
  Check (-not (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$OldName")) "old uninstall key gone"
  Check (-not (Test-Path "$VendorKey\$OldName")) "old install-location key gone"
  Check (-not (Test-Path -LiteralPath (Join-Path $StartMenu "$OldName.lnk"))) "old Start-menu shortcut gone"
  Check (-not (Test-Path -LiteralPath (Join-Path $Desktop "$OldName.lnk"))) "old desktop shortcut gone"
  Check ($null -eq (Get-RegValue $RunKey $OldName)) "old autostart value gone"
  Check ($null -eq (Get-RegValue $ApprovedKey $OldName)) "old Task Manager startup value gone"
}

function Check-Shortcut([string]$Folder, [string]$Directory, [string]$Label) {
  $target = Get-ShortcutTarget (Join-Path $Folder "$NewName.lnk")
  Check ($target -eq (Join-Path $Directory "$NewName.exe")) "$Label shortcut points at the new executable (is '$target')"
}

function Check-DeepLink([string]$Directory) {
  $command = Get-RegDefault 'HKCU:\Software\Classes\lynshen\shell\open\command'
  $expected = '"' + (Join-Path $Directory "$NewName.exe") + '" "%1"'
  Check ($command -eq $expected) "lynshen:// opens the new executable (is '$command')"
}

function Check-Autostart([string]$Directory) {
  $command = Get-RegValue $RunKey $NewName
  Check ($null -ne $command) "autostart value '$NewName' exists"
  if ($command) {
    $exe = Get-CommandExe $command
    Check (Test-Path -LiteralPath $exe) "autostart starts an existing executable (is '$command')"
    Check ($exe -eq (Join-Path $Directory "$NewName.exe")) "autostart starts the new executable"
    Check ($command -match '--autostart\s*$') "autostart keeps the --autostart argument"
  }
  $approved = Get-RegValue $ApprovedKey $NewName
  Check (($null -eq $approved) -or (($approved[0] -band 1) -eq 0)) "autostart is not switched off in Task Manager"
}

function Scenario([string]$Name, [scriptblock]$Body) {
  if ($Only -and ($Only -notcontains $Name)) { return }
  $script:Scenario = $Name
  Write-Host ""
  Write-Host "== $Name" -ForegroundColor Cyan
  Reset-Machine
  Set-UserData
  try {
    & $Body
  } catch {
    Write-Host "  FAIL  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    $script:Failures += "[$Name] $($_.Exception.Message)"
  }
  Check-UserData
  Stop-App
}

# --- The update as real users get it: default location, shortcuts, autostart,
#     a taskbar pin; the new installer run exactly as the updater runs it.
Scenario 'update-default' {
  $old = Install-Old
  Enable-OldAutostart $old
  New-Shortcut (Join-Path $TaskbarPins "$OldName.lnk") (Join-Path $old "$OldName.exe")
  Check ((Get-ShortcutTarget (Join-Path $StartMenu "$OldName.lnk")) -eq (Join-Path $old "$OldName.exe")) "before: $OldName has a Start-menu shortcut"
  Check ((Get-ShortcutTarget (Join-Path $Desktop "$OldName.lnk")) -eq (Join-Path $old "$OldName.exe")) "before: $OldName has a desktop shortcut"

  $code = Invoke-Program $NewSetup @('/P', '/UPDATE', '/R', '/ARGS')
  Check ($code -eq 0) "installer exit code 0 (is $code)"

  Check-Installed $DefaultNewDir
  Check-OldGone $old
  Check ((Get-RegDefault "$VendorKey\$NewName") -eq $DefaultNewDir) "install location recorded for the next update"
  Check-Shortcut $StartMenu $DefaultNewDir 'Start-menu'
  Check-Shortcut $Desktop $DefaultNewDir 'desktop'
  Check-DeepLink $DefaultNewDir
  Check-Autostart $DefaultNewDir
  $pin = Get-ShortcutTarget (Join-Path $TaskbarPins "$OldName.lnk")
  Check ($pin -eq (Join-Path $DefaultNewDir "$NewName.exe")) "the taskbar pin starts the new executable (is '$pin')"

  # /R: the installer starts the app again. It must be the new one.
  $running = Wait-Until { @(Get-Process -Name $NewName -ErrorAction SilentlyContinue).Count -gt 0 } 45
  Check $running "the app is running again as $NewName.exe"
  if ($running) {
    $path = (Get-Process -Name $NewName | Select-Object -First 1).Path
    Check ($path -eq (Join-Path $DefaultNewDir "$NewName.exe")) "it runs from the new directory (is '$path')"
  }
  Check (@(Get-Process -Name $OldName -ErrorAction SilentlyContinue).Count -eq 0) "no $OldName.exe is running"
  Stop-App

  # The next update (new name over new name) must change nothing.
  $code = Invoke-Program $NewSetup @('/P', '/UPDATE')
  Check ($code -eq 0) "second update: exit code 0 (is $code)"
  Check-Installed $DefaultNewDir
  Check-Shortcut $StartMenu $DefaultNewDir 'second update: Start-menu'
  Check-Shortcut $Desktop $DefaultNewDir 'second update: desktop'
  Check-Autostart $DefaultNewDir

  # Uninstalling leaves nothing but the user's data.
  $uninstaller = Join-Path $DefaultNewDir 'uninstall.exe'
  Invoke-Program $uninstaller @('/S') | Out-Null
  # The uninstaller goes on from a copy of itself in %TEMP%; wait for its last steps.
  $gone = Wait-Until { (@(Get-AppEntries).Count -eq 0) -and ($null -eq (Get-RegValue $RunKey $NewName)) } 90
  Check $gone "uninstall: no entry left in Apps & features"
  Check (-not (Test-Path -LiteralPath $DefaultNewDir)) "uninstall: install directory removed"
  Check ($null -eq (Get-RegValue $RunKey $NewName)) "uninstall: autostart value removed"
  Check (-not (Test-Path -LiteralPath (Join-Path $StartMenu "$NewName.lnk"))) "uninstall: Start-menu shortcut removed"
  Check (-not (Test-Path -LiteralPath (Join-Path $Desktop "$NewName.lnk"))) "uninstall: desktop shortcut removed"
}

# --- A user who chose the install location, deleted the desktop shortcut and
#     switched autostart off in Task Manager.
Scenario 'update-custom-location' {
  $chosen = Join-Path $TestRoot "My Apps\$OldName"
  $old = Install-Old $chosen
  Remove-Item -LiteralPath (Join-Path $Desktop "$OldName.lnk") -Force
  Enable-OldAutostart $old $true
  $expected = Join-Path $TestRoot "My Apps\$NewName"

  $code = Invoke-Program $NewSetup @('/P', '/UPDATE')
  Check ($code -eq 0) "installer exit code 0 (is $code)"

  Check-Installed $expected
  Check-OldGone $old
  Check (-not (Test-Path -LiteralPath $DefaultNewDir)) "nothing installed in the default location"
  Check ((Get-RegDefault "$VendorKey\$NewName") -eq $expected) "install location recorded for the next update"
  Check-Shortcut $StartMenu $expected 'Start-menu'
  Check (-not (Test-Path -LiteralPath (Join-Path $Desktop "$NewName.lnk"))) "no desktop shortcut made: the user had removed it"
  Check-DeepLink $expected
  Check ($null -eq (Get-RegValue $RunKey $NewName)) "autostart stays off: it was switched off in Task Manager"

  # The next update finds the app in the same place.
  $code = Invoke-Program $NewSetup @('/P', '/UPDATE')
  Check ($code -eq 0) "second update: exit code 0 (is $code)"
  Check-Installed $expected
  Check (-not (Test-Path -LiteralPath $DefaultNewDir)) "second update: still nothing in the default location"
}

# --- A chosen directory that is not named after the product is reused as it
#     is, and what else is in it stays. Quiet mode (/S), as some set the updater.
Scenario 'update-in-place' {
  $chosen = Join-Path $TestRoot 'tools\agent'
  $old = Install-Old $chosen
  $own = Join-Path $chosen 'my-notes.txt'
  Set-Content -LiteralPath $own -Value 'not the installer''s file'
  Enable-OldAutostart $old

  $code = Invoke-Program $NewSetup @('/S', '/UPDATE')
  Check ($code -eq 0) "installer exit code 0 (is $code)"

  Check-Installed $chosen
  Check-OldGone $old $true
  Check (Test-Path -LiteralPath $own) "the user's own file in the directory is still there"
  Check (-not (Test-Path -LiteralPath $DefaultNewDir)) "nothing installed in the default location"
  Check-Shortcut $StartMenu $chosen 'Start-menu'
  Check-Shortcut $Desktop $chosen 'desktop'
  Check-Autostart $chosen
}

# --- No LynShen on the machine: the hooks must stay out of the way.
Scenario 'fresh-install' {
  $code = Invoke-Program $NewSetup @('/S')
  Check ($code -eq 0) "installer exit code 0 (is $code)"
  Check-Installed $DefaultNewDir
  Check-Shortcut $StartMenu $DefaultNewDir 'Start-menu'
  Check-Shortcut $Desktop $DefaultNewDir 'desktop'
  Check-DeepLink $DefaultNewDir
  Check ($null -eq (Get-RegValue $RunKey $NewName)) "no autostart value appears by itself"
}

if ($OldMsi -and $NewMsi) {
  $programFiles = $env:ProgramFiles

  # --- An MSI install updates with the MSI (the updater picks it by bundle type).
  Scenario 'msi-update' {
    $code = Invoke-Program 'msiexec.exe' @('/i', "`"$OldMsi`"", '/quiet', '/norestart')
    if ($code -ne 0) { throw "msiexec returned $code installing the $OldName MSI" }
    $old = Join-Path $programFiles $OldName
    if (-not (Test-Path -LiteralPath (Join-Path $old "$OldName.exe"))) { throw "$OldName MSI did not install to $old" }
    Enable-OldAutostart $old

    # As the updater runs it: msiexec /i <msi> /passive /promptrestart AUTOLAUNCHAPP=True LAUNCHAPPARGS=""
    $code = Invoke-Program 'msiexec.exe' @('/i', "`"$NewMsi`"", '/passive', '/promptrestart', 'AUTOLAUNCHAPP=True', 'LAUNCHAPPARGS=""')
    Check ($code -eq 0) "msiexec exit code 0 (is $code)"

    $new = Join-Path $programFiles $NewName
    Check-Installed $new 'HKEY_LOCAL_MACHINE'
    Check (-not (Test-Path -LiteralPath $old)) "old install directory gone: $old"
    Check (-not (Test-Path -LiteralPath (Join-Path $CommonDesktop "$OldName.lnk"))) "old desktop shortcut gone"
    Check (-not (Test-Path -LiteralPath (Join-Path $CommonStartMenu "$OldName\$OldName.lnk"))) "old Start-menu shortcut gone"
    $target = Get-ShortcutTarget (Join-Path $CommonDesktop "$NewName.lnk")
    Check ($target -eq (Join-Path $new "$NewName.exe")) "desktop shortcut points at the new executable (is '$target')"
    $target = Get-ShortcutTarget (Join-Path $CommonStartMenu "$NewName\$NewName.lnk")
    Check ($target -eq (Join-Path $new "$NewName.exe")) "Start-menu shortcut points at the new executable (is '$target')"

    $running = Wait-Until { @(Get-Process -Name $NewName -ErrorAction SilentlyContinue).Count -gt 0 } 45
    Check $running "the app is running again as $NewName.exe"
    # The MSI cannot move the autostart value; the app does it when it starts
    # (src-tauri/src/autostart.rs). Give it a moment, then look.
    if ($running) {
      $moved = Wait-Until { ($null -eq (Get-RegValue $RunKey $OldName)) -and ($null -ne (Get-RegValue $RunKey $NewName)) } 30
      Check $moved "the running app moved the autostart value to its own name"
      if ($moved) { Check-Autostart $new }
    }
  }

  # --- The setup.exe run by hand over an MSI install removes the MSI product.
  Scenario 'msi-then-setup' {
    $code = Invoke-Program 'msiexec.exe' @('/i', "`"$OldMsi`"", '/quiet', '/norestart')
    if ($code -ne 0) { throw "msiexec returned $code installing the $OldName MSI" }
    $old = Join-Path $programFiles $OldName

    $code = Invoke-Program $NewSetup @('/S')
    Check ($code -eq 0) "installer exit code 0 (is $code)"
    Check-Installed $DefaultNewDir
    Check (-not (Test-Path -LiteralPath (Join-Path $old "$OldName.exe"))) "the MSI install is gone from $old"
  }
}

Write-Host ""
$script:Scenario = 'cleanup'
Reset-Machine
if ($script:Failures.Count -gt 0) {
  Write-Host "$($script:Failures.Count) check(s) failed:" -ForegroundColor Red
  $script:Failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}
Write-Host "All checks passed." -ForegroundColor Green
