#!/usr/bin/env bash
# Checks what a released LynShen.app (0.5.x) becomes on a Mac once a build of
# this tree arrives, in the two ways it arrives:
#
# - the in-app update: the updater unpacks the new bundle over the running
#   one, keeping its path (/Applications/LynShen.app), and starts the new
#   executable (tauri-plugin-updater 2.13 install_inner on macOS, tauri 2.12
#   process::restart). The app has to end up as /Applications/Aogiri.app,
#   running from there, with its login item pointing there;
# - a fresh Aogiri.app from the dmg, copied in beside the old LynShen.app: two
#   bundles with one identifier. Nothing may go without the user saying so;
#   the app asks once (renamed.rs).
#
# User data must stay as it is. See docs/rename-aogiri-notes.md.
#
# It installs into and deletes from /Applications, writes LaunchAgents and
# kills the apps, so it only runs on a throwaway Mac (the "Rename upgrade"
# workflow runs it on a GitHub runner) and refuses to run without
# RENAME_CHECK_THROWAWAY=1:
#
#   RENAME_CHECK_THROWAWAY=1 scripts/macos-rename-upgrade-check.sh \
#     LynShen_0.5.1_aarch64.dmg Aogiri_aarch64.app.tar.gz 0.7.0
#
# The archive is what the updater downloads: a tar.gz with Aogiri.app at its top.
set -uo pipefail

old_dmg=${1:?old dmg}
new_archive=${2:?new .app.tar.gz}
new_version=${3:?new version}
[ "${RENAME_CHECK_THROWAWAY:-}" = 1 ] || { echo "refusing to run: this changes /Applications (set RENAME_CHECK_THROWAWAY=1 on a throwaway Mac)"; exit 2; }

old_dmg=$(cd "$(dirname "$old_dmg")" && pwd)/$(basename "$old_dmg")
new_archive=$(cd "$(dirname "$new_archive")" && pwd)/$(basename "$new_archive")
apps=/Applications
old_app=$apps/LynShen.app
new_app=$apps/Aogiri.app
bundle_id=com.lynshen.desktop
agents=$HOME/Library/LaunchAgents
config_dir="$HOME/Library/Application Support/$bundle_id"
marker="$config_dir/rename-cleanup.json"
user_data=(
  "$HOME/.lynshen/rename-check.txt"
  "$config_dir/rename-check.txt"
  "$HOME/Library/WebKit/$bundle_id/rename-check.txt"
  "$HOME/Documents/LynShen/rename-check.txt"
)
failures=0
scenario=''

check() { # check <description> <command...>
  local what=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok    $what"
  else
    echo "  FAIL  $what"
    failures=$((failures + 1))
  fi
}
absent() { ! "$@"; }
note() { echo "  note  $*"; }

plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null; }
version_of() { plist_value "$1/Contents/Info.plist" CFBundleShortVersionString; }
identifier_of() { plist_value "$1/Contents/Info.plist" CFBundleIdentifier; }
# The process started from a bundle's main executable, if any.
running_from() { pgrep -f "^$1/Contents/MacOS/" >/dev/null; }
is_running_new() { running_from "$new_app"; }

stop_apps() {
  pkill -f "^$apps/(LynShen|Aogiri)\.app/Contents/MacOS/" 2>/dev/null
  for _ in $(seq 20); do pgrep -f "^$apps/(LynShen|Aogiri)\.app/Contents/MacOS/" >/dev/null || return 0; sleep 0.5; done
  pkill -9 -f "^$apps/(LynShen|Aogiri)\.app/Contents/MacOS/" 2>/dev/null
}

wait_for() { # wait_for <seconds> <command...>
  local seconds=$1
  shift
  for _ in $(seq $((seconds * 2))); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
  "$@" >/dev/null 2>&1
}

reset() {
  stop_apps
  rm -rf "$old_app" "$new_app" "$HOME/Applications/LynShen.app" "$HOME/Applications/Aogiri.app"
  rm -rf "$HOME/.Trash/LynShen"*.app "$HOME/.Trash/Aogiri"*.app
  rm -f "$agents/LynShen.plist" "$agents/Aogiri.plist" "$marker"
}

set_user_data() {
  for file in "${user_data[@]}"; do mkdir -p "$(dirname "$file")"; echo "user data at $file" >"$file"; done
}

check_user_data() {
  for file in "${user_data[@]}"; do check "user data intact: $file" grep -qx "user data at $file" "$file"; done
}

install_old() {
  local mount
  mount=$(mktemp -d)
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$old_dmg" >/dev/null || { echo "could not mount $old_dmg"; exit 1; }
  ditto "$mount/LynShen.app" "$old_app"
  hdiutil detach "$mount" >/dev/null
  [ "$(identifier_of "$old_app")" = "$bundle_id" ] || { echo "$old_app is not $bundle_id"; exit 1; }
  note "installed $old_app $(version_of "$old_app")"
}

# A fresh install from the dmg: Aogiri.app copied into /Applications.
install_new_beside() {
  local tmp
  tmp=$(mktemp -d)
  tar -xzf "$new_archive" -C "$tmp"
  ditto "$tmp/Aogiri.app" "$new_app"
  rm -rf "$tmp"
}

# What tauri-plugin-autostart 2.6 writes for "start at login" (LaunchAgent).
enable_old_login_item() {
  mkdir -p "$agents"
  cat >"$agents/LynShen.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>LynShen</string>
  <key>ProgramArguments</key>
  <array><string>$old_app/Contents/MacOS/LynShen</string><string>--autostart</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
}

