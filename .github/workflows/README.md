# build-lv2 workflow targets

`build-lv2.yml` builds the Faust LV2 bundles. Every Faust step and every C++ step uses the pinned recipe in `tools/faust-pinned/` (flags and the local-only noalarm shim are documented there).

## Targets

| Job | Runner | Architecture | Output artifact |
| --- | --- | --- | --- |
| `home-fx-lv2` | `ubuntu-24.04-arm` | aarch64, musl via alpine docker, `-mcpu=cortex-a72` | `home-fx-lv2` (effects/home) |
| `guitar-lofi-fx-lv2` | `ubuntu-24.04-arm` | aarch64 (alpine docker) | `guitar-lofi-fx-lv2` |
| `resonode-lv2` | `ubuntu-24.04-arm` | aarch64 (alpine docker) | `resonode-lv2` |
| `pitchtracker-lv2` | `ubuntu-24.04-arm` | aarch64 (alpine docker) | `pitchtracker-lv2` |
| `delayverb-lv2` | `ubuntu-24.04-arm` | aarch64 (alpine docker) | `delayverb-lv2` |
| `home-fx-lv2-x64` | `ubuntu-24.04` | x86_64, native (no docker) | `home-fx-lv2-x64` (effects/home-x64) |

The arm64 jobs are the device builds (Pi 4 aarch64). The x64 target is the same home stack built from the same flags on an x86_64 runner, so both architectures compile from one recipe. Only the C++ step differs: the x64 job links natively with `g++` and does not use `-mcpu=cortex-a72` or alpine.

## Running the x64 target

Trigger with `workflow_dispatch` (Actions tab, build-lv2, Run workflow), or push a change under `effects/**`, `dsp/**`, `src/dsp/**`, `tools/faust-pinned/**` or this workflow. The bundle is the `home-fx-lv2-x64` artifact (retention 3 days).

## Local equivalent

```
sh tools/faust-pinned/compile.sh faust -i -a "$FAUSTLIB/lv2.cpp" -cn aloop -o aloop.cpp aloop.dsp
sh tools/faust-pinned/compile.sh cxx -shared -DDLLEXT='".so"' -DPLUGIN_URI='"https://faustlv2.bitbucket.io/aloop"' -DFAUST_META=1 -DFAUST_MIDICC=1 -DFAUST_MTS=1 -DFAUST_UI=0 -DVOICE_CTRLS=1 -DNVOICES=-1 -I. aloop.cpp -o aloop.so
```

Local runs are for measurement only; the CI artifact is the release build.
