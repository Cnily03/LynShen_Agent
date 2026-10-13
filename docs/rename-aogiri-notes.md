# Rename to Aogiri: working notes

Branch `feat/rename-aogiri`, first based on `origin/main` c85334d (release
v0.5.0), rebased on c4d61a3 (#11 light theme and frost, #12 long-turn
memory, #13 attachments).
This file is the running record of the rename: findings, decisions and what is
next. It is written as the work goes, so that an interrupted session can be
picked up from here. Newest state is in "Status" at the end.

## The naming rule

Only the desktop product is renamed: **Aogiri** (Chinese name 梧桐).
The engine is still "LynShen", the account is still a "LynShen 账号", and the
gateway, model service, legal entity and domain stay LynShen (lynshen.org).

Must not change: bundle identifier `com.lynshen.desktop`; updater endpoints
and public key; data directories (`~/.lynshen`, the app data dir); the
`lynshen` CLI binary, its repo, `lynshen-cli.ref`, `lynshen-cli.version`;
environment variables, URL schemes, protocol and file names in code; the
GitHub repo name and release URLs.

## Versions in use (from Cargo.lock / pnpm-lock at c85334d)

| Piece | Version |
| --- | --- |
| tauri | 2.12.0 |
| @tauri-apps/cli (prebuilt, embeds tauri-bundler) | 2.12.0 → tauri-bundler **2.10.0** |
| tauri-plugin-updater | 2.13.0 |
| tauri-plugin-autostart | 2.6.0 (auto-launch 0.5.0) |
| tauri-plugin-single-instance | 2.5.0 |
| tauri-plugin-deep-link | 2.5.0 |

tauri-bundler is not in `~/.cargo/registry` (the CLI is the npm prebuilt
binary). I read its source from the crates.io tarball of 2.10.0
(`src/bundle/windows/nsis/installer.nsi`, `utils.nsh`).

## Finding 1: what the NSIS template derives from the product name

`installer.nsi` of tauri-bundler 2.10.0. `PRODUCTNAME` is `productName`,
`MANUFACTURER` is `bundle.publisher` ("LynShen Innovations INC."),
`MAINBINARYNAME` is the main binary name, `BUNDLEID` is the identifier.

| What | Where | Derived from |
| --- | --- | --- |
| Uninstall entry ("Apps & features") | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}` | product name |
| Saved install location, installer language | `HKCU\Software\${MANUFACTURER}\${PRODUCTNAME}` (default value, `Installer Language`) | product name |
| Default install directory (install mode `currentUser`, the default) | `$LOCALAPPDATA\${PRODUCTNAME}` | product name |
| Start-menu shortcut | `$SMPROGRAMS\${PRODUCTNAME}.lnk` | product name |
| Desktop shortcut | `$DESKTOP\${PRODUCTNAME}.lnk` | product name |
| Autostart value the uninstaller deletes | `HKCU\...\CurrentVersion\Run` value `${PRODUCTNAME}` | product name |
| Deep link | `HKCU\Software\Classes\lynshen\shell\open\command` = `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"` | scheme + exe path |
| WebView and app data the uninstaller may delete | `$APPDATA\${BUNDLEID}`, `$LOCALAPPDATA\${BUNDLEID}` | identifier (unchanged) |
| Shortcut AppUserModelID (toast notifications) | `${BUNDLEID}` | identifier (unchanged) |

So a renamed installer shares nothing with the LynShen install except the
identifier-keyed data: without a migration it installs a second app in
`%LOCALAPPDATA%\Aogiri` with its own uninstall entry, and leaves the LynShen
directory, shortcuts, uninstall entry and `Run` value behind.

Order of events in the template that the migration has to fit into:

1. `.onInit`: reads `/P` (passive), `/NS` (no shortcuts), `/UPDATE`. With no
   `/D=`, `$INSTDIR` is `$LOCALAPPDATA\${PRODUCTNAME}`, then
   `RestorePreviousInstallLocation` replaces it with the value saved under
   `HKCU\Software\${MANUFACTURER}\${PRODUCTNAME}`. The first Aogiri installer
   finds nothing there, so a custom LynShen location is not carried over.
2. `PageReinstall` looks only at `Uninstall\${PRODUCTNAME}`: it does not see
   the LynShen install.
