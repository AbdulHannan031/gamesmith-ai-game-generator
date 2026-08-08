---
name: procedural-audio
title: Sound effects and music from code
description: Use whenever the game needs sound, music, or feels "flat" and silent. There are no audio files on this platform — everything is synthesised with WebAudio. Covers SFX recipes per event type, envelopes, noise, a music sequencer, and the browser autoplay unlock.
---

# Sound from code

No audio files. Everything is WebAudio synthesis. This is genuinely enough for
arcade-quality sound, and a game with sound feels twice as finished as the same
game silent.

## The unlock rule — get this wrong and there is no sound at all

Browsers block audio until a user gesture. Create the context lazily and resume it
on the first input.

```js
let actx = null;
export function audio() {
  actx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
  return actx;
}
// call audio() from your first keydown/pointerdown handler, not at module load
```

Also route everything through one master gain so the game can be muted, and add a
soft limiter so stacked explosions do not clip into distortion.

```js
const master = actx.createGain();  master.gain.value = 0.35;
const limiter = actx.createDynamicsCompressor();
limiter.threshold.value = -8; limiter.ratio.value = 12;
master.connect(limiter).connect(actx.destination);
```

## One tone function covers 90% of SFX

```js
export function tone({ freq = 440, to = null, dur = 0.12, type = "square",
                       gain = 0.25, attack = 0.004, curve = "exp" } = {}) {
  const a = audio(), t = a.currentTime;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency[curve === "exp" ? "exponentialRampToValueAtTime" : "linearRampToValueAtTime"](to, t + dur);

  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + attack);   // click-free attack
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(amp).connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}
```

**Never ramp gain to exactly 0 with `exponentialRampToValueAtTime`** — it throws.
Use `0.0001`. And always start from a small value, not 0, for the same reason.

## Noise for anything percussive

```js
let noiseBuf = null;
export function noise({ dur = 0.2, gain = 0.3, filter = 1200, sweep = 200, type = "lowpass" } = {}) {
  const a = audio(), t = a.currentTime;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 1, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const bq = a.createBiquadFilter(); bq.type = type;
  bq.frequency.setValueAtTime(filter, t);
  bq.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
  const amp = a.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bq).connect(amp).connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}
```

## Recipes

| Event | Call |
|---|---|
| Pickup / coin | `tone({ freq: 880, to: 1320, dur: 0.09, type: "triangle" })` |
| Pickup, chained combo | same, but `freq: 660 * Math.pow(1.06, combo)` — rising pitch is free dopamine |
| Jump | `tone({ freq: 300, to: 620, dur: 0.11, type: "square", gain: 0.18 })` |
| Land | `noise({ dur: 0.08, filter: 900, sweep: 200, gain: 0.16 })` |
| Shoot (light) | `tone({ freq: 900, to: 260, dur: 0.07, type: "sawtooth", gain: 0.14 })` |
| Shoot (heavy) | `tone({ freq: 180, to: 60, dur: 0.18, type: "square" })` + `noise({ dur: 0.12 })` |
| Enemy hit | `tone({ freq: 220, to: 120, dur: 0.07, type: "square", gain: 0.2 })` |
| Explosion | `noise({ dur: 0.5, filter: 2400, sweep: 80, gain: 0.4 })` |
| Player hurt | `tone({ freq: 200, to: 80, dur: 0.28, type: "sawtooth" })` |
| Menu move | `tone({ freq: 520, dur: 0.04, type: "square", gain: 0.1 })` |
| Confirm | two tones, `+0` and `+0.06s`, at 660 then 990 |
| Error / denied | `tone({ freq: 160, to: 140, dur: 0.16, type: "square" })` |
| Power-up | four rising tones 20ms apart on a major arpeggio |

**Always randomise pitch by ±4-6%** on sounds that repeat rapidly (footsteps, shots,
hits) or the ear locks onto the loop and it becomes grating:

```js
const vary = (f) => f * (0.94 + Math.random() * 0.12);
```

## Music without files

A step sequencer over a scale is enough for a loop that does not annoy after three
minutes. Use pentatonic or natural minor — with these you cannot hit a wrong note.

```js
const MINOR_PENT = [0, 3, 5, 7, 10];
const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

export function startMusic({ bpm = 108, root = 45 } = {}) {
  const a = audio();
  const stepDur = 60 / bpm / 2;                 // eighth notes
  let step = 0, next = a.currentTime;

  const bass = [0, 0, 4, 0, 2, 2, 4, 3];        // scale degrees per bar

  function schedule() {
    while (next < a.currentTime + 0.2) {        // schedule ~200ms ahead
      const bar = Math.floor(step / 8) % bass.length;
      if (step % 4 === 0) {
        tone({ freq: midiToHz(root + MINOR_PENT[bass[bar]]), dur: stepDur * 1.6,
               type: "triangle", gain: 0.12 });
      }
      if (step % 8 === 4) noise({ dur: 0.06, filter: 3000, sweep: 900, gain: 0.10 }); // hat
      if (Math.random() < 0.3) {                 // sparse melody
        const d = MINOR_PENT[Math.floor(Math.random() * MINOR_PENT.length)];
        tone({ freq: midiToHz(root + 24 + d), dur: stepDur * 0.8, type: "square", gain: 0.05 });
      }
      next += stepDur; step++;
    }
    setTimeout(schedule, 50);
  }
  schedule();
}
```

Schedule ahead against `actx.currentTime` — never drive music from
`requestAnimationFrame` or `setInterval` alone, or it will drift and stutter under load.

Duck the music (drop master gain to ~0.5 for 150ms) on big events. It makes impacts
feel much larger for two lines of code.

## Mixing

Keep individual gains low; they stack. A good starting balance: music 0.10, ambient
0.08, SFX 0.14-0.25, player death 0.4. If it distorts, lower the master rather than
individual sounds.

Always ship a mute toggle bound to `M`, and persist it —
`GameSave.set("muted", true)`.