# The in-app update as tauri-plugin-updater 2.13 applies it on macOS: the
# archive is unpacked without its top folder (Aogiri.app) into a temporary
# directory, the running bundle is moved aside and the new one takes its path.
# Then the app relaunches the way tauri::process::restart does: it starts
# <bundle>/Contents/MacOS/<CFBundleExecutable of the new Info.plist> and exits.
update_in_place() { # update_in_place <bundle>
  local bundle=$1 tmp backup exe
  tmp=$(mktemp -d)
  backup=$(mktemp -d)
  tar -xzf "$new_archive" -C "$tmp" --strip-components 1
  mv "$bundle" "$backup/" && mv "$tmp" "$bundle" || { echo "could not swap $bundle"; exit 1; }
  touch "$bundle"
  exe=$(plist_value "$bundle/Contents/Info.plist" CFBundleExecutable)
  note "relaunch: $bundle/Contents/MacOS/$exe"
  nohup "$bundle/Contents/MacOS/$exe" >/dev/null 2>&1 &
  # The old process exits right after it started the new one.
  pkill -f "^$bundle/Contents/MacOS/LynShen" 2>/dev/null
  rm -rf "$backup"
}

check_new_app_in_place() {
  check "$new_app exists" test -d "$new_app"
  check "no $old_app left" absent test -e "$old_app"
  check "$new_app is $bundle_id" test "$(identifier_of "$new_app")" = "$bundle_id"
  check "$new_app has version $new_version (is $(version_of "$new_app"))" test "$(version_of "$new_app")" = "$new_version"
  check "the app runs from $new_app" wait_for 30 is_running_new
  check "nothing runs from $old_app" absent running_from "$old_app"
  check "$new_app is still validly signed" codesign --verify --deep --strict "$new_app"
  note "running: $(pgrep -fl "^$apps/(LynShen|Aogiri)\.app/Contents/MacOS/" | tr '\n' ' ')"
  # What Finder, Launchpad and Spotlight call it: the bundle's file name.
  note "Finder name: $(osascript -l JavaScript -e "ObjC.import('Foundation'); \$.NSFileManager.defaultManager.displayNameAtPath('$new_app').js" 2>&1)"
  note "Spotlight name: $(mdls -raw -name kMDItemDisplayName "$new_app" 2>&1)"
}

check_login_item() {
  local program
  program=$(plist_value "$agents/Aogiri.plist" 'ProgramArguments:0')
  check "the login item is Aogiri.plist" test -f "$agents/Aogiri.plist"
  check "the old login item LynShen.plist is gone" absent test -e "$agents/LynShen.plist"
  check "the login item starts $new_app (is '$program')" test "$program" = "$new_app/Contents/MacOS/Aogiri"
  check "the login item keeps --autostart" test "$(plist_value "$agents/Aogiri.plist" 'ProgramArguments:1')" = --autostart
}

run_scenario() { # run_scenario <name> <function>
  scenario=$1
  echo
  echo "== $scenario"
  reset
  set_user_data
  "$2"
  check_user_data
  stop_apps
}

# --- The update as users get it from the app, over a LynShen.app in
#     /Applications that starts at login.
in_app_update() {
  install_old
  enable_old_login_item
  open "$old_app"
  check "before: the old app runs" wait_for 30 running_from "$old_app"
  update_in_place "$old_app"
  sleep 15
  check_new_app_in_place
  check_login_item
  # Once moved, starting it again changes nothing.
  stop_apps
  open "$new_app"
  check "it starts again from $new_app" wait_for 30 is_running_new
  check "still one bundle: no $old_app" absent test -e "$old_app"
}

# --- A fresh Aogiri.app from the dmg beside the old LynShen.app. Both stay
#     until the user confirms; the question comes once.
fresh_beside_old() {
  install_old
  install_new_beside
  open "$new_app"
  check "the app runs from $new_app" wait_for 30 is_running_new
  sleep 10
  check "$old_app is still there (nothing goes without the user's word)" test -d "$old_app"
  check "$new_app is still there" test -d "$new_app"
  check "the app asked once about $old_app" grep -q "$old_app" "$marker"
  note "marker: $(cat "$marker" 2>&1)"
  local before
  before=$(cat "$marker" 2>/dev/null)
  stop_apps
  open "$new_app"
  check "it starts again" wait_for 30 is_running_new
  sleep 10
  check "the second start does not ask again" test "$(cat "$marker" 2>/dev/null)" = "$before"
  check "$old_app is still there" test -d "$old_app"
}

# --- Both: the updated LynShen.app (new contents) is started, as its Dock item
#     does, while Aogiri.app sits beside it. It cannot take the name; it asks.
updated_beside_new() {
  install_old
  install_new_beside
  open "$old_app"
  check "before: the old app runs" wait_for 30 running_from "$old_app"
  update_in_place "$old_app"
  sleep 15
  check "$old_app is still there (nothing goes without the user's word)" test -d "$old_app"
  check "$new_app is still there" test -d "$new_app"
  check "$old_app now has version $new_version" test "$(version_of "$old_app")" = "$new_version"
  check "the app asked once about the two copies" grep -q "$old_app" "$marker"
  note "marker: $(cat "$marker" 2>&1)"
}

run_scenario in-app-update in_app_update
run_scenario fresh-beside-old fresh_beside_old
run_scenario updated-beside-new updated_beside_new

echo
scenario=cleanup
reset
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."
