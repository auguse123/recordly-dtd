import { type GainPoint, getGainAt } from "../clipTransitions";
import type { AudioRegion, ClipRegion } from "../types";
import { getClipSourceEndMs, getClipSourceStartMs } from "../types";

export interface TimeRangeMs {
	startMs: number;
	endMs: number;
}

/** A stretch of source audio laid on the output timeline at `speed`. */
export interface SourceToOutputSegment {
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
	outputStartMs: number;
}

/** Music volume while the voice speaks, as a fraction of the region volume. */
export const DEFAULT_DUCKING_LEVEL = 0.25;
export const MIN_DUCKING_LEVEL = 0.05;
/** Time the music takes to dip before the voice starts. */
export const DUCKING_ATTACK_MS = 250;
/** Time the music takes to come back once the voice stops. */
export const DUCKING_RELEASE_MS = 700;
export const MAX_REGION_FADE_MS = 10_000;

const SPEECH_WINDOW_MS = 20;
/** Pauses shorter than this stay inside one spoken phrase. */
const SPEECH_MERGE_GAP_MS = 350;
/** Isolated bursts shorter than this (clicks, breaths) are ignored. */
const SPEECH_MIN_DURATION_MS = 150;
const SPEECH_ABSOLUTE_FLOOR_DB = -55;
const SPEECH_MIN_MARGIN_DB = 10;
/** A track whose loud parts sit this close to its floor carries no speech. */
const SPEECH_MIN_DYNAMIC_RANGE_DB = 8;

export interface AudioRegionMix {
	fadeInMs: number;
	fadeOutMs: number;
	ducking: boolean;
	duckingLevel: number;
}

function clampFade(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.round(Math.max(0, Math.min(MAX_REGION_FADE_MS, value)))
		: 0;
}

export function normalizeDuckingLevel(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(MIN_DUCKING_LEVEL, Math.min(1, value))
		: DEFAULT_DUCKING_LEVEL;
}

export function getAudioRegionMix(
	region: Pick<AudioRegion, "fadeInMs" | "fadeOutMs" | "ducking" | "duckingLevel">,
): AudioRegionMix {
	return {
		fadeInMs: clampFade(region.fadeInMs),
		fadeOutMs: clampFade(region.fadeOutMs),
		ducking: Boolean(region.ducking),
		duckingLevel: normalizeDuckingLevel(region.duckingLevel),
	};
}

export function hasDuckingRegion(regions: readonly AudioRegion[]): boolean {
	return regions.some((region) => Boolean(region.ducking));
}

function percentile(sorted: Float32Array, fraction: number): number {
	if (sorted.length === 0) return Number.NEGATIVE_INFINITY;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)));
	return sorted[index];
}

