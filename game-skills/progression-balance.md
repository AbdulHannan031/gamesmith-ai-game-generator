---
name: progression-balance
title: Scoring, difficulty, economy and fair randomness
description: Use when tuning difficulty, adding upgrades/power-ups/shops/combos/currency, or when the game is "too easy", "too hard", "unfair" or "gets boring after a minute". Covers scoring design, difficulty curves, upgrade economies and RNG that feels fair.
---

# Progression and balance

## Scoring is a design statement

The scoring rule tells players what the game is about. Choose it deliberately:

- **Reward the risky verb, not the safe one.** If dodging close is the fun, pay for
  near-misses. If routing is the fun, pay for speed.
- **Combos over flat rates.** A multiplier that decays creates continuous tension
  from a single number.
  ```js
  combo = Math.min(combo + 1, 99);
  comboTimer = CFG.scoring.comboWindow;         // ~1.2-2.0s
  score += base * (1 + combo * 0.15);
  // each frame: if ((comboTimer -= dt) <= 0) combo = 0;
  ```
  Show the multiplier prominently and shrink the timer visibly as it runs out.
- **One headline number.** Secondary stats belong on the game-over screen, not the HUD.
- Round scores to readable increments (10s, 50s). `1,240` reads; `1,237` is noise.

## Difficulty curves

Never scale linearly and never scale without a cap.

```js
// Asymptotic: approaches a limit, never becomes impossible.
const spawnInterval = MIN + (START - MIN) * Math.exp(-t / 45);

// Stepped: difficulty changes at readable moments, with a rest beat after each.
const tier = Math.floor(score / 500);
```

Stepped ramps are usually better than smooth ones for arcade games — the player
*notices* getting harder, which reads as progress rather than as the game quietly
turning against them.

Scale **variety before magnitude**. Adding a second enemy type is more interesting
than doubling the first one's health. Health-sponge scaling is the most common
balance failure: it makes the game longer, not harder.

Cap every scaling term:
```js
const speed = BASE * Math.min(1 + t / 90, 1.8);   // never more than 1.8x
```

## Target session shape

For a browser arcade game:

- First death: 20-40s. Fast enough that the player learns the loss condition early.
- Median run once competent: 60-120s.
- A good run: 3-4 minutes.
- Time from death to playing again: **under 1 second.**

If the median run is over 5 minutes, the game needs a stronger failure condition. If
it is under 15 seconds, it is punishing without teaching.

## Upgrades and power-ups

Every upgrade should change *how you play*, not just a number.

| Weak | Strong |
|---|---|
| +10% damage | shots pierce one extra enemy |
| +1 max health | regain 1 health per 10 pickups |
| +5% speed | dash gains a second charge |

Rules that keep an upgrade economy healthy:

- **Offer 3, take 1.** Choice creates ownership and run variety. Never offer just one.
- Price the interesting option higher than the safe one, but make it reachable.
- Cap stacking, or one upgrade taken five times trivialises the game.
- Make each upgrade **visible on the player sprite or the projectile.** An invisible
  upgrade barely registers as a reward.
- Keep the full list in a data table so balance is one file:
  ```js
  export const UPGRADES = [
    { id: "pierce", name: "Lance",   cost: 3, tag: "offence", apply: (p) => p.pierce++ },
    { id: "dash2",  name: "Afterimage", cost: 5, tag: "mobility", apply: (p) => p.dashMax++ },
  ];
  ```
- Never offer an upgrade the player cannot use (a second dash charge before dash exists).

## Currency

One currency. Two is bookkeeping. Earn it from the core verb so the fun activity and
the progression activity are the same activity — if the optimal strategy is to farm
something boring, the economy is broken.

Rough tuning: a typical run should afford 1-2 purchases, so a session always ends
with a visible step forward.

## Randomness that feels fair

Players read true random as biased. Correct for it:

- **Shuffle bags** instead of independent rolls, for anything drawn repeatedly
  (pieces, cards, spawn types, loot). Guarantees distribution over a window.
  ```js
  let bag = [];
  const draw = (items) => (bag.length || (bag = shuffle([...items])), bag.pop());
  ```
- **Pity timers.** Track misses and force the outcome after N. "No rare drop in 12
  kills → guarantee one."
- **Weight against repetition.** Halve the weight of whatever was chosen last time.
- **Never randomise the lethal thing.** Damage can vary; whether an unavoidable
  attack spawns must not. Randomness is for texture, not for deciding deaths.
- Seed the PRNG per run and show the seed on the game-over screen if runs are
  generated — it invites comparison and replay.

## Diagnosing complaints

| Report | Usual real cause | Fix |
|---|---|---|
| "Too hard" | unreadable telegraphs, not damage values | longer wind-ups, clearer tells |
| "Too easy" | no failure pressure | tighten the resource, add a decaying combo |
| "Unfair" | off-screen or unavoidable damage | spawn indicators, guarantee escape routes |
| "Boring" | one enemy, one pattern | add variety, not magnitude |
| "Repetitive" | no run-to-run variation | upgrade choices, shuffled layouts |
| "Confusing" | too much on screen | cut a mechanic, raise contrast on what matters |

## Tune from evidence

Instrument before guessing: log time-to-first-death, average run length, which enemy
killed the player, and which upgrades get picked. Two runs of real data beat an hour
of theorising, and an upgrade nobody picks is a bug, not a preference.
