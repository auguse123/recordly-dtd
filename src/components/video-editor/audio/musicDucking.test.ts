import { describe, expect, it } from "vitest";
import { getGainAt } from "../clipTransitions";
import type { AudioRegion } from "../types";
import {
	buildAudioRegionGainEnvelope,
	buildDuckingEnvelope,
	buildRegionFadeEnvelope,
	DEFAULT_DUCKING_LEVEL,
	DUCKING_ATTACK_MS,
	DUCKING_RELEASE_MS,
	detectSpeechRanges,
	getAudioRegionMix,
	mapSourceRangesToOutput,
} from "./musicDucking";

const SAMPLE_RATE = 16_000;

/** Quiet noise with loud tone bursts in the given ms ranges. */
function makeVoiceTrack(durationMs: number, bursts: Array<[number, number]>): Float32Array {
	const samples = new Float32Array(Math.round((durationMs / 1000) * SAMPLE_RATE));
	let seed = 1;
	for (let index = 0; index < samples.length; index += 1) {
		seed = (seed * 16807) % 2147483647;
		samples[index] = ((seed / 2147483647) * 2 - 1) * 0.002;
	}
	for (const [startMs, endMs] of bursts) {
		const start = Math.round((startMs / 1000) * SAMPLE_RATE);
		const end = Math.round((endMs / 1000) * SAMPLE_RATE);
		for (let index = start; index < end; index += 1) {
			samples[index] += 0.4 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE);
		}
	}
	return samples;
}

function region(patch: Partial<AudioRegion> = {}): AudioRegion {
	return {
		id: "music",
		startMs: 0,
		endMs: 10_000,
		audioPath: "/music.mp3",
		volume: 1,
		...patch,
	};
}

