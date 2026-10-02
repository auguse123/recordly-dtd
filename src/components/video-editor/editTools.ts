import { planClipSplit } from "./clipSplit";
import { type ClipRegion, sortClipRegions } from "./types";

/** In/out marks on the edited timeline (ms). Either side may be unset. */
export interface TimelineMarks {
	inMs: number | null;
	outMs: number | null;
}

export const EMPTY_TIMELINE_MARKS: TimelineMarks = { inMs: null, outMs: null };

/** One frame at the 30 fps the arrow keys step by. */
export const FRAME_STEP_MS = 1000 / 30;

/** Setting one mark past the other drops the other, like DaVinci. */
export function setTimelineMark(
	marks: TimelineMarks,
	side: "in" | "out",
	ms: number,
): TimelineMarks {
	const value = Math.max(0, Math.round(ms));
	if (side === "in") {
		return {
			inMs: value,
			outMs: marks.outMs !== null && marks.outMs > value ? marks.outMs : null,
		};
	}
	return { inMs: marks.inMs !== null && marks.inMs < value ? marks.inMs : null, outMs: value };
}

/**
 * The span the marks cover. A lone in-point runs to the end of the edit, a lone
 * out-point from its start, so "I then delete" removes the tail in one go.
 */
export function getMarkedRange(
	marks: TimelineMarks,
	totalMs: number,
): { startMs: number; endMs: number } | null {
	if (marks.inMs === null && marks.outMs === null) return null;
	const startMs = Math.max(0, marks.inMs ?? 0);
	const endMs = Math.min(totalMs, marks.outMs ?? totalMs);
	return endMs - startMs >= 1 ? { startMs, endMs } : null;
}

function splitAt(clips: ClipRegion[], ms: number, createId: () => string): ClipRegion[] {
	const plan = planClipSplit({ clipRegions: clips, splitMs: ms, createId });
	if (!plan) return clips;
	return clips.flatMap((clip) => (clip.id === plan.targetId ? [plan.left, plan.right] : [clip]));
}

export interface RangeRemovalPlan {
	/** Same timeline as the input, cut at both range edges (ripple source). */
	before: ClipRegion[];
	/** `before` without the clips inside the range, still unpacked. */
	after: ClipRegion[];
	removedIds: string[];
}

/**
 * Cut the footage between `startMs` and `endMs` out of the sequence. The cuts
 * keep timeline positions, so `before` can drive the ripple of zooms,
 * annotations and audio; packing `after` then closes the gap.
 */
export function planRangeRemoval(params: {
	clipRegions: ClipRegion[];
	startMs: number;
	endMs: number;
	createId: () => string;
}): RangeRemovalPlan | null {
	const startMs = Math.round(Math.min(params.startMs, params.endMs));
	const endMs = Math.round(Math.max(params.startMs, params.endMs));
	if (!(endMs > startMs)) return null;

	const before = sortClipRegions(
		splitAt(splitAt(params.clipRegions, startMs, params.createId), endMs, params.createId),
	);
	const isInside = (clip: ClipRegion) => clip.startMs >= startMs && clip.endMs <= endMs;
	const after = before.filter((clip) => !isInside(clip));
	// Never leave an empty edit: there must be footage left to play.
	if (after.length === before.length || after.length === 0) return null;
	return { before, after, removedIds: before.filter(isInside).map((clip) => clip.id) };
}

/** Remove the part of the clip under the playhead before ("head") or after ("tail") it. */
export function planTrimToPlayhead(params: {
	clipRegions: ClipRegion[];
	playheadMs: number;
	side: "head" | "tail";
	createId: () => string;
}): RangeRemovalPlan | null {
	const playheadMs = Math.round(params.playheadMs);
	const clip = params.clipRegions.find(
		(candidate) => playheadMs > candidate.startMs && playheadMs < candidate.endMs,
	);
	if (!clip) return null;
	return planRangeRemoval({
		clipRegions: params.clipRegions,
		startMs: params.side === "head" ? clip.startMs : playheadMs,
		endMs: params.side === "head" ? playheadMs : clip.endMs,
		createId: params.createId,
	});
}

/** Every cut on the main track, including the start and end of the edit. */
export function getEditPoints(clipRegions: ClipRegion[]): number[] {
	const points = new Set<number>([0]);
	for (const clip of clipRegions) {
		points.add(Math.round(clip.startMs));
		points.add(Math.round(clip.endMs));
	}
	return [...points].sort((a, b) => a - b);
}

/** Next (1) or previous (-1) cut from `ms`; a few ms of tolerance skips the one we sit on. */
export function findAdjacentEditPoint(
	clipRegions: ClipRegion[],
	ms: number,
	direction: 1 | -1,
	toleranceMs = 5,
): number | null {
	const points = getEditPoints(clipRegions);
	if (direction > 0) return points.find((point) => point > ms + toleranceMs) ?? null;
	return [...points].reverse().find((point) => point < ms - toleranceMs) ?? null;
}
