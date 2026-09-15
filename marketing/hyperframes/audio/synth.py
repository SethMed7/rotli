#!/usr/bin/env python3
"""Original music bed and sound effects for the rotli launch promo.

Everything is synthesized from scratch with numpy and written as 48 kHz 16-bit
WAV through the standard library. No samples, no downloads, no third-party
audio. The random generator is seeded, so output is reproducible. The bed is
calibrated to an integrated loudness target with ffmpeg's ebur128 meter; the
effects sit on top, so the bed keeps peak headroom for them.

The bed's length comes from the composition's root data-duration so the two
cannot drift apart; the musical structure follows the film's cuts (the CUTS
table) and must be retimed with the edit.

Two beds are available. `calm` is the sparse felt-piano bed of the second cut.
`energetic` (default, the maintainer 2026-09-10: "too quiet ... too boring and
soft, no excitement") is 104 BPM with a bright arpeggio, a soft kick and bass
from the drop, hats, a lead motif over the montage, a riser, and one hit.

    python3 audio/synth.py                 # energetic bed + effects
    python3 audio/synth.py --bed calm      # the second-cut bed
    python3 audio/synth.py --preview       # also renders renders/preview/bed-<style>.m4a

Outputs (assets/audio/):
  bed.wav          music bed, composition length
  sfx-tick.wav     light tick, used only on the recorded checkbox change
  sfx-press.wav    soft wooden press, used only on recorded button presses
  sfx-air.wav      quiet airy transition for a hard cut (calm cut)
  sfx-air-low.wav  the same transition a fourth lower
  sfx-hit.wav      short, dry impact for a cut on the beat (energetic cut)
"""
from __future__ import annotations

import argparse
import math
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 48_000
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "audio"
rng = np.random.default_rng(20260909)

TARGETS = {
    # integrated LUFS and max true peak for the BED alone; effects add ~1 dB on top.
    "calm": (-19.0, -4.5),
    "energetic": (-15.5, -2.5),
}

# Film cuts the music answers (seconds). Keep in step with index.html.
CUTS = {
    "opening": [(0.2, 62, 0.72), (1.1, 66, 0.74), (2.0, 69, 0.86)],  # one accent per headline, D–F#–A
    "app": 3.6,            # the product arrives: calm = open fifth · energetic = the drop
    "playground": 25.43,    # calm: two-note answer · energetic: the writing montage (lead motif enters)
    "pulse_end": 71.73,     # calm: sparse pulse ends here
    "themes": [(20.63, 69), (29.97, 66), (38.57, 74)],  # calm: motif notes on beat changes
    "riser": 72.03,         # energetic: riser into the ending
    "resolve": 73.63,       # "Built for you. And for your AI.": calm = resolved chord · energetic = the hit
}
BPM = 104.0


def composition_seconds() -> float:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    root = re.search(r'<div id="root"[^>]*data-duration="([\d.]+)"', html)
    if not root:
        raise SystemExit("index.html: root data-duration not found")
    return float(root.group(1))


# --------------------------------------------------------------------------- helpers
def write_wav(path: Path, samples: np.ndarray) -> None:
    if samples.ndim == 1:
        samples = np.stack([samples, samples], axis=1)
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def normalize_peak(samples: np.ndarray, peak_db: float) -> np.ndarray:
    peak = float(np.max(np.abs(samples))) or 1.0
    return samples / peak * (10 ** (peak_db / 20))


def soft_limit(samples: np.ndarray, threshold_db: float = -12.0, release_s: float = 0.09) -> np.ndarray:
    """Transparent peak limiter: instant attack, exponential release, linked channels."""
    threshold = 10 ** (threshold_db / 20)
    level = np.max(np.abs(samples), axis=1) if samples.ndim == 2 else np.abs(samples)
    gain = np.ones(len(level))
    coeff = math.exp(-1.0 / (release_s * SR))
    g = 1.0
    for i in range(len(level)):
        target = min(1.0, threshold / level[i]) if level[i] > threshold else 1.0
        g = target if target < g else target + (g - target) * coeff
        gain[i] = g
    return samples * (gain[:, None] if samples.ndim == 2 else gain)


