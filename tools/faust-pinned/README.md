# Pinned Faust compile recipe

Single source of the compile flags for every Faust-to-LV2 build in this repo. CI (`.github/workflows/build-lv2.yml`) uses the same flags on `ubuntu-24.04-arm` (the arm64 jobs) and `ubuntu-24.04` (the x64 job `home-fx-lv2-x64`).

## Flags

- Faust step: `-vec -fun -dfs -vs 32 -nvi -ct 0`
- C++ step: `-std=c++11 -fvisibility=hidden -O3 -fPIC`
- Not used, on purpose: `-mapp` (aarch64 SIGSEGV), `-Ofast`, `-march=native`, fast-math, `-mem`, `-vs 16`, `-omp`, `-sch`.

## Exact command (resonode example)

```
FAUSTLIB=$(dirname "$(ls -f /usr/share/faust/lv2ui.cpp /usr/local/share/faust/lv2ui.cpp | tail -1)")
sh tools/faust-pinned/compile.sh faust -i -a "$FAUSTLIB/lv2.cpp" -cn resonode -o resonode.cpp effects/home/faust/resonode_synth.dsp
sh tools/faust-pinned/compile.sh cxx -shared -DDLLEXT='".so"' -DPLUGIN_URI='"https://faustlv2.bitbucket.io/resonode"' -DFAUST_META=1 -DFAUST_MIDICC=1 -DFAUST_MTS=1 -DFAUST_UI=0 -DVOICE_CTRLS=1 -DNVOICES=-1 -I. resonode.cpp -o resonode.so
```

For the full CPPFLAGS and the arm64 `-mcpu=cortex-a72` step, read `build-lv2.yml`; the x64 job is the reference for a native build.

## Local measurement shim (noalarm)

`tools/faust-pinned/noalarm.c` stubs `alarm()` so Faust's 120 s SIGALRM watchdog cannot abort a long codegen (exit 142 on `pitchtracker_ac.dsp`). Build and use it for local measurement only:

```
cc -shared -fPIC -o noalarm.so tools/faust-pinned/noalarm.c
LD_PRELOAD=$PWD/noalarm.so sh tools/faust-pinned/compile.sh faust -i -a "$FAUSTLIB/lv2.cpp" -cn pitchtracker -o pitchtracker.cpp effects/pitchtracker-src/pitchtracker_ac.dsp
```

The shim is for local measurement only. CI builds the real .lv2 without it, and a bundle produced with the shim is not a release artifact.

The witness record `docs/witness/pitch-2093-raw/tools/compile.sh` loads `../noalarm.so` built from this source.
