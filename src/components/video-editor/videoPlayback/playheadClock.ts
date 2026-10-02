import { useSyncExternalStore } from "react";

/**
 * Frame-accurate playhead time (timeline seconds), kept outside React state so
 * playback can update it every frame without re-rendering the whole editor.
 * Only the components that draw the playhead subscribe to it.
 */
export interface PlayheadClock {
	getTime: () => number;
	setTime: (time: number) => void;
	subscribe: (listener: () => void) => () => void;
}

/** While playing, editor-wide React state follows the clock at this pace. */
export const PLAYING_TIME_COMMIT_INTERVAL_MS = 200;

export function createPlayheadClock(initialTime = 0): PlayheadClock {
	let time = initialTime;
	const listeners = new Set<() => void>();
	return {
		getTime: () => time,
		setTime: (next) => {
			if (!Number.isFinite(next) || next === time) return;
			time = next;
			for (const listener of [...listeners]) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

const subscribeNever = () => () => undefined;

/**
 * Playhead in timeline ms, live from the clock when there is one, otherwise the
 * given fallback (e.g. a component also used outside the editor).
 */
export function useLivePlayheadMs(clock: PlayheadClock | undefined, fallbackMs: number): number {
	const seconds = useSyncExternalStore(
		clock?.subscribe ?? subscribeNever,
		() => (clock ? clock.getTime() : Number.NaN),
		() => (clock ? clock.getTime() : Number.NaN),
	);
	return clock ? Math.round(seconds * 1000) : fallbackMs;
}

/** Re-renders the calling component on every playhead change. */
export function usePlayheadTime(clock: PlayheadClock): number {
	return useSyncExternalStore(clock.subscribe, clock.getTime, clock.getTime);
}