def measure(path: Path) -> tuple[float, float]:
    """Integrated LUFS and true peak (dBTP) via ffmpeg's ebur128 filter."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    summary = proc.stderr.split("Summary:")[-1]
    lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    return lufs, peak


def midi(note: float) -> float:
    return 440.0 * 2 ** ((note - 69) / 12)


def lowpass(x: np.ndarray, cutoff_hz: float) -> np.ndarray:
    """One-pole low-pass, forward then backward (zero phase)."""
    dt = 1.0 / SR
    rc = 1.0 / (2 * math.pi * cutoff_hz)
    alpha = dt / (rc + dt)

    def run(sig: np.ndarray) -> np.ndarray:
        out = np.empty_like(sig)
        acc = 0.0
        for i in range(len(sig)):
            acc += alpha * (sig[i] - acc)
            out[i] = acc
        return out

    return run(run(x)[::-1])[::-1]


def highpass(x: np.ndarray, cutoff_hz: float) -> np.ndarray:
    return x - lowpass(x, cutoff_hz)


def pluck(freq: float, seconds: float, brightness: float = 1.0, velocity: float = 1.0) -> np.ndarray:
    """Felt-piano-like tone: soft harmonics, fast attack, exponential decay."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    partials = [(1.0, 1.0), (2.0, 0.38 * brightness), (3.0, 0.14 * brightness), (4.0, 0.05 * brightness)]
    tone = np.zeros(n)
    for ratio, amp in partials:
        decay = np.exp(-t * (1.5 + 1.2 * ratio))
        tone += amp * decay * np.sin(2 * math.pi * freq * ratio * t + rng.uniform(0, 0.4))
    body = np.exp(-t * 1.7)
    attack = np.minimum(1.0, t / 0.007)
    return velocity * tone * body * attack


def pad(freqs: list[float], seconds: float, fade_in: float, fade_out: float) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.3, 0.3):
            out += 0.5 * np.sin(2 * math.pi * (f + det) * t + rng.uniform(0, 6.28))
    env = np.ones(n)
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    env[:fi] = np.linspace(0, 1, fi) ** 2
    env[-fo:] = np.linspace(1, 0, fo) ** 2
    return out * env / len(freqs)


# --------------------------------------------------------------------------- energetic voices
def arp_note(freq: float, seconds: float = 0.22, brightness: float = 1.0) -> np.ndarray:
    """Short, glassy pluck for 16th-note arpeggios: sine + a bright partial, quick decay."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * math.pi * freq * t) + 0.45 * brightness * np.sin(2 * math.pi * freq * 2 * t)
    tone += 0.18 * brightness * np.sin(2 * math.pi * freq * 3 * t)
    return tone * np.exp(-t * 14) * np.minimum(1.0, t / 0.003)


def kick(seconds: float = 0.32) -> np.ndarray:
    """Soft electronic kick: pitch sweep 150→48 Hz, quick decay, a little click."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    f = 48 + 102 * np.exp(-t * 28)
    phase = 2 * math.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t * 9)
    click = rng.normal(0, 1, n) * np.exp(-t * 400) * 0.25
    return body + lowpass(click, 2500)


def hat(seconds: float = 0.06, gain: float = 1.0) -> np.ndarray:
    n = int(seconds * SR)
    t = np.arange(n) / SR
    return highpass(rng.normal(0, 1, n), 6500) * np.exp(-t * 90) * gain


def bass_note(freq: float, seconds: float) -> np.ndarray:
    """Round bass: fundamental plus a filtered saw-ish stack, short release."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * math.pi * freq * t)
    for k in (2, 3, 4):
        tone += (0.5 / k) * np.sin(2 * math.pi * freq * k * t)
    env = np.minimum(1.0, t / 0.006) * np.minimum(1.0, np.maximum(0.0, (seconds - t) / 0.05))
    return lowpass(tone, 900) * env


def riser(seconds: float) -> np.ndarray:
    """Band-limited noise whose cutoff and level climb over the whole length."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # A rising filter is approximated by crossfading three fixed bands.
    low = highpass(lowpass(noise, 900), 250)
    mid = highpass(lowpass(noise, 3000), 700)
    high = highpass(lowpass(noise, 9000), 2000)
    x = t / seconds
    return (low * (1 - x) ** 2 + mid * 2 * x * (1 - x) + high * x**2) * (x**1.8)


