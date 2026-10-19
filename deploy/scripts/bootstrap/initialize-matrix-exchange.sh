#!/bin/sh
set -eu

root=/brain/exchange
mkdir -p "$root/inbound" "$root/outbound"
chown -R 100:101 "$root"
find "$root" -type d -exec chmod 2770 {} +
find "$root" -type f -exec chmod 0660 {} +
