<#
Checks that an installer built from this tree takes over a released "LynShen"
install: one entry in "Apps & features", the old install directory, shortcuts
and registry entries gone, shortcuts and autostart carried over, user data
untouched. See docs/rename-aogiri-notes.md.

It installs and removes software for the current user and writes to the
registry, the hosts file and the certificate store, so run it only on a
throwaway Windows machine (the "Rename upgrade" workflow runs it on a GitHub
runner):

  pwsh scripts/windows-rename-upgrade-check.ps1 `
    -OldSetup LynShen_0.5.1_x64-setup.exe -NewSetup Aogiri_0.7.0_x64-setup.exe `
    -OldMsi LynShen_0.5.1_x64_en-US.msi -NewMsi Aogiri_0.7.0_x64_en-US.msi `
    -NewSetupSig Aogiri_0.7.0_x64-setup.exe.sig -NewMsiSig Aogiri_0.7.0_x64_en-US.msi.sig `
    -UpdaterPubkey (Get-Content test-updater.key.pub) -NewVersion 0.7.0

The MSI parameters are optional; the MSI scenarios need an elevated shell.
With the .sig files, the "inapp-" scenarios update the way users do: the old
app runs and finds the update on a local feed (scripts/rename-update-feed.mjs,
Node); "Update now" and "Restart now" are clicked through UI Automation; the
app downloads and verifies the update and starts the installer itself.
-UpdaterPubkey is for installers signed with a test key: the installed old app
is made to trust that key instead of the release key.
#>
param(
  [Parameter(Mandatory)] [string]$OldSetup,
  [Parameter(Mandatory)] [string]$NewSetup,
  [string]$OldMsi,
  [string]$NewMsi,
  # The updater signatures of the new installers (enable the in-app scenarios).
  [string]$NewSetupSig,
  [string]$NewMsiSig,
  # The public key (tauri signer, base64) the .sig files are made with, when
  # it is not the release key.
  [string]$UpdaterPubkey,
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
if ($NewSetupSig) { $NewSetupSig = (Resolve-Path $NewSetupSig).Path }
if ($NewMsiSig) { $NewMsiSig = (Resolve-Path $NewMsiSig).Path }

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
# The Desktop as the user had it when this started; scenarios move it.
$OriginalDesktop = $Desktop
$FolderIdDesktop = [Guid]'B4BFCC3A-DB2C-424C-B029-7FE99A87C641'
Add-Type -Namespace RenameCheck -Name KnownFolder -MemberDefinition @'
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern int SHSetKnownFolderPath(ref Guid id, uint flags, IntPtr token, string path);
'@

# The in-app update: a local https feed the old app is pointed at.
$Repo = Split-Path $PSScriptRoot
$FeedScript = Join-Path $PSScriptRoot 'rename-update-feed.mjs'
$FeedPort = 8443
$FeedRoot = Join-Path ([IO.Path]::GetTempPath()) 'rename-feed'
$FeedDir = Join-Path $FeedRoot 'v1\public\releases\desktop'
$HostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$HostsMark = '# rename-upgrade-check'
# The key the released apps verify updates with (unchanged since 0.4.x).
$ReleasePubkey = (Get-Content (Join-Path $Repo 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).plugins.updater.pubkey
$script:Feed = $null

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

# Shortcuts through IShellLinkW: WScript.Shell goes through the ANSI code page
# and cannot save a name like "LynShen - 快捷方式.lnk" on an English system.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace RenameCheck {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  class ShellLink { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
    void GetIDList(out IntPtr list);
    void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int size);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int size);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    void GetHotkey(out short key);
    void SetHotkey(short key);
    void GetShowCmd(out int show);
    void SetShowCmd(int show);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
    void Resolve(IntPtr window, int flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
  }

  public static class Lnk {
    public static string Target(string path) {
      var link = (IShellLinkW)new ShellLink();
      ((IPersistFile)link).Load(path, 0);
      var target = new StringBuilder(32768);
      link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
      return target.ToString();
    }

    public static void Create(string path, string target) {
      var link = (IShellLinkW)new ShellLink();
      link.SetPath(target);
      ((IPersistFile)link).Save(path, true);
    }
  }
}
'@

