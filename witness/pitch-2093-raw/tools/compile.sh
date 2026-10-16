#!/bin/sh
cd "$(dirname "$0")/var"
n=$1
LD_PRELOAD=../noalarm.so faust -vec -fun -dfs -vs 32 -nvi -ct 0 -lang c -cn ptac $n.dsp -o $n.c > $n.log 2>&1
echo "rc=$?" >> $n.log
