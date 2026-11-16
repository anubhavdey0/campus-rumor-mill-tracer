import { describe, expect, it } from 'vitest';
import { PlaybackClock } from './playback';

const at = (total: number) => {
  const clock = new PlaybackClock();
  clock.load(total);
  return clock;
};

/** Runs the animation loop until the playhead stops. */
const settle = (clock: PlaybackClock) => {
  for (let i = 0; i < 1000 && clock.advance(16); i++);
};

describe('playback clock', () => {
  it('moves exactly one tick per step, even when steps are pressed quickly', () => {
    const clock = at(20);
    for (let i = 0; i < 5; i++) {
      clock.stepForward();
      clock.advance(40); // a press every 40 ms, well before a step finishes animating
    }
    settle(clock);
    expect(clock.position).toBe(5);
    expect(clock.moving).toBe(false);
  });

  it('a step while playing lands the current tick and then takes one more', () => {
    const clock = at(20);
    clock.play();
    clock.advance(500); // somewhere inside tick 1 or 2
    const landed = Math.ceil(clock.position);
    clock.stepForward();
    expect(clock.playing).toBe(false);
    settle(clock);
    expect(clock.position).toBe(landed + 1);
  });

  it('never steps past the end', () => {
    const clock = at(2);
    for (let i = 0; i < 6; i++) clock.stepForward();
    settle(clock);
    expect(clock.position).toBe(2);
  });

  it('keeps its place and keeps playing when only the dials change', () => {
    const clock = at(30);
    clock.seek(12);
    clock.load(40, true);
    expect(clock.position).toBe(12);
    clock.play();
    clock.load(25, true);
    expect(clock.playing).toBe(true);
    clock.load(8, true);
    expect(clock.position).toBe(8);
    expect(clock.playing).toBe(false);
  });

  it('starts over for a different story, but a finished run stays finished', () => {
    const clock = at(30);
    clock.seek(12);
    clock.load(40);
    expect(clock.position).toBe(0);
    clock.seek(40);
    clock.load(55);
    expect(clock.position).toBe(55);
  });
});
