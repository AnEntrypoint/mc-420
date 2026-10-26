#!/bin/sh
set -eu
case "$1" in
faust) shift; exec faust -vec -fun -dfs -vs 32 -nvi -ct 0 "$@";;
cxx) shift; exec g++ -std=c++11 -fvisibility=hidden -O3 -fPIC "$@";;
*) echo "usage: compile.sh faust|cxx ARGS..." >&2; exit 2;;
esac