def hit(seconds: float = 2.6) -> np.ndarray:
    """One dry impact: kick body, a short noise burst, and a low sine tail."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    k = np.zeros(n)
    kk = kick(0.4)
    k[: len(kk)] += kk * 1.2
    burst = highpass(rng.normal(0, 1, n), 1200) * np.exp(-t * 26) * 0.6
    tail = np.sin(2 * math.pi * midi(38) * t) * np.exp(-t * 2.2) * 0.9
    return k + burst + tail


# --------------------------------------------------------------------------- beds
def bed_calm(total: float) -> np.ndarray:
    n = int(total * SR)
    mix = np.zeros(n)

    def place(sig: np.ndarray, at: float, gain: float = 1.0) -> None:
        start = int(at * SR)
        end = min(n, start + len(sig))
        if start < n:
            mix[start:end] += gain * sig[: end - start]

    def note(m: int, at: float, vel: float = 0.7, length: float = 2.4, bright: float = 0.8, gain: float = 0.5) -> None:
        place(pluck(midi(m), length, brightness=bright, velocity=vel), at, gain)

    for at, m, vel in CUTS["opening"]:
        note(m, at, vel, length=2.8)
        note(m - 12, at + 0.01, vel * 0.55, length=3.0, bright=0.5, gain=0.35)
    app = CUTS["app"]
    for k, m in enumerate((50, 57, 62)):
        note(m, app + k * 0.02, 0.8, length=3.4, bright=0.7, gain=0.42)
    beat = 60.0 / 76.0
    bar = beat * 4
    progression = ["I", "IV", "vi", "V", "I", "IV", "ii", "V", "I", "IV", "vi", "V", "I"]
    tones = {"I": [62, 66, 69], "IV": [55, 59, 62], "vi": [59, 62, 66], "V": [57, 61, 64], "ii": [64, 67, 71]}
    pads = {"I": [50, 57], "IV": [43, 50], "vi": [47, 54], "V": [45, 52], "ii": [52, 59]}
    for b in range(len(progression)):
        at0 = app + b * bar
        if at0 >= CUTS["pulse_end"]:
            break
        chord = tones[progression[b]]
        hits = [(0.0, chord[0], 0.62), (1.5 * beat, chord[1], 0.5)]
        if b % 2 == 0:
            hits.append((3.0 * beat, chord[2], 0.46))
        for offset, m, vel in hits:
            at = at0 + offset + rng.uniform(-0.01, 0.01)
            if at < CUTS["pulse_end"]:
                note(m, at, vel + rng.uniform(-0.04, 0.04), length=2.0, bright=0.75, gain=0.36)
        place(pad([midi(p) for p in pads[progression[b]]], bar * 1.1, 0.8, 0.8), at0, gain=0.07)
    pg = CUTS["playground"]
    note(66, pg, 0.66, length=2.4, gain=0.40)
    note(69, pg + 0.6, 0.62, length=2.4, gain=0.38)
    for at, m in CUTS["themes"]:
        note(m, at, 0.78, length=2.6, bright=0.95, gain=0.44)
    res = CUTS["resolve"]
    tail = max(1.0, total - res)
    for k, m in enumerate((50, 57, 62, 66, 69)):
        note(m, res + k * 0.025, 0.92, length=tail, bright=0.7, gain=0.46)
    place(pad([midi(50), midi(57)], tail, 0.1, tail * 0.65), res, gain=0.06)
    mix = lowpass(mix, 5600)
    return finish(mix, n)


def bed_energetic(total: float) -> np.ndarray:
    n = int(total * SR)
    mix = np.zeros(n)
    beat = 60.0 / BPM
    bar = beat * 4
    sixteenth = beat / 4

    def place(sig: np.ndarray, at: float, gain: float = 1.0) -> None:
        start = int(at * SR)
        end = min(n, start + len(sig))
        if 0 <= start < n:
            mix[start:end] += gain * sig[: end - start]

    # Grid anchored on the drop so the downbeat lands exactly on the app's arrival.
    drop = CUTS["app"]
    montage = CUTS["playground"]
    rise_at = CUTS["riser"]
    hit_at = CUTS["resolve"]

    # Progression from the drop, one chord per bar: I  V  vi  IV (D  A  Bm  G), in D major.
    chords = {
        "I": ([62, 66, 69, 74], 38), "V": ([57, 61, 64, 69], 45), "vi": ([59, 62, 66, 71], 47), "IV": ([55, 59, 62, 67], 43),
    }
    order = ["I", "V", "vi", "IV"]

    # --- Cold open: arpeggio alone, rising in brightness; one accent per headline.
    open_arp = [62, 66, 69, 74, 69, 66]
    t = 0.0
    i = 0
    while t < drop - 0.01:
        m = open_arp[i % len(open_arp)]
        brightness = 0.35 + 0.65 * (t / drop)
        place(arp_note(midi(m), 0.2, brightness), t, 0.16 + 0.16 * (t / drop))
        t += sixteenth
        i += 1
    for at, m, vel in CUTS["opening"]:
        place(pluck(midi(m), 1.6, brightness=1.0, velocity=vel), at, 0.55)
        place(pluck(midi(m - 12), 1.8, brightness=0.6, velocity=vel * 0.6), at + 0.005, 0.32)

    # --- From the drop to the hit: kick, bass, hats, pads, arpeggio, and the lead over the montage.
    bar_index = 0
    at0 = drop
    while at0 < hit_at - 0.01:
        name = order[bar_index % len(order)]
        tones, root = chords[name]
        in_montage = at0 >= montage - 0.01
        # kick on every beat, a little softer before the montage
        for b in range(4):
            if at0 + b * beat < hit_at:
                place(kick(), at0 + b * beat, 0.62 if in_montage else 0.5)
        # hats on the off-beats, plus 16ths during the montage
        for s in range(16):
            ts = at0 + s * sixteenth
            if ts >= hit_at:
                break
            if s % 4 == 2:
                place(hat(0.07, 1.0), ts, 0.16 if in_montage else 0.11)
            elif in_montage and s % 2 == 1:
                place(hat(0.045, 0.6), ts, 0.06)
        # bass: root on 1 and 3, the fifth as a pickup on the "and" of 4
        place(bass_note(midi(root), beat * 1.8), at0, 0.5)
        place(bass_note(midi(root), beat * 1.3), at0 + 2 * beat, 0.46)
        place(bass_note(midi(root + 7), beat * 0.45), at0 + 3.5 * beat, 0.34)
        # pad chord under the bar
        place(pad([midi(m) for m in tones[:3]], bar * 1.05, 0.15, 0.5), at0, 0.16 if in_montage else 0.11)
        # arpeggio: chord tones in 16ths, up then down, an octave up in the montage
        seq = tones + tones[-2:0:-1]
        for s in range(16):
            ts = at0 + s * sixteenth
            if ts >= hit_at:
                break
            m = seq[s % len(seq)] + (12 if in_montage and s % 8 >= 4 else 0)
            place(arp_note(midi(m), 0.2, 0.9), ts, 0.19 if in_montage else 0.14)
        # lead motif over the montage: D–F#–A answered by B–A, every two bars
        if in_montage and bar_index % 2 == 0:
            for off, m, vel in ((0.0, 74, 0.9), (0.5 * beat, 78, 0.85), (1.0 * beat, 81, 1.0), (2.5 * beat, 83, 0.8), (3.0 * beat, 81, 0.9)):
                place(pluck(midi(m), 1.2, brightness=1.1, velocity=vel), at0 + off, 0.42)
        at0 += bar
        bar_index += 1

    # --- Riser into the hit, then the hit, then the resolve decaying to the last frame.
    rise_len = max(0.5, hit_at - rise_at)
    place(riser(rise_len), rise_at, 0.55)
    # snare-like rolls in the last bar of the riser
    roll_start = hit_at - bar
    k = 0
    while roll_start + k * sixteenth < hit_at - 0.01:
        div = sixteenth if k < 8 else sixteenth / 2
        place(hat(0.05, 0.9), roll_start + k * sixteenth, 0.08 + 0.12 * (k / 16))
        k += 1
    place(hit(2.8), hit_at, 0.9)
    tail = max(1.0, total - hit_at)
    for kx, m in enumerate((50, 57, 62, 66, 69, 74)):
        place(pluck(midi(m), tail, brightness=0.8, velocity=0.95), hit_at + kx * 0.02, 0.4)
    place(pad([midi(50), midi(57), midi(62)], tail, 0.05, tail * 0.7), hit_at, 0.12)

    mix = lowpass(mix, 9000)
    return finish(mix, n)


def finish(mix: np.ndarray, n: int) -> np.ndarray:
    fade = np.ones(n)
    fo = int(0.25 * SR)
    fade[-fo:] = np.linspace(1, 0, fo)
    mix *= fade
    d = int(0.0006 * SR)
    right = np.concatenate([np.zeros(d), mix[:-d]])
    return np.stack([0.5 * (mix + 0.9 * right), 0.5 * (right + 0.9 * mix)], axis=1)


# --------------------------------------------------------------------------- sfx
def sfx_press() -> np.ndarray:
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n) * np.exp(-t * 150)
    wood = np.sin(2 * math.pi * 1250 * t) * np.exp(-t * 95) * 0.3
    knock = np.sin(2 * math.pi * 190 * t) * np.exp(-t * 50) * 0.6
    return lowpass(noise, 3800) * 0.5 + wood + knock


def sfx_tick() -> np.ndarray:
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n) * np.exp(-t * 220)
    wood = np.sin(2 * math.pi * 1900 * t) * np.exp(-t * 140) * 0.32
    knock = np.sin(2 * math.pi * 320 * t) * np.exp(-t * 90) * 0.35
    return lowpass(noise, 5200) * 0.42 + wood + knock


def sfx_air(pitch_scale: float = 1.0) -> np.ndarray:
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    swell = np.sin(math.pi * np.minimum(1, t / 0.45)) ** 1.8
    band = lowpass(noise, 3600 * pitch_scale) - lowpass(noise, 800 * pitch_scale)
    return band * swell


def sfx_hit() -> np.ndarray:
    """A short dry impact for a cut on the beat: kick body plus a brief noise burst."""
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    k = np.zeros(n)
    kk = kick(0.3)
    k[: len(kk)] += kk
    burst = highpass(rng.normal(0, 1, n), 1500) * np.exp(-t * 40) * 0.5
    return k + burst


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--bed", choices=("energetic", "calm"), default="energetic")
    parser.add_argument("--preview", action="store_true", help="also write renders/preview/bed-<style>.m4a")
    args = parser.parse_args()
    total = composition_seconds()
    if CUTS["resolve"] >= total - 1.0:
        raise SystemExit(f"resolve cue {CUTS['resolve']} leaves no tail before {total}s")
    target_lufs, max_tp = TARGETS[args.bed]
    bed_path = OUT / "bed.wav"
    raw = bed_calm(total) if args.bed == "calm" else bed_energetic(total)
    bed = normalize_peak(soft_limit(normalize_peak(raw, -3.0), -9.0 if args.bed == "energetic" else -12.0), -6.0)
    write_wav(bed_path, bed)
    lufs, peak = measure(bed_path)
    gain_db = min(target_lufs - lufs, max_tp - peak)
    bed = bed * (10 ** (gain_db / 20))
    write_wav(bed_path, bed)
    lufs, peak = measure(bed_path)
    print(f"bed.wav ({args.bed})  {total:.2f}s  integrated {lufs:.1f} LUFS  true peak {peak:.1f} dBTP  (gain {gain_db:+.1f} dB)")
    write_wav(OUT / "sfx-press.wav", normalize_peak(sfx_press(), -9.0))
    write_wav(OUT / "sfx-tick.wav", normalize_peak(sfx_tick(), -10.0))
    write_wav(OUT / "sfx-air.wav", normalize_peak(sfx_air(1.0), -11.0))
    write_wav(OUT / "sfx-air-low.wav", normalize_peak(sfx_air(0.75), -11.0))
    write_wav(OUT / "sfx-hit.wav", normalize_peak(sfx_hit(), -6.0))
    print("sfx-press -9 dBFS · sfx-tick -10 dBFS · sfx-air/-low -11 dBFS · sfx-hit -6 dBFS")
    if args.preview:
        preview = ROOT / "renders" / "preview" / f"bed-{args.bed}.m4a"
        preview.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(bed_path), "-c:a", "aac", "-b:a", "192k", str(preview)], check=True)
        print(f"preview -> {preview.relative_to(ROOT)}")