function Get-ShortcutTarget([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return [RenameCheck.Lnk]::Target($Path)
}

function New-Shortcut([string]$Path, [string]$Target) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Path) | Out-Null
  [RenameCheck.Lnk]::Create($Path, $Target)
}

# The executable a Run-key command line starts: quoted, or up to ".exe".
function Get-CommandExe([string]$Command) {
  if ($Command -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($Command -match '^\s*(.+?\.exe)(\s|$)') { return $Matches[1] }
  return $Command
}

# Every shortcut to either app, wherever Windows keeps them: the user's Desktop
# (wherever it was moved), the Public Desktop, the user's and the all-users
# Start menu with their folders, and the taskbar pins. A shortcut counts when
# its name or its target has either product name in it.
function Get-AppShortcuts {
  $places = @(
    @('desktop', $script:Desktop, 0),
    @('Public Desktop', $CommonDesktop, 0),
    @('Start-menu', $StartMenu, 1),
    @('all-users Start-menu', $CommonStartMenu, 1),
    @('taskbar pin', $TaskbarPins, 0)
  )
  $names = "(?i)($([regex]::Escape($OldName))|$([regex]::Escape($NewName)))"
  foreach ($place in $places) {
    $label, $folder, $depth = $place
    if (-not (Test-Path -LiteralPath $folder)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Recurse -Depth $depth -ErrorAction SilentlyContinue) {
      $target = "$(Get-ShortcutTarget $file.FullName)"
      if ($file.BaseName -notmatch $names -and $target -notmatch "\\$names(\\|\.exe$)") { continue }
      [pscustomobject]@{ Place = $label; Path = $file.FullName; Name = $file.BaseName; Target = $target }
    }
  }
}

# No shortcut is left that starts the old app (its executable, or anything in
# a directory it was installed in) or that is named after it and starts the
# new one. A taskbar pin keeps its file, which is how Explorer finds it, so it
# only has to start the new executable. Other shortcuts are not the app's.
function Check-NoOldShortcuts([string[]]$OldExes, [string[]]$OldDirectories, [string]$NewDirectory) {
  $newExe = Join-Path $NewDirectory "$NewName.exe"
  $links = @(Get-AppShortcuts)
  foreach ($link in $links) { Note "$($link.Place): $($link.Path) -> '$($link.Target)'" }
  $left = 0
  foreach ($link in $links) {
    $target = $link.Target
    $toOld = $OldExes -contains $target
    foreach ($directory in $OldDirectories) {
      if ($target -and $target.StartsWith("$directory\", [StringComparison]::OrdinalIgnoreCase)) { $toOld = $true }
    }
    $named = $link.Name -like "*$OldName*"
    if ($link.Place -eq 'taskbar pin') {
      if ($named -or $toOld) { Check ($target -eq $newExe) "the taskbar pin '$($link.Name)' starts the new executable (is '$target')" }
      continue
    }
    if ($toOld) {
      Check $false "no $($link.Place) shortcut starts the old app: '$($link.Path)' -> '$target'"
      $left++
    } elseif ($named -and $target -eq $newExe) {
      Check $false "no $($link.Place) shortcut is named after $($OldName): '$($link.Path)'"
      $left++
    }
  }
  if ($left -eq 0) { Check $true "no shortcut starts $OldName or is named after it" }
}

# Moves the user's Desktop the way OneDrive's folder backup or the folder's
# Location tab do: through the known-folder API (files are not moved along).
function Set-DesktopFolder([string]$Path) {
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $id = $FolderIdDesktop
  $result = [RenameCheck.KnownFolder]::SHSetKnownFolderPath([ref]$id, 0, [IntPtr]::Zero, $Path)
  if ($result -ne 0) { throw "SHSetKnownFolderPath returned $result" }
  $script:Desktop = [Environment]::GetFolderPath('Desktop')
  if ($script:Desktop -ne $Path) { throw "the Desktop is $($script:Desktop), not $Path" }
}

# Test builds are signed with a test key; the installed old app is made to
# trust it. The key is a fixed-length string in its executable.
function Set-UpdaterPubkey([string]$Exe, [string]$Pubkey) {
  $Pubkey = $Pubkey.Trim()
  if ($Pubkey.Length -ne $ReleasePubkey.Length) { throw "the test key has $($Pubkey.Length) characters, the release key $($ReleasePubkey.Length)" }
  $bytes = [IO.File]::ReadAllBytes($Exe)
  $text = [Text.Encoding]::Latin1.GetString($bytes)
  $replacement = [Text.Encoding]::ASCII.GetBytes($Pubkey)
  $count = 0
  $at = $text.IndexOf($ReleasePubkey, [StringComparison]::Ordinal)
  while ($at -ge 0) {
    $replacement.CopyTo($bytes, $at)
    $count++
    $at = $text.IndexOf($ReleasePubkey, $at + 1, [StringComparison]::Ordinal)
  }
  if ($count -eq 0) { throw "the release key is not in $Exe" }
  [IO.File]::WriteAllBytes($Exe, $bytes)
  Note "the old app trusts the test key ($count place(s) in $Exe)"
}

# A local https feed laid out as the release publishes it: latest.json with
# the setup.exe and the MSI, the generic Windows entry being the MSI.
function Start-UpdateFeed {
  if ($script:Feed) { return }
  Remove-Item -LiteralPath $FeedRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $FeedDir | Out-Null
  $base = "https://localhost:$FeedPort/v1/public/releases/desktop"
  Copy-Item -LiteralPath $NewSetup -Destination $FeedDir
  $setup = [ordered]@{ signature = (Get-Content -LiteralPath $NewSetupSig -Raw).Trim(); url = "$base/$(Split-Path $NewSetup -Leaf)" }
  $platforms = [ordered]@{ 'windows-x86_64-nsis' = $setup; 'windows-x86_64' = $setup }
  if ($NewMsi -and $NewMsiSig) {
    Copy-Item -LiteralPath $NewMsi -Destination $FeedDir
    $msi = [ordered]@{ signature = (Get-Content -LiteralPath $NewMsiSig -Raw).Trim(); url = "$base/$(Split-Path $NewMsi -Leaf)" }
    $platforms['windows-x86_64-msi'] = $msi
    $platforms['windows-x86_64'] = $msi
  }
  $manifest = [ordered]@{ version = $NewVersion; notes = 'Rename upgrade check'; pub_date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); platforms = $platforms }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $FeedDir 'latest.json')

  # A certificate for localhost from a throwaway CA the machine trusts.
  $ca = New-SelfSignedCertificate -Subject 'CN=Rename Upgrade Check CA' -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyUsage CertSign, CRLSign, DigitalSignature -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') -NotAfter (Get-Date).AddDays(2)
  $leaf = New-SelfSignedCertificate -Subject 'CN=localhost' -DnsName 'localhost' -Signer $ca -CertStoreLocation 'Cert:\CurrentUser\My' `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.1') -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(2)
  $caFile = Join-Path $FeedRoot 'ca.cer'
  Export-Certificate -Cert $ca -FilePath $caFile | Out-Null
  Import-Certificate -FilePath $caFile -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  $pfx = Join-Path $FeedRoot 'localhost.pfx'
  $password = ConvertTo-SecureString 'rename-check' -AsPlainText -Force
  Export-PfxCertificate -Cert $leaf -FilePath $pfx -Password $password -CryptoAlgorithmOption AES256_SHA256 | Out-Null

  $log = Join-Path $FeedRoot 'feed.log'
  $arguments = "`"$FeedScript`" `"$FeedRoot`" `"$pfx`" rename-check $FeedPort"
  $script:Feed = Start-Process -FilePath 'node' -ArgumentList $arguments -NoNewWindow -PassThru `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  # The release feeds are out of reach: the update can only come from here.
  Add-Content -LiteralPath $HostsFile -Value "`r`n127.0.0.1 www.lynshen.org $HostsMark`r`n127.0.0.1 api.lynshen.org $HostsMark"
  $up = Wait-Until {
    try { (Invoke-WebRequest "$base/latest.json" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
  } 30
  if (-not $up) { throw "the update feed did not come up: $(Get-Content "$log.err" -Raw)" }
  Note "update feed at $base (version $NewVersion)"
}

function Stop-UpdateFeed {
  if (-not $script:Feed) { return }
  try { $script:Feed.Kill() } catch { }
  $script:Feed = $null
  $lines = Get-Content -LiteralPath $HostsFile | Where-Object { $_ -notlike "*$HostsMark*" }
  Set-Content -LiteralPath $HostsFile -Value $lines
  Get-ChildItem 'Cert:\LocalMachine\Root', 'Cert:\CurrentUser\My' |
    Where-Object { $_.Subject -in @('CN=Rename Upgrade Check CA', 'CN=localhost') } | Remove-Item -ErrorAction SilentlyContinue
}

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

# The buttons on screen in the windows of process $ProcessId, its WebView
# included (UI Automation stitches the WebView's tree into the window's).
function Get-AppButtons([int]$ProcessId) {
  $element = [System.Windows.Automation.AutomationElement]
  $ofApp = New-Object System.Windows.Automation.PropertyCondition($element::ProcessIdProperty, $ProcessId)
  $isButton = New-Object System.Windows.Automation.PropertyCondition($element::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  foreach ($window in $element::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $ofApp)) {
    foreach ($button in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) { $button }
  }
}

# Clicks, as a user does, the first button named one of $Names in the app
# (its zh and en labels); waits up to $Seconds for it to show.
function Invoke-AppButton([int]$ProcessId, [string[]]$Names, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $seen = @()
  while ((Get-Date) -lt $deadline) {
    try {
      $buttons = @(Get-AppButtons $ProcessId)
      $seen = @($buttons | ForEach-Object { "$($_.Current.Name)".Trim() })
      $button = $buttons | Where-Object { $Names -contains "$($_.Current.Name)".Trim() } | Select-Object -First 1
      if ($button) {
        $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        Note "clicked '$("$($button.Current.Name)".Trim())'"
        return
      }
    } catch {
      # The tree changes while the page renders; look again.
    }
    Start-Sleep -Seconds 1
  }
  throw "no button '$($Names -join "' or '")' in the app; buttons seen: $(($seen | Select-Object -Unique) -join ' | ')"
}

# The update the way users get it: the old app runs and, a few seconds after
# it starts, finds the update on the feed and offers it. "Update now"
# downloads and verifies it; "Restart now" makes the app start the installer
# itself (the updater plugin) and exit. The installer then starts the new app.
function Invoke-InAppUpdate([string]$OldExe) {
  Start-UpdateFeed
  if ($UpdaterPubkey) { Set-UpdaterPubkey $OldExe $UpdaterPubkey }
  $config = Join-Path $HOME '.lynshen\config.json'
  New-Item -ItemType Directory -Force -Path (Split-Path $config) | Out-Null
  Set-Content -LiteralPath $config -Value "{`"desktop_update_url`": `"https://localhost:$FeedPort`"}"
  $feedLog = Join-Path $FeedRoot 'feed.log'
  $seen = @(Get-Content -LiteralPath $feedLog -ErrorAction SilentlyContinue).Count
  try {
    Write-Host "  run   $OldExe (then update it from inside)"
    $app = Start-Process -FilePath $OldExe -PassThru
    $null = $app.Handle
    Invoke-AppButton $app.Id @('立即更新', 'Update now') 120
    Invoke-AppButton $app.Id @('立即重启', 'Restart now') 180
    Check (Wait-Until { $app.HasExited } 60) "the old app exited to install the update"
  } finally {
    Get-Content -LiteralPath $feedLog -ErrorAction SilentlyContinue | Select-Object -Skip $seen | ForEach-Object { Note "feed  $_" }
    Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue
  }
  Wait-InstalledAndRunning
}

# The installer ran: the setup.exe from %TEMP% as <app>-<version>-installer.exe,
# the MSI through msiexec. Either starts the new app when it is done.
function Wait-InstalledAndRunning {
  $installed = Wait-Until {
    (@(Get-Process | Where-Object { $_.Name -like '*-installer' }).Count -eq 0) -and
    (@(Get-AppEntries | Where-Object { $_.DisplayName -eq $NewName -and $_.DisplayVersion -eq $NewVersion }).Count -eq 1) -and
    (@(Get-Process -Name $NewName -ErrorAction SilentlyContinue).Count -gt 0)
  } 300
  Check $installed "the installer finished and started $NewName.exe"
  # What the new app does when it first starts (src-tauri/src/renamed.rs).
  Start-Sleep -Seconds 10
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
  if ($script:Desktop -ne $OriginalDesktop) { Set-DesktopFolder $OriginalDesktop }
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
      Get-ChildItem -LiteralPath $folder -Filter "*$name*.lnk" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    foreach ($folder in @($StartMenu, $CommonStartMenu, $env:LOCALAPPDATA)) {
      Remove-Item -LiteralPath (Join-Path $folder $name) -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  # What the app records once it has tidied up after the rename (renamed.rs).
  Remove-Item -LiteralPath (Join-Path $env:APPDATA 'com.lynshen.desktop\rename-cleanup.json') -Force -ErrorAction SilentlyContinue
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
  if (-not (Test-Path $RunKey)) { New-Item -Path $RunKey -Force | Out-Null }
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
  Check-NoOldShortcuts @((Join-Path $old "$OldName.exe")) @($old) $DefaultNewDir
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

if ($NewSetupSig -and $NewVersion) {
  # --- The update as users get it: from the running old app, which finds the
  #     update, downloads and verifies it, starts the installer and exits.
  Scenario 'inapp-update' {
    $old = Install-Old
    $oldExe = Join-Path $old "$OldName.exe"
    Enable-OldAutostart $old
    New-Shortcut (Join-Path $TaskbarPins "$OldName.lnk") $oldExe
    Check ((Get-ShortcutTarget (Join-Path $Desktop "$OldName.lnk")) -eq $oldExe) "before: $OldName has a desktop shortcut"

    Invoke-InAppUpdate $oldExe

    Check-Installed $DefaultNewDir
    Check-OldGone $old
    Check-Shortcut $StartMenu $DefaultNewDir 'Start-menu'
    Check-Shortcut $Desktop $DefaultNewDir 'desktop'
    Check-NoOldShortcuts @($oldExe) @($old) $DefaultNewDir
    Check-DeepLink $DefaultNewDir
    Check-Autostart $DefaultNewDir
    $path = (Get-Process -Name $NewName -ErrorAction SilentlyContinue | Select-Object -First 1).Path
    Check ($path -eq (Join-Path $DefaultNewDir "$NewName.exe")) "the app runs again, from the new directory (is '$path')"
  }

  # --- The same with the Desktop moved elsewhere, as OneDrive's folder backup
  #     does (OneDrive\Desktop) or the folder's Location tab.
  Scenario 'inapp-update-moved-desktop' {
    Set-DesktopFolder (Join-Path $TestRoot 'OneDrive\Desktop')
    $old = Install-Old
    $oldExe = Join-Path $old "$OldName.exe"
    Check ((Get-ShortcutTarget (Join-Path $Desktop "$OldName.lnk")) -eq $oldExe) "before: the $OldName desktop shortcut is on the moved Desktop ($Desktop)"

    Invoke-InAppUpdate $oldExe

    Check-Installed $DefaultNewDir
    Check-OldGone $old
    Check-Shortcut $Desktop $DefaultNewDir 'desktop'
    Check-NoOldShortcuts @($oldExe) @($old) $DefaultNewDir
  }
}

# --- Shortcuts that start the app but that its installer did not make: a copy
#     the user made, one on the Public Desktop (all users) left by an MSI
#     install whose files are gone, and one named after the app that is not
#     the app's (it stays). In-app update when the signatures are given.
Scenario 'leftover-shortcuts' {
  $chosen = Join-Path $TestRoot "My Apps\$OldName"
  $old = Install-Old $chosen
  $oldExe = Join-Path $old "$OldName.exe"
  $msiExe = Join-Path $env:ProgramFiles "$OldName\$OldName.exe"
  New-Shortcut (Join-Path $Desktop "$OldName - 快捷方式.lnk") $oldExe
  New-Shortcut (Join-Path $CommonDesktop "$OldName.lnk") $msiExe
  $notes = Join-Path $TestRoot "$OldName notes.txt"
  Set-Content -LiteralPath $notes -Value 'not the app'
  New-Shortcut (Join-Path $Desktop "$OldName notes.lnk") $notes
  $expected = Join-Path $TestRoot "My Apps\$NewName"

  if ($NewSetupSig -and $NewVersion) {
    Invoke-InAppUpdate $oldExe
  } else {
    $code = Invoke-Program $NewSetup @('/P', '/UPDATE', '/R', '/ARGS')
    Check ($code -eq 0) "installer exit code 0 (is $code)"
    Wait-Until { @(Get-Process -Name $NewName -ErrorAction SilentlyContinue).Count -gt 0 } 45 | Out-Null
    Start-Sleep -Seconds 10
  }

  Check-Installed $expected
  Check-OldGone $old
  Check-Shortcut $Desktop $expected 'desktop'
  Check-NoOldShortcuts @($oldExe, $msiExe) @($old, (Split-Path $msiExe)) $expected
  Check ((Get-ShortcutTarget (Join-Path $Desktop "$OldName notes.lnk")) -eq $notes) "a shortcut that is not the app's stays"
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
  Check-NoOldShortcuts @((Join-Path $old "$OldName.exe")) @($old) $expected
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
  Check-NoOldShortcuts @((Join-Path $old "$OldName.exe")) @() $chosen
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
    Check-NoOldShortcuts @((Join-Path $old "$OldName.exe")) @($old) $new

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

  if ($NewMsiSig -and $NewVersion) {
    # --- An MSI install updated from the running app (the updater takes the
    #     MSI for it, by the bundle type in its executable).
    Scenario 'inapp-msi-update' {
      $code = Invoke-Program 'msiexec.exe' @('/i', "`"$OldMsi`"", '/quiet', '/norestart')
      if ($code -ne 0) { throw "msiexec returned $code installing the $OldName MSI" }
      $old = Join-Path $programFiles $OldName
      $oldExe = Join-Path $old "$OldName.exe"

      Invoke-InAppUpdate $oldExe

      $new = Join-Path $programFiles $NewName
      Check-Installed $new 'HKEY_LOCAL_MACHINE'
      Check (-not (Test-Path -LiteralPath $old)) "old install directory gone: $old"
      Check-NoOldShortcuts @($oldExe) @($old) $new
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
Stop-UpdateFeed
if ($script:Failures.Count -gt 0) {
  Write-Host "$($script:Failures.Count) check(s) failed:" -ForegroundColor Red
  $script:Failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}
Write-Host "All checks passed." -ForegroundColor Green
