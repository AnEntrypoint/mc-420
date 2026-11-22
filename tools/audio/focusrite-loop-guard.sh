#!/bin/sh
set -eu
card=$(awk '/Scarlett/ {print $1; exit}' /proc/asound/cards)
[ -n "$card" ] || { echo "no Scarlett card in /proc/asound/cards" >&2; exit 1; }
for p in A B C D E F G H I J; do
    amixer -c "$card" sset "Mix $p Input 02" 0 >/dev/null
    amixer -c "$card" sset "Mix $p Input 12" 0 >/dev/null
done
amixer -c "$card" cset name="Mixer Input 12 Capture Enum" 0 >/dev/null
amixer -c "$card" sset "Line In 2 Pad" cap >/dev/null
amixer -c "$card" sset "Line In 2 Air" nocap >/dev/null
amixer -c "$card" sset "Line In 2 Level" Line >/dev/null
amixer -c "$card" sset "Line 07 (Headphones 2 L)" 127 >/dev/null
amixer -c "$card" sset "Line 07 Mute" off >/dev/null
for id in 23 26 29 32; do
    amixer -c "$card" cset "numid=$id" 0 >/dev/null
done
amixer -c "$card" cset numid=52 33 >/dev/null
amixer -c "$card" cset numid=53 34 >/dev/null
amixer -c "$card" cset numid=54 35 >/dev/null
amixer -c "$card" cset numid=55 36 >/dev/null
for id in 52 53 54 55; do
    printf "numid=%s " "$id"
    amixer -c "$card" cget "numid=$id" | grep ": values=" | tail -1
done
for p in A B C D E F G H I J; do
    printf "Mix %s Input 02 " "$p"
    amixer -c "$card" sget "Mix $p Input 02" | grep "Mono:"
    printf "Mix %s Input 12 " "$p"
    amixer -c "$card" sget "Mix $p Input 12" | grep "Mono:"
done
printf "Mixer Input 12 Capture Enum "
amixer -c "$card" cget name="Mixer Input 12 Capture Enum" | grep ": values=" | tail -1
for c in "Line In 2 Pad" "Line In 2 Air" "Line In 2 Level"; do
    printf "%s " "$c"
    amixer -c "$card" sget "$c" | grep -E "Mono:|Item0:"
done
