#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
./GAME-PORTAL-MOJAVE
result=$?
if [ "$result" -ne 0 ]; then
  printf '\n起動できませんでした。上の案内を確認してください。Enterで閉じます。\n'
  read -r
fi
exit "$result"
