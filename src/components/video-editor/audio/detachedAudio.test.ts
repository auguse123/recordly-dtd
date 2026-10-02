import { describe, expect, it } from "vitest";
import type { ClipRegion } from "../types";
import {
	changeAudioClipSpan,
	clampAudioClipsToDuration,
	detachClipAudio,
	findAudioClipAt,
	getAudioClipSourceTimeMs,
	getAudioClipVolume,
	nextAudioClipNumber,
	normalizeAudioClipRegions,
	splitAudioClip,
} from "./detachedAudio";

function clip(patch: Partial<ClipRegion> & Pick<ClipRegion, "id">): ClipRegion {
	return { startMs: 0, endMs: 1_000, speed: 1, ...patch };
}

describe("detachClipAudio", () => {
	it("copies timing and source, dropping video-only settings", () => {
		let n = 1;
		const audio = detachClipAudio(
			[
				clip({
					id: "b",
					startMs: 1_000,
					endMs: 3_000,
					sourceStartMs: 5_000,
					speed: 2,
					transitionOut: { type: "dip", durationMs: 300 },
					showSourceAudio: true,
				}),
				clip({ id: "a", muted: true }),
			],
			() => `aclip-${n++}`,
		);
		expect(audio).toEqual([
			{ id: "aclip-1", startMs: 0, endMs: 1_000, sourceStartMs: 0, speed: 1, muted: true },
			{ id: "aclip-2", startMs: 1_000, endMs: 3_000, sourceStartMs: 5_000, speed: 2 },
		]);
	});
});

describe("getAudioClipSourceTimeMs", () => {
	it("maps timeline time through the clip source and speed", () => {
		const audio = clip({
			id: "a",
			startMs: 1_000,
			endMs: 2_000,
			sourceStartMs: 4_000,
			speed: 2,
		});
		expect(getAudioClipSourceTimeMs(audio, 1_500)).toBe(5_000);
		expect(findAudioClipAt(1_500, [audio])?.id).toBe("a");
		expect(findAudioClipAt(2_000, [audio])).toBeNull();
	});
});

describe("splitAudioClip", () => {
	it("cuts one clip in two that play the same sound", () => {
		const audio = clip({ id: "a", startMs: 0, endMs: 2_000, sourceStartMs: 1_000, speed: 2 });
		const next = splitAudioClip([audio], "a", 500, "aclip-9");
		expect(next).toEqual([
			{ ...audio, endMs: 500 },
			{ ...audio, id: "aclip-9", startMs: 500, sourceStartMs: 2_000 },
		]);
	});

	it("refuses cuts at the edges", () => {
		const audio = clip({ id: "a" });
		expect(splitAudioClip([audio], "a", 10, "x")).toBeNull();
		expect(splitAudioClip([audio], "missing", 500, "x")).toBeNull();
	});
});

describe("changeAudioClipSpan", () => {
	const clips = [
		clip({ id: "a", startMs: 0, endMs: 1_000, sourceStartMs: 0 }),
		clip({ id: "b", startMs: 2_000, endMs: 3_000, sourceStartMs: 2_000 }),
	];

	it("extends an edge into the recording (J/L cut)", () => {
		const next = changeAudioClipSpan(clips, "a", 0, 1_500, 10_000, 5_000);
		expect(next[0]).toMatchObject({ startMs: 0, endMs: 1_500, sourceStartMs: 0 });
		const left = changeAudioClipSpan(clips, "b", 1_600, 3_000, 10_000, 5_000);
		expect(left[1]).toMatchObject({ startMs: 1_600, sourceStartMs: 1_600 });
	});

	it("moves a clip without changing its sound", () => {
		const next = changeAudioClipSpan(clips, "b", 3_500, 4_500, 10_000, 5_000);
		expect(next[1]).toMatchObject({ startMs: 3_500, endMs: 4_500, sourceStartMs: 2_000 });
	});

	it("keeps clips inside the timeline", () => {
		const next = changeAudioClipSpan(clips, "b", 4_500, 5_500, 10_000, 5_000);
		expect(next[1]).toMatchObject({ startMs: 4_000, endMs: 5_000 });
	});

	it("rejects overlaps", () => {
		expect(changeAudioClipSpan(clips, "a", 0, 2_500, 10_000, 5_000)).toBe(clips);
	});
});

describe("clampAudioClipsToDuration", () => {
	it("trims the crossing clip and drops later ones", () => {
		const clips = [
			clip({ id: "a", startMs: 0, endMs: 1_000 }),
			clip({ id: "b", startMs: 1_000, endMs: 3_000, sourceStartMs: 1_000 }),
			clip({ id: "c", startMs: 3_000, endMs: 4_000 }),
		];
		expect(clampAudioClipsToDuration(clips, 2_000)).toEqual([
			clips[0],
			{ ...clips[1], endMs: 2_000 },
		]);
		expect(clampAudioClipsToDuration(clips, 5_000)).toBe(clips);
	});
});

describe("normalizeAudioClipRegions", () => {
	it("keeps valid clips, sorted and without overlaps", () => {
		expect(normalizeAudioClipRegions(null)).toBeNull();
		expect(normalizeAudioClipRegions("x")).toBeNull();
		expect(
			normalizeAudioClipRegions([
				{ id: "b", startMs: 500, endMs: 900, speed: 1 },
				{ id: "a", startMs: 0, endMs: 600, speed: -1, volume: 5, muted: true },
				{ id: "bad", startMs: 0 },
				"nope",
			]),
		).toEqual([
			{ id: "a", startMs: 0, endMs: 600, sourceStartMs: 0, speed: 1, muted: true, volume: 2 },
		]);
	});
});

describe("helpers", () => {
	it("reads volume and next id", () => {
		expect(getAudioClipVolume({})).toBe(1);
		expect(getAudioClipVolume({ volume: -1 })).toBe(0);
		expect(nextAudioClipNumber([clip({ id: "aclip-4" }), clip({ id: "clip-9" })])).toBe(5);
		expect(nextAudioClipNumber(null)).toBe(1);
	});
});
