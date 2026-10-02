import { changeClipSpan } from "../clipSpanChange";
import {
	type ClipRegion,
	findClipAtTimelineTime,
	getClipSourceStartMs,
	sortClipRegions,
} from "../types";

export const DETACHED_AUDIO_CLIP_ID_PREFIX = "aclip-";
export const MIN_AUDIO_CLIP_DURATION_MS = 50;
export const MAX_AUDIO_CLIP_VOLUME = 2;

function safeSpeed(clip: ClipRegion): number {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

export function getAudioClipVolume(clip: Pick<ClipRegion, "volume">): number {
	return typeof clip.volume === "number" && Number.isFinite(clip.volume)
		? Math.max(0, Math.min(MAX_AUDIO_CLIP_VOLUME, clip.volume))
		: 1;
}

/**
 * Copies the video clips into independent audio clips: same timing and
 * source, but without transitions or per-clip track display.
 */
export function detachClipAudio(clips: ClipRegion[], createId: () => string): ClipRegion[] {
	return sortClipRegions(clips)
		.filter((clip) => clip.endMs > clip.startMs)
		.map((clip) => ({
			id: createId(),
			startMs: clip.startMs,
			endMs: clip.endMs,
			sourceStartMs: getClipSourceStartMs(clip),
			...(clip.sourceMinMs !== undefined ? { sourceMinMs: clip.sourceMinMs } : {}),
			...(clip.sourceMaxMs !== undefined ? { sourceMaxMs: clip.sourceMaxMs } : {}),
			speed: safeSpeed(clip),
			...(clip.muted ? { muted: true } : {}),
		}));
}

export function findAudioClipAt(timeMs: number, clips: ClipRegion[]): ClipRegion | null {
	return findClipAtTimelineTime(timeMs, clips);
}

/** Where in the recording an audio clip reads at timeline time `timeMs`. */
export function getAudioClipSourceTimeMs(clip: ClipRegion, timeMs: number): number {
	return getClipSourceStartMs(clip) + (timeMs - clip.startMs) * safeSpeed(clip);
}

/** Splits the audio clip `id` at `atMs`, or returns null when the cut is too close to an edge. */
export function splitAudioClip(
	clips: ClipRegion[],
	id: string,
	atMs: number,
	newId: string,
): ClipRegion[] | null {
	const target = clips.find((clip) => clip.id === id);
	const cutMs = Math.round(atMs);
	if (
		!target ||
		cutMs - target.startMs < MIN_AUDIO_CLIP_DURATION_MS ||
		target.endMs - cutMs < MIN_AUDIO_CLIP_DURATION_MS
	) {
		return null;
	}
	const sourceStartMs = getClipSourceStartMs(target);
	const left: ClipRegion = { ...target, sourceStartMs, endMs: cutMs };
	const right: ClipRegion = {
		...target,
		id: newId,
		startMs: cutMs,
		sourceStartMs: Math.round(getAudioClipSourceTimeMs(target, cutMs)),
	};
	return clips.flatMap((clip) => (clip.id === id ? [left, right] : [clip]));
}

/**
 * Moves or trims one audio clip. A move keeps the sound it plays; a trim
 * reveals or hides sound (J/L cuts) within the recording. The clip stays
 * inside the timeline and never overlaps its neighbours.
 */
export function changeAudioClipSpan(
	clips: ClipRegion[],
	id: string,
	startMs: number,
	endMs: number,
	sourceDurationMs: number,
	timelineDurationMs: number,
): ClipRegion[] {
	const target = clips.find((clip) => clip.id === id);
	if (!target) return clips;
	const isMove = startMs - target.startMs === endMs - target.endMs;
	let start = Math.round(startMs);
	let end = Math.round(endMs);
	if (isMove) {
		const duration = target.endMs - target.startMs;
		start = Math.max(0, Math.min(start, timelineDurationMs - duration));
		end = start + duration;
	} else {
		start = Math.max(0, start);
		end = Math.min(timelineDurationMs, end);
	}
	const changed = changeClipSpan(target, start, end, sourceDurationMs);
	if (changed.endMs - changed.startMs < MIN_AUDIO_CLIP_DURATION_MS) return clips;
	const overlaps = clips.some(
		(clip) => clip.id !== id && clip.startMs < changed.endMs && clip.endMs > changed.startMs,
	);
	if (overlaps) return clips;
	return clips.map((clip) => (clip.id === id ? changed : clip));
}

/** Drops audio past the end of the video and trims the clip that crosses it. */
export function clampAudioClipsToDuration(
	clips: ClipRegion[],
	timelineDurationMs: number,
): ClipRegion[] {
	let changed = false;
	const next = clips.flatMap((clip) => {
		if (clip.endMs <= timelineDurationMs) return [clip];
		changed = true;
		if (timelineDurationMs - clip.startMs < MIN_AUDIO_CLIP_DURATION_MS) return [];
		return [{ ...clip, sourceStartMs: getClipSourceStartMs(clip), endMs: timelineDurationMs }];
	});
	return changed ? next : clips;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Validates persisted audio clips; anything unusable means "audio linked". */
export function normalizeAudioClipRegions(value: unknown): ClipRegion[] | null {
	if (!Array.isArray(value)) return null;
	const clips: ClipRegion[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") continue;
		const candidate = raw as Partial<ClipRegion>;
		const startMs = finiteNumber(candidate.startMs);
		const endMs = finiteNumber(candidate.endMs);
		if (typeof candidate.id !== "string" || startMs === undefined || endMs === undefined) {
			continue;
		}
		const start = Math.max(0, Math.round(startMs));
		const end = Math.round(endMs);
		if (end - start < 1) continue;
		const speed = finiteNumber(candidate.speed);
		const sourceStartMs = finiteNumber(candidate.sourceStartMs);
		const sourceMinMs = finiteNumber(candidate.sourceMinMs);
		const sourceMaxMs = finiteNumber(candidate.sourceMaxMs);
		const volume = finiteNumber(candidate.volume);
		clips.push({
			id: candidate.id,
			startMs: start,
			endMs: end,
			sourceStartMs: Math.max(0, Math.round(sourceStartMs ?? start)),
			...(sourceMinMs !== undefined ? { sourceMinMs } : {}),
			...(sourceMaxMs !== undefined ? { sourceMaxMs } : {}),
			speed: speed !== undefined && speed > 0 ? speed : 1,
			...(candidate.muted === true ? { muted: true } : {}),
			...(volume !== undefined ? { volume: getAudioClipVolume({ volume }) } : {}),
		});
	}
	const sorted = sortClipRegions(clips);
	// Persisted clips must not overlap; keep the earliest of any pair.
	const result: ClipRegion[] = [];
	for (const clip of sorted) {
		const previous = result[result.length - 1];
		if (previous && clip.startMs < previous.endMs) continue;
		result.push(clip);
	}
	return result;
}

/** Next free `aclip-N` number after the given audio clips. */
export function nextAudioClipNumber(clips: readonly ClipRegion[] | null | undefined): number {
	let max = 0;
	for (const clip of clips ?? []) {
		if (!clip.id.startsWith(DETACHED_AUDIO_CLIP_ID_PREFIX)) continue;
		const value = Number(clip.id.slice(DETACHED_AUDIO_CLIP_ID_PREFIX.length));
		if (Number.isFinite(value)) max = Math.max(max, value);
	}
	return max + 1;
}