3. Section `Install`: `SetOutPath $INSTDIR`, then **`NSIS_HOOK_PREINSTALL`**,
   then `CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe"` (Restart
   Manager on that one path: a running `…\LynShen\LynShen.exe` is not seen),
   then the files, the deep-link keys, `WriteUninstaller`, the registry
   entries, the shortcuts, then **`NSIS_HOOK_POSTINSTALL`**.
4. Shortcuts: `CreateOrUpdateStartMenuShortcut` and
   `CreateOrUpdateDesktopShortcut` return early when `$UpdateMode = 1` (and
   with `/NS`). An updater-run install therefore creates **no** Aogiri
   shortcuts by itself.
5. `.onInstSuccess`: in passive or silent mode with `/R`, runs
   `$INSTDIR\${MAINBINARYNAME}.exe` with the `/ARGS` value.

The uninstaller (old one, shipped with 0.5.0): deletes the files it
installed, the `lynshen` deep-link key if it still points at its own exe, the
uninstall key; unless `/UPDATE` it also unpins and deletes the shortcuts that
target its exe and deletes the `Run` value `LynShen`. It deletes app data only
when the checkbox on its confirm page is ticked, which a silent run cannot do.
`HKCU\Software\LynShen Innovations INC.\LynShen` is left in place unless that
checkbox is ticked.

## Finding 2: how the updater runs the installer on Windows

tauri-plugin-updater 2.13.0, `src/updater.rs` (`install_inner`,
`updater_parameters`), `src/config.rs` (`nsis_args`):

- The downloaded bytes are written to
  `%TEMP%\<app name>-<version>-updater-XXXX\<app name>-<version>-installer.exe`.
- It is started with `ShellExecuteW("open", …)` and the parameters
  `/P /UPDATE /R /ARGS <the running app's own arguments>` (install mode
  `passive` is the default and the config sets no other; no `/D=`).
- Then the app calls `std::process::exit(0)`.

So the upgrade is: new installer, passive, update mode, relaunch on success.
The CI job runs the installer with exactly these switches.

## Finding 3: what the updater does on macOS

Same file, `#[cfg(target_os = "macos")] install_inner`:

- `extract_path` is the installed bundle: the parent of `Contents/MacOS` of
  the running executable, e.g. `/Applications/LynShen.app`.
- Every archive entry is unpacked with its first path component dropped
  (`entry.path()?.iter().skip(1)`), into a temp directory. The top-level
  folder name in the archive (`Aogiri.app`) is thrown away.
- The installed bundle is moved to a backup temp directory and the temp
  directory is renamed to `extract_path`. With no write permission it runs
  `rm -rf '<bundle>' && mv -f '<new>' '<bundle>'` through AppleScript with
  administrator privileges.

Result: the bundle keeps its path and file name on disk
(`/Applications/LynShen.app`); only its contents become Aogiri.

Relaunch: the frontend calls the process plugin's `relaunch`, which is
`tauri::process::restart`. In tauri 2.12.0 (`src/process.rs`,
`restart_macos_app`) it reads `CFBundleExecutable` from the bundle's
`Info.plist` and starts that, with the comment "on macOS on updates the binary
name might have changed". A changed main binary name therefore still
relaunches on macOS.

## Finding 4: what the updater does on Linux

- AppImage: the running AppImage file is overwritten in place
  (`install_appimage`); its path and file name do not change.
- deb: `pkexec dpkg -i <tmp>/package.deb`; rpm: `pkexec rpm -U …`.
- Relaunch is `Command::new(current_binary)`: the AppImage path, or the path
  of the running executable (`/usr/bin/LynShen` for a deb or rpm install).

## Finding 5: autostart, single instance, deep link, other stored names

**Autostart** is `tauri-plugin-autostart` 2.6.0 (auto-launch 0.5.0), set up in
`src-tauri/src/autostart.rs` with `MacosLauncher::LaunchAgent` and the argument
`--autostart`. The entry's name is `app.package_info().name`, which
tauri-codegen takes from `productName`. It stores the path of the running
executable:

