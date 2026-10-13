#!/usr/bin/env bash
# Checks that packages built from this tree replace the released "LynShen"
# packages: one package left, the old files gone, the new ones in place.
# See docs/rename-aogiri-notes.md.
#
# It installs and removes system packages: run it only on a throwaway machine
# (the "Rename upgrade" workflow runs it on a GitHub runner).
#
#   scripts/linux-rename-upgrade-check.sh deb LynShen_0.5.0_amd64.deb Aogiri_0.5.1_amd64.deb
#   scripts/linux-rename-upgrade-check.sh rpm LynShen-0.5.0-1.x86_64.rpm Aogiri-0.5.1-1.x86_64.rpm
#
# The rpm form runs as root inside a Fedora container and skips dependency
# resolution (--nodeps): it checks what rpm does with the two packages, not
# whether WebKitGTK installs.
set -uo pipefail

kind=${1:?deb or rpm}
old=${2:?old package}
new=${3:?new package}
old_pkg=lyn-shen
new_pkg=aogiri
failures=0

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

files_checks() {
  check "new executable present: /usr/bin/Aogiri" test -x /usr/bin/Aogiri
  check "launcher under the old name present: /usr/bin/LynShen" test -x /usr/bin/LynShen
  check "the old name starts the new executable" grep -q 'exec /usr/bin/Aogiri' /usr/bin/LynShen
  check "the engine sidecar is present: /usr/bin/lynshen-cli" test -x /usr/bin/lynshen-cli
  check "new menu entry present" test -f /usr/share/applications/Aogiri.desktop
  check "the menu entry is named Aogiri" grep -qx 'Name=Aogiri' /usr/share/applications/Aogiri.desktop
  check "the menu entry starts Aogiri" grep -qx 'Exec=Aogiri' /usr/share/applications/Aogiri.desktop
  check "the menu entry still handles lynshen:// links" grep -q 'x-scheme-handler/lynshen' /usr/share/applications/Aogiri.desktop
  check "old menu entry gone" absent test -e /usr/share/applications/LynShen.desktop
  check "new icon present" test -f /usr/share/icons/hicolor/128x128/apps/Aogiri.png
  check "old icon gone" absent test -e /usr/share/icons/hicolor/128x128/apps/LynShen.png
}

if [ "$kind" = deb ]; then
  installed() { [ "$(dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null)" = installed ]; }

  echo "== deb: install $old_pkg as a user does"
  sudo apt-get install -y "./$old" >/dev/null || { echo "could not install $old"; exit 1; }
  installed "$old_pkg" || { echo "$old_pkg is not installed"; exit 1; }
  test -x /usr/bin/LynShen || { echo "/usr/bin/LynShen missing"; exit 1; }

  # What the app writes for "start at login" (tauri-plugin-autostart), and a
  # stand-in for the user's data.
  mkdir -p "$HOME/.config/autostart" "$HOME/.lynshen"
  printf '[Desktop Entry]\nType=Application\nVersion=1.0\nName=LynShen\nComment=LynShenstartup script\nExec=/usr/bin/LynShen --autostart\nStartupNotify=false\nTerminal=false' \
    > "$HOME/.config/autostart/LynShen.desktop"
  echo 'user data' > "$HOME/.lynshen/rename-check.txt"

  echo "== deb: the update, as the updater runs it (dpkg -i)"
  sudo dpkg -i "$new"
  check "dpkg -i succeeded" test $? -eq 0
  check "$new_pkg is installed" installed "$new_pkg"
  check "$old_pkg is no longer installed" absent installed "$old_pkg"
  check "one of the two packages is left" test "$(dpkg-query -W -f='${db:Status-Status}\n' "$old_pkg" "$new_pkg" 2>/dev/null | grep -cx installed)" = 1
  check "/usr/bin/lynshen-cli belongs to $new_pkg" sh -c "dpkg -S /usr/bin/lynshen-cli | grep -q '^$new_pkg:'"
  check "/usr/bin/LynShen belongs to $new_pkg" sh -c "dpkg -S /usr/bin/LynShen | grep -q '^$new_pkg:'"
  files_checks
  check "the login item still starts an existing program" sh -c 'exe=$(sed -n "s/^Exec=\([^ ]*\).*/\1/p" "$HOME/.config/autostart/LynShen.desktop"); test -x "$exe"'
  check "user data intact" grep -qx 'user data' "$HOME/.lynshen/rename-check.txt"

  echo "== deb: the same package again (the next update)"
  sudo dpkg -i "$new" >/dev/null
  check "still installed" installed "$new_pkg"
  files_checks

  echo "== deb: remove"
  sudo apt-get remove -y "$new_pkg" >/dev/null
  check "$new_pkg removed" absent installed "$new_pkg"
  check "no executable left" absent test -e /usr/bin/Aogiri
  check "no launcher left" absent test -e /usr/bin/LynShen
  check "user data intact" grep -qx 'user data' "$HOME/.lynshen/rename-check.txt"
elif [ "$kind" = rpm ]; then
  echo "== rpm: install $old_pkg"
  rpm -i --nodeps "$old" || { echo "could not install $old"; exit 1; }
  rpm -q "$old_pkg" >/dev/null || { echo "$old_pkg is not installed"; exit 1; }

  echo "== rpm: the update, as the updater runs it (rpm -U)"
  rpm -U --nodeps "$new"
  check "rpm -U succeeded" test $? -eq 0
  check "$new_pkg is installed" rpm -q "$new_pkg"
  check "$old_pkg is no longer installed" absent rpm -q "$old_pkg"
  check "/usr/bin/lynshen-cli belongs to $new_pkg" sh -c "rpm -qf /usr/bin/lynshen-cli | grep -q '^$new_pkg-'"
  files_checks

  echo "== rpm: remove"
  rpm -e --nodeps "$new_pkg"
  check "$new_pkg removed" absent rpm -q "$new_pkg"
  check "no executable left" absent test -e /usr/bin/Aogiri
  check "no launcher left" absent test -e /usr/bin/LynShen
else
  echo "unknown package kind: $kind"
  exit 2
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "All checks passed."