function mergeRanges(ranges: TimeRangeMs[], maxGapMs: number): TimeRangeMs[] {
	const sorted = ranges
		.filter((range) => range.endMs > range.startMs)
		.sort((a, b) => a.startMs - b.startMs);
	const merged: TimeRangeMs[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.startMs - last.endMs <= maxGapMs) {
			last.endMs = Math.max(last.endMs, range.endMs);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

/**
 * Finds when someone speaks in a voice track, from its loudness in 20 ms
 * windows against the track's own noise floor. Times are relative to the
 * start of `channels`, shifted by `offsetMs`.
 */
export function detectSpeechRanges(
	channels: readonly Float32Array[],
	sampleRate: number,
	offsetMs = 0,
): TimeRangeMs[] {
	const length = channels[0]?.length ?? 0;
	const windowSize = Math.max(1, Math.round((sampleRate * SPEECH_WINDOW_MS) / 1000));
	const windowCount = Math.floor(length / windowSize);
	if (windowCount === 0 || channels.length === 0) return [];

	const levels = new Float32Array(windowCount);
	for (let window = 0; window < windowCount; window += 1) {
		const start = window * windowSize;
		let energy = 0;
		for (const channel of channels) {
			for (let index = start; index < start + windowSize; index += 1) {
				const sample = channel[index];
				energy += sample * sample;
			}
		}
		const meanSquare = energy / (windowSize * channels.length);
		levels[window] = 10 * Math.log10(meanSquare + 1e-12);
	}

	const sorted = levels.slice().sort();
	const floor = percentile(sorted, 0.15);
	const loud = percentile(sorted, 0.95);
	if (loud < SPEECH_ABSOLUTE_FLOOR_DB || loud - floor < SPEECH_MIN_DYNAMIC_RANGE_DB) {
		return [];
	}
	const threshold = Math.max(
		SPEECH_ABSOLUTE_FLOOR_DB,
		floor + Math.max(SPEECH_MIN_MARGIN_DB, (loud - floor) * 0.35),
	);

	const raw: TimeRangeMs[] = [];
	let runStart = -1;
	for (let window = 0; window <= windowCount; window += 1) {
		const active = window < windowCount && levels[window] >= threshold;
		if (active && runStart < 0) runStart = window;
		if (!active && runStart >= 0) {
			raw.push({
				startMs: offsetMs + runStart * SPEECH_WINDOW_MS,
				endMs: offsetMs + window * SPEECH_WINDOW_MS,
			});
			runStart = -1;
		}
	}

	return mergeRanges(raw, SPEECH_MERGE_GAP_MS).filter(
		(range) => range.endMs - range.startMs >= SPEECH_MIN_DURATION_MS,
	);
}

/** Lays source-time ranges onto the output timeline, dropping what was cut. */
export function mapSourceRangesToOutput(
	ranges: readonly TimeRangeMs[],
	segments: readonly SourceToOutputSegment[],
): TimeRangeMs[] {
	const mapped: TimeRangeMs[] = [];
	for (const segment of segments) {
		const speed = segment.speed > 0 ? segment.speed : 1;
		for (const range of ranges) {
			const startMs = Math.max(range.startMs, segment.sourceStartMs);
			const endMs = Math.min(range.endMs, segment.sourceEndMs);
			if (endMs <= startMs) continue;
			mapped.push({
				startMs: segment.outputStartMs + (startMs - segment.sourceStartMs) / speed,
				endMs: segment.outputStartMs + (endMs - segment.sourceStartMs) / speed,
			});
		}
	}
	return mergeRanges(mapped, 0);
}

/** Audible clips of the edited timeline, as source-to-output segments. */
export function getClipOutputSegments(clips: readonly ClipRegion[]): SourceToOutputSegment[] {
	return clips
		.filter((clip) => !clip.muted && clip.endMs > clip.startMs)
		.map((clip) => ({
			sourceStartMs: getClipSourceStartMs(clip),
			sourceEndMs: getClipSourceEndMs(clip),
			speed: clip.speed,
			outputStartMs: clip.startMs,
		}));
}

/**
 * Gain curve (output ms) that lowers music to `level` while the voice speaks:
 * it dips just before each phrase and swells back after it. Phrases closer
 * than a dip and a swell stay ducked in between.
 */
export function buildDuckingEnvelope(
	speechRanges: readonly TimeRangeMs[],
	level: number,
): GainPoint[] {
	const duckedGain = normalizeDuckingLevel(level);
	if (duckedGain >= 1) return [];
	const phrases = mergeRanges([...speechRanges], DUCKING_ATTACK_MS + DUCKING_RELEASE_MS);
	const points: GainPoint[] = [];
	for (const phrase of phrases) {
		points.push({ timeMs: phrase.startMs - DUCKING_ATTACK_MS, gain: 1 });
		points.push({ timeMs: phrase.startMs, gain: duckedGain });
		points.push({ timeMs: phrase.endMs, gain: duckedGain });
		points.push({ timeMs: phrase.endMs + DUCKING_RELEASE_MS, gain: 1 });
	}
	return points;
}

/** Fade-in and fade-out of one region, in output ms. */
export function buildRegionFadeEnvelope(
	region: Pick<AudioRegion, "startMs" | "endMs" | "fadeInMs" | "fadeOutMs">,
): GainPoint[] {
	const durationMs = Math.max(0, region.endMs - region.startMs);
	const mix = getAudioRegionMix(region);
	let fadeInMs = Math.min(mix.fadeInMs, durationMs);
	let fadeOutMs = Math.min(mix.fadeOutMs, durationMs);
	if (fadeInMs + fadeOutMs > durationMs) {
		const scale = durationMs / (fadeInMs + fadeOutMs);
		fadeInMs *= scale;
		fadeOutMs *= scale;
	}
	const points: GainPoint[] = [];
	if (fadeInMs > 0) {
		points.push({ timeMs: region.startMs, gain: 0 });
		points.push({ timeMs: region.startMs + fadeInMs, gain: 1 });
	}
	if (fadeOutMs > 0) {
		points.push({ timeMs: region.endMs - fadeOutMs, gain: 1 });
		points.push({ timeMs: region.endMs, gain: 0 });
	}
	return points;
}

/**
 * Combined fade and ducking curve of one region. The product of the two
 * curves is sampled at both curves' breakpoints, which keeps it linear
 * between them.
 */
export function buildAudioRegionGainEnvelope(
	region: AudioRegion,
	speechRanges: readonly TimeRangeMs[],
): GainPoint[] {
	const fade = buildRegionFadeEnvelope(region);
	const mix = getAudioRegionMix(region);
	const ducking = mix.ducking
		? buildDuckingEnvelope(
				speechRanges.filter(
					(range) =>
						range.endMs + DUCKING_RELEASE_MS > region.startMs &&
						range.startMs - DUCKING_ATTACK_MS < region.endMs,
				),
				mix.duckingLevel,
			)
		: [];
	if (ducking.length === 0) return fade;
	if (fade.length === 0) return ducking;

	const times = [...new Set([...fade, ...ducking].map((point) => point.timeMs))].sort(
		(a, b) => a - b,
	);
	return times.map((timeMs) => ({
		timeMs,
		gain: getGainAt(fade, timeMs) * getGainAt(ducking, timeMs),
	}));
}

export { getGainAt as getEnvelopeGainAt };