| OS | Entry | Content |
| --- | --- | --- |
| Windows | `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`, value `LynShen` (REG_SZ) | `<exe path> --autostart` (path not quoted) |
| Windows | `HKCU\…\Explorer\StartupApproved\Run`, value `LynShen` (REG_BINARY, 12 bytes) | `02 00…` enabled; Task Manager writes `03` + a time to disable |
| macOS | `~/Library/LaunchAgents/LynShen.plist`, `Label` `LynShen` | `ProgramArguments`: `<bundle>/Contents/MacOS/LynShen`, `--autostart` |
| Linux | `~/.config/autostart/LynShen.desktop` | `Exec=<AppImage path or /usr/bin/LynShen> --autostart` |

`is_enabled()` only looks for the entry under the current name. After the
rename the app looks for `Aogiri`, reports "off", and the `LynShen` entry stays
behind, pointing at a path that may be gone. Every platform needs a migration.

**Single instance** (`tauri-plugin-single-instance` 2.5.0) is keyed on the
identifier, not on the product or executable name: Windows mutex
`com.lynshen.desktop-sim` and window class `com.lynshen.desktop-sic`; Linux
D-Bus name `com.lynshen.desktop.SingleInstance`; macOS socket
`/tmp/com_lynshen_desktop_si.sock`. Unchanged by the rename.

**Deep link** `lynshen://` (scheme unchanged). Windows: the installer writes
`HKCU\Software\Classes\lynshen` with the new exe path; the app also calls
`register_all()` at start. Linux: the deb/rpm `.desktop` file carries
`MimeType=x-scheme-handler/lynshen`; at start the plugin also writes
`~/.local/share/applications/<exe file name>-handler.desktop` (`NoDisplay=true`)
and makes it the default with `xdg-mime`. A renamed executable writes
`Aogiri-handler.desktop` and leaves `LynShen-handler.desktop` behind.
macOS: LaunchServices, by bundle.

**Data that does not move** (all keyed on the identifier or on fixed paths):
`~/.lynshen` (config, auth, daemon, logs, the app's CLI copy in
`~/.lynshen/bin`), the app config dir (`secret.key`, window state), WebView
data (`%LOCALAPPDATA%\com.lynshen.desktop\EBWebView`,
`~/Library/WebKit/com.lynshen.desktop`, `~/.local/share/com.lynshen.desktop`),
`~/Documents/LynShen` (folder for chats outside a project, `lib.rs`
`chat_root`). The daemon runs from `~/.lynshen/bin/lynshen`, not from the
install directory (`app_cli.rs`), so it survives the move of the install
directory and keeps its firewall rule (rules are keyed on the program path).

**Firewall**: the main executable only listens on `127.0.0.1` (`preview.rs`),
which Windows Firewall does not ask about. The LAN phone page is served by the
daemon, whose path does not change. No new prompt is expected from the rename.

**Wire identifiers** (unchanged, verified against the gateway source):
`client_id: "lynshen-desktop"` in `monoize_auth.rs`; the gateway compares it
to `const CLIENT: &str = "lynshen-desktop"` (`src/desktop_authorization.rs`).
Also `lynshen-web` (web chat OAuth client), originator `lynshen-daemon`, the
`User-Agent: LynShen-Desktop` sent to api.github.com by the Git installer
script, and the HTTP header `X-LynShen-Group` set by the engine.

## Finding 6: there is also an MSI, and latest.json points Windows at it

The v0.5.0 release has `LynShen_0.5.0_x64_en-US.msi` (README offers it;
the website catalog offers only the NSIS installer). `latest.json` has
`windows-x86_64-nsis` (the setup.exe), `windows-x86_64-msi` and the generic
`windows-x86_64` → **MSI**. The updater asks for `<os>-<arch>-<bundle type>`
first, so an NSIS install updates with the NSIS installer and an MSI install
with the MSI.

WiX template (`msi/main.wxs`, `msi/mod.rs`): the `UpgradeCode` defaults to
`uuid5(DNS, "<productName>.exe.app.x64")`. For LynShen that is
`d4dbe261-d530-5c4b-98dc-bf1c243b18ab` (`tauri inspect wix-upgrade-code`
agrees); for Aogiri it would be `786925c8-…`. With a new upgrade code the
Aogiri MSI does not remove the LynShen MSI: two products. The upgrade code has
to be pinned in `bundle.windows.wix.upgradeCode`.

