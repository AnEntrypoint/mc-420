#!/bin/sh
name=$1; shift
/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/rs.sh 'rc-service aloop restart' > /tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/logs/$name.restart.txt 2>&1
sleep 12
cd /config/workspace/mc-420 && node tools/loopback-witness/loopback-witness.js "$@" --out /tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/logs/$name.wav > /tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/logs/$name.log 2>&1
echo exit=$? >> /tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/logs/$name.log
