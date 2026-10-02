import { type ClipRegion, sortClipRegions } from "./types";

/**
 * "dip": the picture fades to black at the end of the clip and back in on the
 * next one. "crossfade": the last frame of the clip dissolves into the next
 * one. On the last clip, both fade the video out to black.
 */
export type ClipTransitionType = "dip" | "crossfade";

export interface ClipTransition {
	type: ClipTransitionType;
	durationMs: number;
}

export const CLIP_TRANSITION_DEFAULT_MS = 500;
export const CLIP_TRANSITION_MIN_MS = 100;
export const CLIP_TRANSITION_MAX_MS = 2000;
/** A crossfade only dips the sound briefly so speech is not lost. */
const CROSSFADE_AUDIO_HALF_MS = 150;

export function normalizeClipTransition(value: unknown): ClipTransition | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { type, durationMs } = value as Partial<ClipTransition>;
	if (type !== "dip" && type !== "crossfade") return undefined;
	const duration =
		typeof durationMs === "number" && Number.isFinite(durationMs)
			? durationMs
			: CLIP_TRANSITION_DEFAULT_MS;
	return {
		type,
		durationMs: Math.round(
			Math.min(CLIP_TRANSITION_MAX_MS, Math.max(CLIP_TRANSITION_MIN_MS, duration)),
		),
	};
}

export function hasClipTransitions(clips: readonly ClipRegion[] | undefined): boolean {
	return Boolean(clips?.some((clip) => clip.transitionOut));
}

/** One transition resolved against the sequence, in timeline ms. */
export interface ResolvedClipTransition {
	type: ClipTransitionType;
	/** Where the outgoing clip ends (and the next one starts). */
	seamMs: number;
	durationMs: number;
	from: ClipRegion;
	/** Null at the end of the edit: the transition fades out to black. */
	to: ClipRegion | null;
}

/** Transitions in timeline order, shortened so they never outlast the clips they touch. */
export function resolveClipTransitions(clips: readonly ClipRegion[]): ResolvedClipTransition[] {
	const sorted = sortClipRegions([...clips]);
	const resolved: ResolvedClipTransition[] = [];
	sorted.forEach((from, index) => {
		const transition = from.transitionOut;
		if (!transition) return;
		const to = sorted[index + 1] ?? null;
		const fromMs = from.endMs - from.startMs;
		const toMs = to ? to.endMs - to.startMs : Number.POSITIVE_INFINITY;
		// A crossfade plays over the incoming clip; a dip splits across the seam.
		const limit = to && transition.type === "crossfade" ? toMs : Math.min(fromMs, toMs);
		const durationMs = Math.min(transition.durationMs, limit);
		if (!(durationMs > 0)) return;
		resolved.push({
			type: to ? transition.type : "dip",
			seamMs: from.endMs,
			durationMs,
			from,
			to,
		});
	});
	return resolved;
}

export interface TransitionFrameState {
	/** Opacity of black drawn over the picture, 0–1. */
	blackAlpha: number;
	/** Crossfade in progress: hold `from`'s last frame on top at `opacity`. */
	crossfade: { opacity: number; from: ClipRegion; seamMs: number } | null;
}

function dipAlpha(transition: ResolvedClipTransition, timeMs: number): number {
	const { seamMs, durationMs, to } = transition;
	if (!to) {
		// End of the edit: fade out over the whole duration.
		if (timeMs < seamMs - durationMs || timeMs > seamMs) return 0;
		return (timeMs - (seamMs - durationMs)) / durationMs;
	}
	const half = durationMs / 2;
	const distance = Math.abs(timeMs - seamMs);
	return distance >= half ? 0 : 1 - distance / half;
}

export function getTransitionFrameState(
	transitions: readonly ResolvedClipTransition[],
	timeMs: number,
): TransitionFrameState {
	let blackAlpha = 0;
	let crossfade: TransitionFrameState["crossfade"] = null;
	for (const transition of transitions) {
		if (transition.type === "dip") {
			blackAlpha = Math.max(blackAlpha, dipAlpha(transition, timeMs));
			continue;
		}
		const elapsed = timeMs - transition.seamMs;
		if (elapsed >= 0 && elapsed < transition.durationMs) {
			crossfade = {
				opacity: 1 - elapsed / transition.durationMs,
				from: transition.from,
				seamMs: transition.seamMs,
			};
		}
	}
	return { blackAlpha: Math.min(1, Math.max(0, blackAlpha)), crossfade };
}

/** Breakpoint of a piecewise-linear gain curve for the recording's own sound. */
export interface GainPoint {
	timeMs: number;
	gain: number;
}

/**
 * Gain curve that dips the recording's sound around each transition. Between
 * points the gain is interpolated linearly; outside the curve it is 1.
 */
export function getTransitionGainEnvelope(
	transitions: readonly ResolvedClipTransition[],
): GainPoint[] {
	const dips: Array<{ startMs: number; seamMs: number; endMs: number }> = [];
	for (const { type, seamMs, durationMs, to } of transitions) {
		if (!to) {
			dips.push({ startMs: seamMs - durationMs, seamMs, endMs: seamMs });
			continue;
		}
		const half =
			type === "dip" ? durationMs / 2 : Math.min(durationMs / 2, CROSSFADE_AUDIO_HALF_MS);
		dips.push({ startMs: seamMs - half, seamMs, endMs: seamMs + half });
	}
	const points: GainPoint[] = [];
	for (const dip of dips.sort((a, b) => a.startMs - b.startMs)) {
		const startMs = Math.max(
			dip.startMs,
			points[points.length - 1]?.timeMs ?? Number.NEGATIVE_INFINITY,
		);
		points.push({ timeMs: startMs, gain: 1 });
		points.push({ timeMs: Math.max(startMs, dip.seamMs), gain: 0 });
		if (dip.endMs > dip.seamMs) points.push({ timeMs: dip.endMs, gain: 1 });
	}
	return points;
}

export function getGainAt(envelope: readonly GainPoint[], timeMs: number): number {
	if (envelope.length === 0) return 1;
	for (let index = 0; index < envelope.length; index += 1) {
		const point = envelope[index];
		if (timeMs < point.timeMs) {
			const previous = envelope[index - 1];
			if (!previous || previous.gain === point.gain) return previous?.gain ?? 1;
			const span = point.timeMs - previous.timeMs;
			if (span <= 0) return point.gain;
			return (
				previous.gain + ((point.gain - previous.gain) * (timeMs - previous.timeMs)) / span
			);
		}
	}
	return envelope[envelope.length - 1]?.gain ?? 1;
}
