---
key: mem-b3fecc77a09f5bd7-1244
ns: default
created: 1788701303072
updated: 1788701303072
---

Link tempo matching in aloop must be varispeed (pitch), never a read-position jump. Fixed 2026-09-06 after a report that connecting to Ableton Link glitched. Three bugs compounded in audio_thread.cpp. masterPhaseSamples += delta assigned the phase error straight onto the read position, which is a discontinuity and therefore a click by construction. It re-fired forever because masterPhaseSamples advanced by exactly N per block (always 1.0x) while the loopers read at linkSpeedRatio, so the two re-diverged as fast as they were corrected. And the ratio was INVERTED: dsp/loop.dsp advances rposNext by speedClamped per sample so effSpeed above 1 reads faster, meaning a 100bpm loop on a 120bpm session needs linkBpm/recordedBpm = 1.2, while the code computed recordedBpm/linkBpm = 0.833. Correct shape: ratio = linkBpm/recordedBpm, masterPhaseSamples advances at that same rate so it tracks what is actually being read, and residual phase error becomes a BOUNDED SPEED TRIM (0.00005 per sample of error, clamped to 0.03) folded into effSpeed. Three percent is 51 cents, a brief varispeed glide rather than a click. Check any trim against loop.dsp manualPunchActive threshold of abs(effSpeed-1) over 0.3, which disables the DSP internal resync.
