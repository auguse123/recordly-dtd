import { changeClipSpan } from "../clipSpanChange";
import {
	type ClipRegion,
	findClipAtTimelineTime,
	getClipSourceEndMs,
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
		? clampAudioClipVolume(clip.volume)
		: 1;
}

function clampAudioClipVolume(volume: number): number {
	return Math.max(0, Math.min(MAX_AUDIO_CLIP_VOLUME, volume));
}

type AudioClipTrackFields = Pick<ClipRegion, "trackVolumes" | "mutedTracks">;

/** Volume of one source track within an audio clip, mute aside (1 when unset). */
export function getAudioClipTrackVolume(clip: AudioClipTrackFields, trackId: string): number {
	const volume = clip.trackVolumes?.[trackId];
	return typeof volume === "number" && Number.isFinite(volume) ? clampAudioClipVolume(volume) : 1;
}

export function isAudioClipTrackMuted(clip: AudioClipTrackFields, trackId: string): boolean {
	return clip.mutedTracks?.includes(trackId) === true;
}

/** What one source track contributes within an audio clip: its volume, 0 when muted. */
export function getAudioClipTrackGain(clip: AudioClipTrackFields, trackId: string): number {
	return isAudioClipTrackMuted(clip, trackId) ? 0 : getAudioClipTrackVolume(clip, trackId);
}

/** Gains of the tracks an audio clip sets apart, or undefined when all play as-is. */
export function getAudioClipTrackGains(
	clip: AudioClipTrackFields,
): Record<string, number> | undefined {
	const trackIds = new Set([
		...Object.keys(clip.trackVolumes ?? {}),
		...(clip.mutedTracks ?? []),
	]);
	if (trackIds.size === 0) return undefined;
	const gains: Record<string, number> = {};
	for (const trackId of trackIds) gains[trackId] = getAudioClipTrackGain(clip, trackId);
	return gains;
}

function withTrackVolume(clip: ClipRegion, trackId: string, volume: number): ClipRegion {
	const { [trackId]: _previous, ...others } = clip.trackVolumes ?? {};
	const { trackVolumes: _volumes, ...rest } = clip;
	const trackVolumes = volume === 1 ? others : { ...others, [trackId]: volume };
	return Object.keys(trackVolumes).length > 0 ? { ...rest, trackVolumes } : rest;
}

function withTrackMuted(clip: ClipRegion, trackId: string, muted: boolean): ClipRegion {
	const others = (clip.mutedTracks ?? []).filter((id) => id !== trackId);
	const { mutedTracks: _muted, ...rest } = clip;
	const mutedTracks = muted ? [...others, trackId] : others;
	return mutedTracks.length > 0 ? { ...rest, mutedTracks } : rest;
}

/** Sets one track's volume in the given audio clips (all clips when `ids` is null). */
export function setAudioClipTrackVolume(
	clips: ClipRegion[],
	ids: ReadonlySet<string> | null,
	trackId: string,
	volume: number,
): ClipRegion[] {
	const value = Number.isFinite(volume) ? clampAudioClipVolume(volume) : 1;
	return clips.map((clip) =>
		(ids && !ids.has(clip.id)) || getAudioClipTrackVolume(clip, trackId) === value
			? clip
			: withTrackVolume(clip, trackId, value),
	);
}

/** Mutes or unmutes one track in the given audio clips (all clips when `ids` is null). */
export function setAudioClipTrackMuted(
	clips: ClipRegion[],
	ids: ReadonlySet<string> | null,
	trackId: string,
	muted: boolean,
): ClipRegion[] {
	return clips.map((clip) =>
		(ids && !ids.has(clip.id)) || isAudioClipTrackMuted(clip, trackId) === muted
			? clip
			: withTrackMuted(clip, trackId, muted),
	);
}