Also from the template: the old package skips `RemoveShortcuts` during a major
upgrade (`Installed AND NOT UPGRADINGPRODUCTCODE`), so its `LynShen.lnk`
shortcuts (Public Desktop, `Start Menu\Programs\LynShen\`) stay, now
pointing at a removed exe. The install directory search reads
`HKCU\Software\<manufacturer>\<productName>`, so a custom MSI directory is not
carried over.

## Finding 7: Linux package names

From the 0.5.0 deb: `Package: lyn-shen` (kebab case of the product name),
files `/usr/bin/LynShen`, `/usr/bin/lynshen-cli`,
`/usr/share/applications/LynShen.desktop`,
`/usr/share/icons/hicolor/*/apps/LynShen.png`. The rpm has the same name and
files. tauri-bundler 2.10.0 supports `provides`, `conflicts`, `replaces` for
deb and `provides`, `conflicts`, `obsoletes` for rpm (`linux/debian.rs`,
`linux/rpm.rs`), and custom `files` for both.

The new package is `aogiri`. It also ships `/usr/bin/lynshen-cli`, so without
`Replaces` dpkg refuses to install it over `lyn-shen`.

## Finding 8: release plumbing and the gateway

- `scripts/prepare-desktop-release.mjs` picks installers by suffix
  (`_<version>_x64-setup.exe`, `_<version>_aarch64.dmg`, …,
  `-<version>-1.x86_64.rpm`) and updater files by the URL in `latest.json`.
  No `LynShen` prefix is assumed.
- `scripts/receive-desktop-release.py` (a copy runs on the server) accepts any
  file name matching `[A-Za-z0-9_+.-]+` that the manifests name.
  `publish-desktop-release.py` and `.sh` handle no file names.
- The gateway serves the release directory with `ServeDir`
  (`src/desktop_distribution.rs`), and its download page
  (`frontend/src/lib/desktop-downloads.ts`) reads `catalog.json` by the six
  platform keys and checks only the URL's origin and path prefix.

So no script and no server copy needs a change for the new file names; the
tests get cases with `Aogiri_…` names to keep it that way.

## Finding 9: what the gateway keys on the desktop's name

Read in the gateway source (Monoize, read-only):

- `client_id: "lynshen-desktop"` (finding 5) is the OAuth client.
- The device key the gateway issues is named `LynShen Desktop / <id>`
  (`src/dashboard_handlers/api_keys.rs`), and the device seats find desktop
  keys by that prefix (`src/users/devices.rs`, migration
  `m20261006_000128_authorized_devices.rs`: `name LIKE 'LynShen Desktop / %'`).
  The app strips the same prefix in Settings → 授权设备
  (`DevicesSection.svelte`). It is an identifier: it stays.
- Display text only: the consent page ("Authorize LynShen Desktop",
  `client_name` in `src/desktop_authorization.rs`, `frontend/src/locales/*`),
  the download page heading (`frontend/src/pages/download.tsx`) and the
  dashboard docs. Changing these is a gateway change of its own; nothing in
  the app depends on them.

## Decisions

1. **The main executable is renamed to `Aogiri`** (`Aogiri.exe`,
   `Contents/MacOS/Aogiri`, `/usr/bin/Aogiri`) by renaming the cargo
   `[[bin]]`; `mainBinaryName` is not set, so the bundles use the cargo name.
   Reasons: the install directory moves on Windows in any case, so keeping
   `LynShen.exe` would save nothing there; the name shows in Task Manager's
   details, in paths the user reads, and as the Linux command. What it costs
   and how it is covered:
   - Windows relaunch: the installer runs `$INSTDIR\Aogiri.exe` itself (`/R`).
   - macOS relaunch: tauri 2.12.0 (every LynShen release since 0.4.16 was
     built with it) reads `CFBundleExecutable` after the update.
   - Linux deb/rpm relaunch: the old app restarts `/usr/bin/LynShen`. The new
     packages ship a small `/usr/bin/LynShen` launcher
     (`packaging/linux/LynShen`) that execs `/usr/bin/Aogiri`.
   - Autostart entries store the executable path: migrated (below).
2. **Windows NSIS**: migration in installer hooks
   (`src-tauri/windows/hooks.nsh`), see "Windows" below.
3. **Windows MSI**: the upgrade code is pinned to LynShen's
   (`d4dbe261-d530-5c4b-98dc-bf1c243b18ab`), and a WiX fragment
   (`src-tauri/windows/rename.wxs`) removes what the old MSI leaves.
4. **Autostart**: migrated twice. The NSIS hook rewrites the `Run` value at
   install time; the app itself (`src-tauri/src/renamed.rs`) moves any
   `LynShen` entry to `Aogiri` at start-up (covers MSI, macOS, Linux and
   anything the hook missed). An entry is only taken when it carries the
   app's own `--autostart` argument; one switched off in Task Manager stays
   off.
5. **macOS bundle on disk**: left where it is (see "macOS" below).
6. **Linux**: `aogiri` replaces `lyn-shen` through package metadata.
7. **Names in the UI**: zh and en strings both say "Aogiri" for the app; the
   Chinese name 梧桐 is given where the app is introduced (README, install
   guide, AGENTS.md). The web app at app.lynshen.org (web chat and the phone
   remote page) is one PWA (`manifest.webmanifest`, scope `/`), so it is
   named Aogiri as a whole; its sign-in stays "LynShen 账号".
8. **Icons**: drawn from the phone app's `assets/source/icon.svg` (Aogiri
   repo) by headless Chrome, cut by `pnpm tauri icon`
   (`design/icon/make-aogiri-icons.mjs`): Apple's template with a transparent
   margin for macOS, a rounded square filling the canvas for Windows and
   Linux, full bleed for the PWA. The in-app mark (`src/lib/aogiri-mark.svg`)
   is `mono.svg`'s ember with its eyes cut out. `fg.svg` (the Android
   adaptive foreground) has no desktop use. The LynShen mark
   (`src/lib/lynshen-mark.svg`) stays: it marks the LynShen engine and
   gateway. The old app icon generator (`make-icon.py` and its PNGs) is gone.
9. **The macOS recording hint** names the app as System Settings lists it:
   the bundle's file name (`LynShen` for an updated install, `capture.rs`).
10. **The about page** row reads "Aogiri 版本 / Aogiri version" beside
    "引擎版本 / Engine version": the product and the engine side by side.

## Windows: what the setup.exe does to a LynShen install (hooks.nsh)

Before the template's own install steps (`NSIS_HOOK_PREINSTALL`):

1. Reads the LynShen install location (`HKCU\Software\LynShen Innovations
   INC.\LynShen`). Without a directory page (passive, as the updater runs it,
   or silent) and with no Aogiri location saved yet, it follows a custom
   LynShen location: `<dir>\LynShen` becomes `<dir>\Aogiri`, any other
   directory is reused as it is (only if it is writable).
2. Notes whether the LynShen Start-menu and desktop shortcuts are the old
   install's own (they point at its exe).
3. Runs the old uninstaller in place, silent and in update mode: it closes a
   running LynShen.exe, deletes its files, its uninstall entry and its
   `lynshen://` registration, and leaves shortcuts, the `Run` value and all
   data. Then it deletes the `LynShen` uninstall and location keys, and the
   old directory if it is empty (files the user put there stay). If the old
   exe could not be removed, the old registration stays so the next install
   tries again.
4. Removes a LynShen MSI install (found by DisplayName + Publisher) when the
   setup.exe is run over one by hand.

After the template's install steps (`NSIS_HOOK_POSTINSTALL`):

5. Shortcuts the old install had become `Aogiri.lnk` shortcuts (in update
   mode the template makes none); a taskbar pin keeps its file and gets the
   new target.
6. The `Run` value `LynShen` moves to `Aogiri` with the new path and
   `--autostart`, unless it was switched off in Task Manager
   (`StartupApproved\Run`), in which case it is removed and stays off.

The MSI (rename.wxs): reads where the LynShen MSI was installed before
`RemoveExistingProducts` deletes its record, then removes `Uninstall
LynShen.lnk` and the emptied `Program Files\LynShen`, the `LynShen` Start-menu
folder and its shortcut, and the `LynShen.lnk` on the desktop (the old
package skips `RemoveShortcuts` during a major upgrade). The app moves the
autostart value when it first starts. A custom MSI install directory is not
carried over: the new MSI installs to `Program Files\Aogiri`.

## macOS

- The updater keeps the bundle path (finding 3): an updated install stays
  `/Applications/LynShen.app`, with `CFBundleName` and the executable now
  Aogiri. The menu bar, the About item, the window title and the icon show
  Aogiri; Finder, Launchpad and the privacy lists in System Settings show the
  file name (LynShen), and so, likely, does the Dock label. Renaming the bundle from the app was rejected: it
  would move a running bundle, break Dock items and the login item path, and
  gains little.
- A fresh install from the dmg is `/Applications/Aogiri.app`. A user who also
  installs the dmg over an updated install gets two apps (same identifier,
  same data). The README and the install guide say not to.
- Permissions (microphone, screen recording): TCC keys them on the bundle
  identifier and the signing requirement, both unchanged. With the
  self-signed release identity ("LynShen Self-Signed", unchanged) they
  survive; with an ad-hoc signature they reset on every update, as before.
- The login item: `~/Library/LaunchAgents/LynShen.plist` is replaced by
  `Aogiri.plist` on first start (renamed.rs). macOS may show a "background
  item added: Aogiri" notice.

## Linux

- deb: `Package: aogiri`, `Provides/Conflicts/Replaces: lyn-shen`; rpm:
  `Provides/Obsoletes: lyn-shen`. Both ship `/usr/bin/Aogiri`,
  `/usr/bin/LynShen` (launcher), `/usr/bin/lynshen-cli`,
  `/usr/share/applications/Aogiri.desktop` (`Exec=Aogiri`, still
  `x-scheme-handler/lynshen`) and `Aogiri.png` icons. `dpkg -i` and
  `rpm -U` of the new package remove `lyn-shen` and its files.
- The deep-link handler file `~/.local/share/applications/LynShen-handler.desktop`
  is removed at start (renamed.rs); the plugin writes `Aogiri-handler.desktop`.
- The autostart entry `~/.config/autostart/LynShen.desktop` becomes
  `Aogiri.desktop`.
- AppImage: updated in place, its file name stays (e.g.
  `LynShen_0.5.0_amd64.AppImage`).
- AUR (`packaging/aur/lynshen-bin`, pinned at 0.4.37): the next bump to an
  Aogiri release must download `Aogiri_${pkgver}_amd64.deb`, chmod
  `/usr/bin/Aogiri` too, and may rename `pkgdesc`. Renaming the AUR package
  itself (`aogiri-bin`) is an owner decision.

## Classification of "LynShen" (at the end of the branch)

On `origin/main` c4d61a3 the tree (lock files aside) had 785 occurrences.
148 meant this app and now say Aogiri (UI strings zh/en, titles, tray, the
remote page, manifest, notifications, README, docs, NOTICE, bundle config).
The 637 that stay, by meaning (approximate counts, sorted by a script
outside the repo and read through): identifiers and code names ~240
(`BackendKind::LynShen`, `LynShenModel`, `LynShen-CLI`, `LynShen_Agent`,
`~/Documents/LynShen`, `LynShen Self-Signed`, `LynShen Desktop / ` device
prefix, git checkpoint author); account, gateway, console, relay, server,
company ~225; the engine and its sessions, skills, MCP config ~130; not
editable or historical ~31 (design.md, release notes, 0.4.x release docs,
AUR at 0.4.37). The branch adds ~205 mentions of the old name in migration
code, upgrade checks, tests and these notes.

Cases that need the owner's decision (current choice in brackets):

- The web chat at app.lynshen.org: brand, tab title and "Message Aogiri"
  [Aogiri, as one PWA with the remote page]. Its system prompt "你是 LynShen
  的 AI 助手" and "和 LynShen 安卓 App 同步" [kept: service and another app].
- The skills marketplace notice "LynShen/Aogiri 不提供安装" (Anthropic's
  document skills) [Aogiri: the app is what does not install them].
- README trademark line "LynShen 名称和图标是 … 的商标" [kept as is: a legal
  claim about Aogiri is not mine to make].
- design.md still says "LynShen Desktop" [not edited, as instructed].
- The gateway's display text "LynShen Desktop" (consent page, download page,
  dashboard docs) [unchanged; a gateway change].

## What an existing user sees after the update

- Before: the old app's prompt "发现新版本 LynShen x.y.z" with the release
  notes. The first Aogiri release's notes must say that LynShen is now
  Aogiri (梧桐) and that data and sign-in stay.
- Windows (setup.exe): the app restarts as Aogiri from
  `%LOCALAPPDATA%\Aogiri` (or `<custom>\Aogiri`); one "Aogiri" entry in Apps &
  features; Start-menu and desktop shortcuts named Aogiri; taskbar pin kept
  and pointing at Aogiri.exe (its file, and so its hover name, stays
  LynShen); start at
  login kept; signed in, same conversations and settings.
- Windows (MSI): Aogiri in `Program Files\Aogiri`, old shortcuts and folder
  gone, start at login moved on first start.
- macOS: Aogiri in the menu bar, window and Dock; the file stays
  LynShen.app, so Finder, Launchpad and System Settings lists say LynShen.
- Linux deb/rpm: package `aogiri`, menu entry Aogiri, `LynShen` still starts
  it; AppImage: same file, new name inside.
- Phone (PWA): a page loaded after the deploy says Aogiri; a home-screen icon
  added before keeps its old name and icon on iOS until added again
  (Android refreshes it from the manifest in time).

## Before the first Aogiri release

1. Release notes `release-notes/<version>.md` announce the rename (the update
   prompt of 0.5.x shows them).
2. Production server: nothing has to be redeployed for the new file names.
   `receive-desktop-release.py` and `publish-desktop-release.py` are
   unchanged on this branch and accept any name matching `[A-Za-z0-9_+.-]+`;
   the gateway serves the directory as files (`ServeDir`) and its download
   page reads `catalog.json` by platform key. Check once that the server's
   copies match the repo's (`sha256sum`), since the tests here cover the
   repo's copies only.
3. Optional, gateway (display only): consent page `client_name` and locales,
   download page heading, dashboard docs. Do not change `lynshen-desktop`
   or the `LynShen Desktop / ` key prefix.
4. Re-run the "Rename upgrade" workflow on the release commit.

## Open risks

1. macOS: two bundles if a user installs the Aogiri dmg over an updated
   LynShen.app; Finder keeps the old name. Not covered by CI (no macOS
   update test: the updater cannot be driven headless here).
2. The Windows test runs as an administrator on a clean runner. Not covered:
   a LynShen.exe that refuses to close (the old uninstaller fails, the hook
   keeps the old registration and the next update retries), per-user
   installs under a roaming profile, antivirus holding the old exe, a
   running old app during the setup.exe (Restart Manager on the old
   uninstaller's side only).
3. Linux autostart and handler moves and the macOS LaunchAgent move are unit
   tested (renamed.rs) but not exercised on a desktop session.
4. The AUR package breaks at its next bump unless updated (see Linux).
5. Gateway text still says "LynShen Desktop" until the gateway changes.

## Status

- [x] Read AGENTS.md, configs, release scripts, NSIS template, updater.
- [x] Autostart, single instance, deep link: how each stores the name (finding 5).
- [x] Bundle configuration, NSIS hooks, MSI upgrade code, Linux package
      metadata and launcher.
- [x] Upgrade workflow and check scripts.
- [x] Rebased on origin/main c4d61a3. Conflicts: window `title` beside the new
      `"create": false` (the app creates the main window itself, from this
      config entry); `windows-version` and `winreg` in one Windows dependency
      table; `renamed::adopt` before `main_window::create`; browser fixtures
      and regressions of #11 and #13 kept, the product-name checks appended.
- [x] WiX fragment wired (`fragmentPaths`, `componentRefs`); "Rename upgrade"
      run 38366445593 green: all Windows scenarios (setup.exe default,
      custom location, in place, fresh, MSI update, setup.exe over MSI) and
      deb/rpm.
- [x] Strings, README, docs, NOTICE, AGENTS.md; classification above.
- [x] Icons regenerated with headless Chrome + `pnpm tauri icon`.
- [x] Release script tests with Aogiri names (prepare, receive).
- [x] Local checks: `pnpm check`, vitest, browser regression, release tests.
- [x] Screenshots in `~/lynshen-wt/desk-rename-shots/`.
- [x] Squashed into six commits, force-pushed, PR #10 description rewritten.
      Final CI run 38369226211 green (frontend; Rust on ubuntu, windows,
      macos-15, macos-15-intel); "Rename upgrade" run 38369226249 green
      (Windows 174 checks, Linux deb and rpm 53 checks).
- Left for the owner: the cases listed under "Classification", the release
  notes of the first Aogiri release, the AUR bump, the gateway's display
  text.
