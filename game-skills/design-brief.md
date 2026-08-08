---
name: design-brief
title: Turning a prompt into a designed game
description: Use FIRST on any new game or major pivot. Converts a vague request ("make a ninja game") into a concrete core loop, verb set, failure condition and 60-second first-play experience before any code is written.
---

# Turning a prompt into a designed game

A prompt like "make a ninja game" is a theme, not a design. Theme is the skin;
the design is the loop. Decide the loop first — every later code decision falls
out of it.

## The one-paragraph brief (write this before touching code)

Fill these six slots. If you cannot fill one, you do not yet have a game.

1. **Core verb** — the single thing the player does most. Jump. Aim. Stack. Dodge.
   Everything else is support for this verb.
2. **Core loop** — the 3-8 second cycle. `see threat → position → act → get reward → new threat`.
3. **Tension source** — what makes the verb hard. Timing, scarcity, spatial pressure,
   competing goals, or knowledge. Pick exactly one primary source.
4. **Win / lose** — how a session ends. Score chase, level clear, survive N, or reach goal.
5. **Progression** — what changes over a session so minute 3 differs from minute 1.
   New enemy type, faster spawns, larger arena, new ability.
6. **Session length** — target time-to-first-fun (< 10 seconds) and full session
   (60-180 seconds for a browser game).

## Concrete example

> "Make a ninja game" →
> **Verb:** grapple. **Loop:** spot anchor → fling → land → chain before momentum dies.
> **Tension:** momentum decays, so hesitation kills the chain. **Lose:** touching ground
> ends the run. **Progression:** anchors thin out as you climb. **Session:** 45s runs.

That is buildable. "Ninja game" is not.

## Scope rules for a browser game

- **One verb, done well** beats four verbs done shallowly. Resist adding a second
  mechanic until the first is satisfying on its own.
- **No text tutorial.** Teach with the first 10 seconds of level design. If the
  player needs a paragraph, the design is wrong.
- **Readable at a glance.** A viewer should understand the game from one frame:
  what is the player, what kills them, what do they want.
- Ship a playable vertical slice, then deepen. Never leave the game unrunnable
  between edits.

## Choosing a genre skeleton

| Player asks for | Use skeleton | Load skill |
|---|---|---|
| platformer, ninja, run, jump, Mario-like | side-view gravity + tilemap | `platformer-physics` |
| shooter, space, bullets, twin-stick, roguelite | top-down free movement | `topdown-action` |
| puzzle, match, tetris, sokoban, cards | grid state machine, no physics | `grid-puzzle` |
| snake, pong, breakout, flappy, arcade classic | single-screen arcade | `topdown-action` (movement) |
| tower defense, idle, management | grid + timers + economy | `progression-balance` |

When the request is ambiguous, pick the skeleton that reaches "fun" fastest,
build it, and say in one sentence what you chose and why. Do not ask the user to
choose between five options — decide, ship, and let them redirect you.

## Naming and framing

Give the game a real title and a one-line tagline as soon as the design is clear,
and call `set_meta`. "Untitled game" in a public gallery reads as abandoned.
Tagline formula: *verb the player does* + *the twist*. "Grapple upward. Never touch
the ground."

## Before you say you are done

- Can the player fail? A game you cannot lose is a toy.
- Is there a reason to press restart? Score, near-miss, or a new thing glimpsed.
- Does the first 10 seconds teach the verb without words?