export function getAudioClipSyncOffsetMs(clip: Pick<ClipRegion, "syncOffsetMs">): number {
	return typeof clip.syncOffsetMs === "number" && Number.isFinite(clip.syncOffsetMs)
		? Math.round(clip.syncOffsetMs)
		: 0;
}

/** Sets the sync offset of the given audio clips (all clips when `ids` is null). */
export function setAudioClipSyncOffset(
	clips: ClipRegion[],
	ids: ReadonlySet<string> | null,
	offsetMs: number,
): ClipRegion[] {
	const value = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
	return clips.map((clip) => {
		if (ids && !ids.has(clip.id)) return clip;
		if (getAudioClipSyncOffsetMs(clip) === value) return clip;
		const { syncOffsetMs: _previous, ...rest } = clip;
		return value === 0 ? rest : { ...rest, syncOffsetMs: value };
	});
}

/** The recording span an audio clip reads once its sync offset is applied, unclamped. */
export function getAudioClipSyncedSourceSpan(clip: ClipRegion): { start: number; end: number } {
	const shiftMs = getAudioClipSyncOffsetMs(clip) * safeSpeed(clip);
	return {
		start: getClipSourceStartMs(clip) - shiftMs,
		end: getClipSourceEndMs(clip) - shiftMs,
	};
}

/**
 * Bakes each clip's sync offset into where it reads in the recording, the
 * form playback and export work with. The part of a clip that would read
 * before or after its recording is trimmed to silence; a clip with nothing
 * left to play is dropped. Returns `clips` itself when no clip is offset.
 */
export function resolveAudioClipSync(clips: ClipRegion[]): ClipRegion[] {
	if (!clips.some((clip) => getAudioClipSyncOffsetMs(clip) !== 0)) return clips;
	return clips.flatMap((clip) => {
		const offsetMs = getAudioClipSyncOffsetMs(clip);
		const { syncOffsetMs: _offset, ...rest } = clip;
		if (offsetMs === 0) return [rest];
		const speed = safeSpeed(clip);
		const span = getAudioClipSyncedSourceSpan(clip);
		const minSourceMs = Number.isFinite(clip.sourceMinMs) ? (clip.sourceMinMs as number) : 0;
		const maxSourceMs = Number.isFinite(clip.sourceMaxMs) ? (clip.sourceMaxMs as number) : null;
		let startMs = clip.startMs;
		let endMs = clip.endMs;
		let sourceStartMs = span.start;
		if (sourceStartMs < minSourceMs) {
			startMs += (minSourceMs - sourceStartMs) / speed;
			sourceStartMs = minSourceMs;
		}
		if (maxSourceMs !== null && span.end > maxSourceMs) {
			endMs -= (span.end - maxSourceMs) / speed;
		}
		startMs = Math.round(startMs);
		endMs = Math.round(endMs);
		if (endMs - startMs < 1) return [];
		return [{ ...rest, startMs, endMs, sourceStartMs: Math.round(sourceStartMs) }];
	});
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

function normalizeTrackVolumes(value: unknown): Record<string, number> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const volumes: Record<string, number> = {};
	for (const [trackId, volume] of Object.entries(value)) {
		const finite = finiteNumber(volume);
		if (finite !== undefined && finite !== 1) volumes[trackId] = clampAudioClipVolume(finite);
	}
	return Object.keys(volumes).length > 0 ? volumes : undefined;
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
		const syncOffsetMs = finiteNumber(candidate.syncOffsetMs);
		const trackVolumes = normalizeTrackVolumes(candidate.trackVolumes);
		const mutedTracks = Array.isArray(candidate.mutedTracks)
			? [...new Set(candidate.mutedTracks.filter((id) => typeof id === "string"))]
			: [];
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
			...(syncOffsetMs ? { syncOffsetMs: Math.round(syncOffsetMs) } : {}),
			...(trackVolumes ? { trackVolumes } : {}),
			...(mutedTracks.length > 0 ? { mutedTracks } : {}),
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