describe("detectSpeechRanges", () => {
	it("finds loud phrases above the noise floor", () => {
		const track = makeVoiceTrack(10_000, [
			[1_000, 3_000],
			[6_000, 7_500],
		]);
		const ranges = detectSpeechRanges([track], SAMPLE_RATE);
		expect(ranges).toHaveLength(2);
		expect(ranges[0].startMs).toBeCloseTo(1_000, -2);
		expect(ranges[0].endMs).toBeCloseTo(3_000, -2);
		expect(ranges[1].startMs).toBeCloseTo(6_000, -2);
		expect(ranges[1].endMs).toBeCloseTo(7_500, -2);
	});

	it("keeps short pauses inside one phrase and drops clicks", () => {
		const track = makeVoiceTrack(8_000, [
			[1_000, 2_000],
			[2_200, 3_000],
			[5_000, 5_060],
		]);
		const ranges = detectSpeechRanges([track], SAMPLE_RATE);
		expect(ranges).toHaveLength(1);
		expect(ranges[0].startMs).toBeCloseTo(1_000, -2);
		expect(ranges[0].endMs).toBeCloseTo(3_000, -2);
	});

	it("finds nothing in steady noise or silence", () => {
		expect(detectSpeechRanges([makeVoiceTrack(5_000, [])], SAMPLE_RATE)).toEqual([]);
		expect(detectSpeechRanges([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE)).toEqual([]);
	});

	it("shifts ranges by the track offset", () => {
		const track = makeVoiceTrack(4_000, [[1_000, 2_000]]);
		const [range] = detectSpeechRanges([track], SAMPLE_RATE, 500);
		expect(range.startMs).toBeCloseTo(1_500, -2);
	});
});

describe("mapSourceRangesToOutput", () => {
	it("follows clips moved, sped up and cut", () => {
		const ranges = mapSourceRangesToOutput(
			[{ startMs: 1_000, endMs: 3_000 }],
			[
				{ sourceStartMs: 0, sourceEndMs: 2_000, speed: 1, outputStartMs: 5_000 },
				{ sourceStartMs: 2_000, sourceEndMs: 4_000, speed: 2, outputStartMs: 0 },
			],
		);
		expect(ranges).toEqual([
			{ startMs: 0, endMs: 500 },
			{ startMs: 6_000, endMs: 7_000 },
		]);
	});

	it("drops speech from parts that were cut", () => {
		expect(
			mapSourceRangesToOutput(
				[{ startMs: 5_000, endMs: 6_000 }],
				[{ sourceStartMs: 0, sourceEndMs: 2_000, speed: 1, outputStartMs: 0 }],
			),
		).toEqual([]);
	});
});

describe("buildDuckingEnvelope", () => {
	it("dips before each phrase and swells back after", () => {
		const envelope = buildDuckingEnvelope([{ startMs: 2_000, endMs: 4_000 }], 0.2);
		expect(getGainAt(envelope, 1_000)).toBe(1);
		expect(getGainAt(envelope, 2_000 - DUCKING_ATTACK_MS)).toBe(1);
		expect(getGainAt(envelope, 3_000)).toBeCloseTo(0.2);
		expect(getGainAt(envelope, 4_000 + DUCKING_RELEASE_MS)).toBe(1);
		expect(getGainAt(envelope, 6_000)).toBe(1);
	});

	it("stays ducked across short gaps between phrases", () => {
		const envelope = buildDuckingEnvelope(
			[
				{ startMs: 1_000, endMs: 2_000 },
				{ startMs: 2_500, endMs: 3_000 },
			],
			0.3,
		);
		expect(getGainAt(envelope, 2_250)).toBeCloseTo(0.3);
	});
});

describe("buildRegionFadeEnvelope", () => {
	it("fades in and out at the region edges", () => {
		const envelope = buildRegionFadeEnvelope(region({ fadeInMs: 1_000, fadeOutMs: 2_000 }));
		expect(getGainAt(envelope, 0)).toBe(0);
		expect(getGainAt(envelope, 500)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 5_000)).toBe(1);
		expect(getGainAt(envelope, 9_000)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 10_000)).toBe(0);
	});

	it("shrinks fades longer than the region", () => {
		const envelope = buildRegionFadeEnvelope(
			region({ endMs: 2_000, fadeInMs: 3_000, fadeOutMs: 1_000 }),
		);
		// 2 s fade in + 1 s fade out squeezed into 2 s, in proportion.
		expect(getGainAt(envelope, 4_000 / 3)).toBeCloseTo(1);
		expect(getGainAt(envelope, 1_500)).toBeCloseTo(0.75);
		expect(getGainAt(envelope, 2_000)).toBe(0);
	});

	it("is empty without fades", () => {
		expect(buildRegionFadeEnvelope(region())).toEqual([]);
	});
});

describe("buildAudioRegionGainEnvelope", () => {
	const speech = [{ startMs: 4_000, endMs: 6_000 }];

	it("ignores speech when ducking is off", () => {
		expect(buildAudioRegionGainEnvelope(region(), speech)).toEqual([]);
	});

	it("combines fades and ducking", () => {
		const envelope = buildAudioRegionGainEnvelope(
			region({ fadeInMs: 1_000, ducking: true, duckingLevel: 0.5 }),
			speech,
		);
		expect(getGainAt(envelope, 500)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 2_000)).toBe(1);
		expect(getGainAt(envelope, 5_000)).toBeCloseTo(0.5);
	});

	it("skips speech outside the region", () => {
		expect(
			buildAudioRegionGainEnvelope(
				region({ startMs: 20_000, endMs: 30_000, ducking: true }),
				speech,
			),
		).toEqual([]);
	});
});

describe("getAudioRegionMix", () => {
	it("fills defaults and clamps values", () => {
		expect(getAudioRegionMix({})).toEqual({
			fadeInMs: 0,
			fadeOutMs: 0,
			ducking: false,
			duckingLevel: DEFAULT_DUCKING_LEVEL,
		});
		expect(
			getAudioRegionMix({ fadeInMs: -5, fadeOutMs: 99_999, ducking: true, duckingLevel: 4 }),
		).toEqual({ fadeInMs: 0, fadeOutMs: 10_000, ducking: true, duckingLevel: 1 });
	});
});
