import { useSyncExternalStore } from 'react';

/** Ticks per second at 1x speed. */
const BASE_RATE = 2.4;

export const SPEEDS = [0.5, 1, 2, 4] as const;

const EPSILON = 1e-9;

/**
 * The playhead. `position` is a float measured in ticks and is advanced by the
 * animation loop, outside React. React only hears about it when the whole-tick
 * count or the play state changes, so the page re-renders a few times a second
 * instead of sixty.
 */
export class PlaybackClock {
  position = 0;
  total = 0;
  speed = 1;
  /** The visitor wants continuous playback. */
  playing = false;
  /** The playhead is in motion: playing, or finishing one or more single steps. */
  moving = false;

  private stopAt: number | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCompleted = (): number => Math.floor(this.position + EPSILON);
  getPlaying = (): boolean => this.playing;
  getMoving = (): boolean => this.moving;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private halt(): void {
    this.playing = false;
    this.moving = false;
    this.stopAt = null;
  }

  /**
   * Called when a new run is computed.
   * - A finished run stays finished, so tweaking a dial updates the end state live.
   * - With `keepPlace`, the playhead keeps its tick and keeps playing if it was.
   * - Otherwise playback starts over.
   */
  load(total: number, keepPlace = false): void {
    const wasFinished = this.total > 0 && this.position >= this.total;
    const wasPlaying = this.playing;
    this.total = total;

    if (wasFinished) {
      this.halt();
      this.position = total;
    } else if (keepPlace) {
      this.position = Math.min(this.position, total);
      if (this.stopAt !== null) this.stopAt = Math.min(this.stopAt, total);
      if (this.position >= total) this.halt();
      else if (wasPlaying) {
        this.playing = true;
        this.moving = true;
      }
    } else {
      this.halt();
      this.position = 0;
    }
    this.emit();
  }

  play(): void {
    if (this.total === 0) return;
    if (this.position >= this.total) this.position = 0;
    this.stopAt = null;
    this.playing = true;
    this.moving = true;
    this.emit();
  }

  /** Pausing lets the retelling in flight land before stopping. */
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    const target = Math.min(this.total, Math.ceil(this.position - EPSILON));
    if (target <= this.position) this.halt();
    else this.stopAt = target;
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  /**
   * One retelling forward. If something is already in flight it lands
   * instantly first, so every press moves exactly one step and none are lost.
   */
  stepForward(): void {
    if (this.moving) this.position = this.stopAt ?? Math.min(this.total, Math.ceil(this.position - EPSILON));
    if (this.position >= this.total) {
      this.halt();
      this.position = this.total;
      this.emit();
      return;
    }
    this.playing = false;
    this.stopAt = Math.min(this.total, this.getCompleted() + 1);
    this.moving = true;
    this.emit();
  }

  stepBack(): void {
    const target = Math.max(0, Math.ceil(this.position - EPSILON) - 1);
    this.halt();
    this.position = target;
    this.emit();
  }

  seek(tick: number): void {
    this.halt();
    this.position = Math.min(this.total, Math.max(0, Math.round(tick)));
    this.emit();
  }

  /** Advances the playhead. Returns true while it is still in motion. */
  advance(elapsedMs: number): boolean {
    if (!this.moving) return false;
    const before = this.getCompleted();
    const limit = this.stopAt ?? this.total;
    this.position = Math.min(limit, this.position + (elapsedMs / 1000) * BASE_RATE * this.speed);
    if (this.position >= limit) {
      this.position = limit;
      this.halt();
    }
    if (!this.moving || this.getCompleted() !== before) this.emit();
    return this.moving;
  }
}

export interface PlaybackState {
  /** Whole ticks finished so far. */
  completed: number;
  playing: boolean;
  moving: boolean;
}

export function usePlayback(clock: PlaybackClock): PlaybackState {
  const completed = useSyncExternalStore(clock.subscribe, clock.getCompleted);
  const playing = useSyncExternalStore(clock.subscribe, clock.getPlaying);
  const moving = useSyncExternalStore(clock.subscribe, clock.getMoving);
  return { completed, playing, moving };
}
