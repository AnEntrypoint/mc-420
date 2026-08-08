import math
import re
import sys

import numpy as np

from harness import DSP_PATH, SAMPLE_RATE, burst_excitation, render, spectral_centroid


def render_tone_at_hz(tone_hz, note, dur=1.0, seed=1):
    n = int(dur * SAMPLE_RATE)
    excite = burst_excitation(n, seed)
    audio = render(
        DSP_PATH.read_text(),
        excite,
        dur,
        params={"fx_resonode_tone": tone_hz, "fx_resonodevoice0_note": note,
                "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0},
    )
    return spectral_centroid(audio, SAMPLE_RATE)


def check_tone_taper():
    lo, hi = 200.0, 18000.0
    print("=== tone knob taper check ===")
    ok = True
    for note in (60, 84):
        c0 = render_tone_at_hz(lo, note)
        c1 = render_tone_at_hz(lo * (hi / lo) ** 0.1, note)
        c10 = render_tone_at_hz(hi, note)
        c1_lin = render_tone_at_hz(lo + 0.1 * (hi - lo), note)
        total_exp = c10 - c0 + 1e-9
        total_lin = c10 - c0 + 1e-9
        frac_exp = (c1 - c0) / total_exp
        frac_lin = (c1_lin - c0) / total_lin
        print(
            f"note={note} frac of total brightness change within first 10% of knob: "
            f"linear={frac_lin:.3f} exponential={frac_exp:.3f}"
        )
        if not (frac_exp < 0.7 * frac_lin):
            ok = False
    return ok


def jump_click_ratio(param, before, after, jump_sample=6000, note=60, dur=0.3, seed=11):
    n = int(dur * SAMPLE_RATE)
    excite = burst_excitation(n, seed)
    ratios = {}
    for smoothed_label in ("raw", "smoothed"):
        automation = np.full(n, before, dtype=np.float32)
        automation[jump_sample:] = after
        params = {"fx_resonodevoice0_note": note, "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
        audio = render(DSP_PATH.read_text(), excite, dur, params=params, automation={param: automation})
        d = np.abs(np.diff(audio.astype(np.float64)))
        at_jump = d[jump_sample - 1]
        local = np.concatenate([d[jump_sample - 200: jump_sample - 1], d[jump_sample: jump_sample + 199]])
        ratios[smoothed_label] = at_jump / (local.max() + 1e-9)
        break
    return ratios


def check_morph_glide_click():
    print("=== patch-morph knob click check (burst excitation, jump mid-decay, real automation) ===")
    n = int(0.3 * SAMPLE_RATE)
    seed = 11
    excite = burst_excitation(n, seed)
    jump_sample = 6000
    ok = True
    for param_full, param_short, before, after in [
        ("fx/resonode/position", "fx_resonode_position", 0.08, 0.42),
        ("fx/resonode/stretch", "fx_resonode_stretch", -0.10, 1.20),
        ("fx/resonode/tone", "fx_resonode_tone", 300.0, 15000.0),
        ("fx/resonode/damping", "fx_resonode_damping", 0.80, 0.97),
    ]:
        automation = np.full(n, before, dtype=np.float32)
        automation[jump_sample:] = after
        base_params = {"fx_resonodevoice0_note": 60.0, "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
        audio_smoothed = render(DSP_PATH.read_text(), excite, 0.3, params=base_params, automation={param_short: automation})

        raw_text = DSP_PATH.read_text()
        raw_text = re.sub(rf'(\w+)\s*=\s*hslider\("{re.escape(param_full)}", [^)]+\) : morphGlide;',
                           rf'\1 = hslider("{param_full}", 0, -1e9, 1e9, 0.001);', raw_text)
        audio_raw = render(raw_text, excite, 0.3, params=base_params, automation={param_short: automation})

        d_s = np.abs(np.diff(audio_smoothed.astype(np.float64)))
        d_r = np.abs(np.diff(audio_raw.astype(np.float64)))
        at_jump_s = d_s[jump_sample - 1]
        at_jump_r = d_r[jump_sample - 1]
        local_s = np.concatenate([d_s[jump_sample - 200: jump_sample - 1], d_s[jump_sample: jump_sample + 199]])
        local_r = np.concatenate([d_r[jump_sample - 200: jump_sample - 1], d_r[jump_sample: jump_sample + 199]])
        ratio_s = at_jump_s / (local_s.max() + 1e-9)
        ratio_r = at_jump_r / (local_r.max() + 1e-9)
        print(f"{param_full} jump: raw={ratio_r:.2f}x smoothed={ratio_s:.2f}x")
        if param_full == "fx/resonode/position":
            ok = ratio_s < 0.5 * ratio_r and ratio_s < 1.5
    return ok


def check_no_fadein_regression():
    print("=== no-fade-in-from-zero regression check (static default params) ===")
    n = int(0.05 * SAMPLE_RATE)
    excite = burst_excitation(n, seed=7)
    smoothed_text = DSP_PATH.read_text()
    raw_text = re.sub(r": morphGlide;", ";", smoothed_text)
    params = {"fx_resonodevoice0_note": 60.0, "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
    a_raw = render(raw_text, excite, n / SAMPLE_RATE, params=params)
    a_smooth = render(smoothed_text, excite, n / SAMPLE_RATE, params=params)
    win = int(0.005 * SAMPLE_RATE)
    rms_raw = float(np.sqrt(np.mean(a_raw[:win].astype(np.float64) ** 2)) + 1e-12)
    rms_smooth = float(np.sqrt(np.mean(a_smooth[:win].astype(np.float64) ** 2)) + 1e-12)
    ratio = rms_smooth / rms_raw
    print(f"first-5ms RMS ratio (smoothed/raw), expect close to 1.0: {ratio:.3f}")
    return ratio > 0.9


def check_velocity_response():
    print("=== velocity -> loudness/brightness check ===")
    n = int(0.5 * SAMPLE_RATE)
    excite = burst_excitation(n, seed=3)
    ok = True
    prev_rms, prev_centroid = None, None
    for vel in (0.2, 0.6, 1.0):
        params = {"fx_resonodevoice0_note": 60.0, "fx_resonodevoice0_vel": vel, "fx_resonodevoice0_gate": 1.0}
        audio = render(DSP_PATH.read_text(), excite, n / SAMPLE_RATE, params=params)
        rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)) + 1e-20)
        centroid = spectral_centroid(audio, SAMPLE_RATE, warmup_s=0.05)
        print(f"vel={vel:.1f} rms={rms:.6f} centroid={centroid:8.1f}Hz")
        if prev_rms is not None and not (rms >= prev_rms * 0.98):
            ok = False
        if prev_centroid is not None and not (centroid >= prev_centroid * 0.90):
            ok = False
        prev_rms, prev_centroid = rms, centroid
    return ok


def check_silent_without_live_input():
    print("=== mic-only exciter regression check (gate held, zero live input) ===")
    n = int(0.3 * SAMPLE_RATE)
    excite = np.zeros(n, dtype=np.float32)
    params = {"fx_resonodevoice0_note": 60.0, "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
    audio = render(DSP_PATH.read_text(), excite, n / SAMPLE_RATE, params=params)
    peak = float(np.max(np.abs(audio)))
    print(f"peak amplitude with a held key and silent input: {peak:.3e}")
    return peak < 1e-5


def check_new_mode_alias_guard():
    print("=== mode5/mode6 alias-guard check ===")
    sr = SAMPLE_RATE
    note = 108
    f0 = 440.0 * (2.0 ** ((note - 69) / 12.0))
    print(f"note={note} f0={f0:.1f}Hz mode5={5*f0:.1f}Hz mode6={6*f0:.1f}Hz nyquist={sr/2:.0f}Hz")
    n = int(1.0 * sr)
    rng = np.random.default_rng(5)
    excite = (rng.uniform(-1.0, 1.0, size=n) * 0.5).astype(np.float32)
    params = {"fx_resonodevoice0_note": float(note), "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
    audio = render(DSP_PATH.read_text(), excite, n / sr, params=params)
    seg = audio[int(0.2 * sr):]
    windowed = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
    aliased5 = sr - 5 * f0
    aliased6 = sr - 6 * f0
    peak_mag = float(np.max(spec))
    ok = True
    for label, alias_hz in (("mode5", aliased5), ("mode6", aliased6)):
        if alias_hz <= 0 or alias_hz >= sr / 2:
            continue
        band = (freqs > alias_hz - 100) & (freqs < alias_hz + 100)
        band_peak = float(np.max(spec[band])) if np.any(band) else 0.0
        ratio = band_peak / (peak_mag + 1e-20)
        print(f"{label} alias-fold target {alias_hz:.0f}Hz: relative magnitude {ratio:.4f}")
        if ratio > 0.05:
            ok = False
    return ok


def check_voice_steal_with_velocity_change():
    print("=== voice-steal + velocity-change click check ===")
    n = int(0.05 * SAMPLE_RATE)
    steal_at = n // 2
    note_sig = np.full(n, 60.0, dtype=np.float32)
    note_sig[steal_at:] = 72.0
    vel_sig = np.full(n, 1.0, dtype=np.float32)
    vel_sig[steal_at:] = 0.3
    gate_sig = np.ones(n, dtype=np.float32)
    rng = np.random.default_rng(9)
    excite = (rng.uniform(-1.0, 1.0, size=n) * 0.6).astype(np.float32)
    automation = {
        "fx_resonodevoice0_note": note_sig,
        "fx_resonodevoice0_vel": vel_sig,
        "fx_resonodevoice0_gate": gate_sig,
    }
    audio = render(DSP_PATH.read_text(), excite, n / SAMPLE_RATE, automation=automation)
    d = np.abs(np.diff(audio.astype(np.float64)))
    at_steal = d[steal_at - 1]
    background = np.median(d[max(0, steal_at - 300): steal_at - 5])
    print(f"derivative at steal instant: {at_steal:.4f}, local background median: {background:.4f}")
    return at_steal < 0.5


def check_collision_zero_is_identity():
    print("=== collision=0 is an exact passthrough (regex-stripped self-A/B) ===")
    dsp_text = DSP_PATH.read_text()
    stripped = re.sub(
        r"voice\(sharedIn, note, gate, vel\) = collisionDrive\(bank\(([^;]+)\)\) \* voiceGain;",
        r"voice(sharedIn, note, gate, vel) = bank(\1) * voiceGain;",
        dsp_text,
    )
    if stripped == dsp_text:
        raise RuntimeError("collisionDrive() call site not found for stripping")
    n = int(0.4 * SAMPLE_RATE)
    excite = burst_excitation(n, seed=21)
    params = {"fx_resonodevoice0_note": 60.0, "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
    a_with = render(dsp_text, excite, n / SAMPLE_RATE, params=params)
    a_stripped = render(stripped, excite, n / SAMPLE_RATE, params=params)
    diff = float(np.max(np.abs(a_with.astype(np.float64) - a_stripped.astype(np.float64))))
    print(f"max abs diff at collision=0 vs no-collisionDrive-at-all: {diff:.3e}")
    return diff < 1e-5


def check_collision_bounded_and_monotonic_energy():
    print("=== collision raises tail energy, stays finite and bounded ===")
    n = int(0.4 * SAMPLE_RATE)
    excite = burst_excitation(n, seed=2)
    hf_rms = []
    for coll in (0.0, 0.3, 0.7, 1.0):
        params = {"fx_resonode_collision": coll, "fx_resonodevoice0_note": 60.0,
                  "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
        audio = render(DSP_PATH.read_text(), excite, n / SAMPLE_RATE, params=params)
        if not np.all(np.isfinite(audio)):
            print(f"collision={coll}: NON-FINITE OUTPUT")
            return False
        if float(np.max(np.abs(audio))) > 1.001:
            print(f"collision={coll}: peak exceeds bound ({np.max(np.abs(audio)):.4f})")
            return False
        d = np.abs(np.diff(audio.astype(np.float64)))
        hf_rms.append(float(np.sqrt(np.mean(d ** 2))))
    print(f"tail-energy proxy (first-diff rms) across collision 0/0.3/0.7/1.0: {hf_rms}")
    return all(hf_rms[i + 1] >= hf_rms[i] * 0.98 for i in range(len(hf_rms) - 1))


def check_pitch_mod_gated_by_velocity_and_flexibility():
    print("=== pitch-mod is silent at vel=0 or at stretch=1.5 (stiff), present otherwise ===")
    dsp_text = DSP_PATH.read_text()
    no_pm_text = re.sub(r"pitchModDepth = 0\.04;", "pitchModDepth = 0.0;", dsp_text)
    if no_pm_text == dsp_text:
        raise RuntimeError("pitchModDepth default not found for stripping")
    n = int(0.15 * SAMPLE_RATE)
    excite = burst_excitation(n, seed=4)

    def diff_vs_disabled(text_variant, stretch=0.0):
        params = {"fx_resonode_stretch": stretch, "fx_resonodevoice0_note": 60.0,
                  "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0}
        a = render(text_variant, excite, n / SAMPLE_RATE, params=params)
        b = render(no_pm_text, excite, n / SAMPLE_RATE, params=params)
        return float(np.max(np.abs(a.astype(np.float64) - b.astype(np.float64))))

    active_diff = diff_vs_disabled(dsp_text)
    print(f"pitch-mod active (vel=1, default stretch) vs disabled: max abs diff {active_diff:.4f}")

    stiff_diff = diff_vs_disabled(dsp_text, stretch=1.5)
    print(f"pitch-mod at stretch=1.5 (stiff, flexibility=0) vs disabled: max abs diff {stiff_diff:.3e}")

    return active_diff > 0.001 and stiff_diff < 1e-5


def render_named_patch(position, decay, damping, stretch, collision, note, dur, seed, level=1.5):
    n = int(dur * SAMPLE_RATE)
    excite = burst_excitation(n, seed)
    params = {
        "fx_resonode_position": position, "fx_resonode_decay": decay, "fx_resonode_damping": damping,
        "fx_resonode_stretch": stretch, "fx_resonode_collision": collision, "fx_resonode_level": level,
        "fx_resonodevoice0_note": float(note), "fx_resonodevoice0_vel": 1.0, "fx_resonodevoice0_gate": 1.0,
    }
    return render(DSP_PATH.read_text(), excite, dur, params=params)


def check_dance_bass_shipped_patch():
    print("=== shipped Dance Bass patch: low-frequency-dominant, sustained bass character ===")
    position, decay, damping, stretch, collision = 0.420, 7.000, 0.150, -0.100, 0.300
    ok = True
    for note in (28, 36, 48):
        audio = render_named_patch(position, decay, damping, stretch, collision, note=note, dur=1.0, seed=13)
        if not np.all(np.isfinite(audio)):
            print(f"note={note}: NON-FINITE OUTPUT")
            ok = False
            continue
        peak = float(np.max(np.abs(audio)))
        f0 = 440.0 * (2.0 ** ((note - 69) / 12.0))
        sr = SAMPLE_RATE
        seg = audio[int(0.15 * sr):]
        windowed = seg * np.hanning(len(seg))
        spec = np.abs(np.fft.rfft(windowed))
        freqs = np.fft.rfftfreq(len(seg), 1.0 / sr)
        total_energy = float(np.sum(spec ** 2)) + 1e-20
        low_energy = float(np.sum(spec[freqs <= 1.5 * f0] ** 2))
        low_ratio = low_energy / total_energy
        early = audio[int(0.05 * sr): int(0.15 * sr)].astype(np.float64)
        late = audio[int(0.5 * sr): int(0.6 * sr)].astype(np.float64)
        rms_early = math.sqrt(float(np.mean(early ** 2)) + 1e-20)
        rms_late = math.sqrt(float(np.mean(late ** 2)) + 1e-20)
        sustain_ratio = rms_late / (rms_early + 1e-9)
        print(
            f"note={note} f0={f0:6.1f}Hz peak={peak:.3f} lowFreqRatio={low_ratio:.3f} "
            f"sustainRatio={sustain_ratio:.3f}"
        )
        if peak > 1.001 or low_ratio < 0.85 or sustain_ratio < 0.5:
            ok = False
    return ok


def main():
    results = {
        "tone_taper": check_tone_taper(),
        "morph_glide_click": check_morph_glide_click(),
        "no_fadein_regression": check_no_fadein_regression(),
        "velocity_response": check_velocity_response(),
        "silent_without_live_input": check_silent_without_live_input(),
        "new_mode_alias_guard": check_new_mode_alias_guard(),
        "voice_steal_with_velocity_change": check_voice_steal_with_velocity_change(),
        "collision_zero_is_identity": check_collision_zero_is_identity(),
        "collision_bounded_and_monotonic_energy": check_collision_bounded_and_monotonic_energy(),
        "pitch_mod_gated_by_velocity_and_flexibility": check_pitch_mod_gated_by_velocity_and_flexibility(),
        "dance_bass_shipped_patch": check_dance_bass_shipped_patch(),
    }
    print()
    print("=== summary ===")
    all_ok = True
    for name, ok in results.items():
        print(f"{name}: {'PASS' if ok else 'FAIL'}")
        all_ok = all_ok and ok
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
