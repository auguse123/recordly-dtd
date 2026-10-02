import { describe, expect, it } from "vitest";
import { packClipSequence } from "./clipSequence";
import {
	EMPTY_TIMELINE_MARKS,
	findAdjacentEditPoint,
	getEditPoints,
	getMarkedRange,
	planRangeRemoval,
	planTrimToPlayhead,
	setTimelineMark,
} from "./editTools";
import { type ClipRegion, getClipSourceStartMs } from "./types";

function createIdFactory() {
	let next = 1;
	return () => `new-${next++}`;
}

const twoClips: ClipRegion[] = [
	{ id: "a", startMs: 0, endMs: 4000, speed: 1 },
	{ id: "b", startMs: 4000, endMs: 10000, sourceStartMs: 4000, speed: 1 },
];

describe("timeline marks", () => {
	it("drops the opposite mark when they would cross", () => {
		const marked = setTimelineMark(
			setTimelineMark(EMPTY_TIMELINE_MARKS, "in", 2000),
			"out",
			5000,
		);
		expect(marked).toEqual({ inMs: 2000, outMs: 5000 });
		expect(setTimelineMark(marked, "in", 6000)).toEqual({ inMs: 6000, outMs: null });
		expect(setTimelineMark(marked, "out", 1000)).toEqual({ inMs: null, outMs: 1000 });
	});

	it("extends a lone mark to the edge of the edit", () => {
		expect(getMarkedRange({ inMs: 3000, outMs: null }, 10000)).toEqual({
			startMs: 3000,
			endMs: 10000,
		});
		expect(getMarkedRange({ inMs: null, outMs: 3000 }, 10000)).toEqual({
			startMs: 0,
			endMs: 3000,
		});
		expect(getMarkedRange(EMPTY_TIMELINE_MARKS, 10000)).toBeNull();
	});
});

describe("planRangeRemoval", () => {
	it("cuts a range spanning two clips and keeps the source in-points", () => {
		const plan = planRangeRemoval({
			clipRegions: twoClips,
			startMs: 3000,
			endMs: 6000,
			createId: createIdFactory(),
		});
		expect(plan).not.toBeNull();
		const packed = packClipSequence(plan!.after);
		expect(packed.map((clip) => [clip.startMs, clip.endMs])).toEqual([
			[0, 3000],
			[3000, 7000],
		]);
		expect(getClipSourceStartMs(packed[1])).toBe(6000);
		expect(plan!.before.map((clip) => [clip.startMs, clip.endMs])).toEqual([
			[0, 3000],
			[3000, 4000],
			[4000, 6000],
			[6000, 10000],
		]);
		expect(plan!.removedIds).toHaveLength(2);
	});

	it("cuts the middle out of a single clip", () => {
		const plan = planRangeRemoval({
			clipRegions: [{ id: "a", startMs: 0, endMs: 10000, speed: 1 }],
			startMs: 2000,
			endMs: 5000,
			createId: createIdFactory(),
		});
		const packed = packClipSequence(plan!.after);
		expect(
			packed.map((clip) => [clip.startMs, clip.endMs, getClipSourceStartMs(clip)]),
		).toEqual([
			[0, 2000, 0],
			[2000, 7000, 5000],
		]);
	});

	it("follows the source correctly through a sped-up clip", () => {
		const plan = planRangeRemoval({
			clipRegions: [{ id: "a", startMs: 0, endMs: 5000, speed: 2 }],
			startMs: 1000,
			endMs: 2000,
			createId: createIdFactory(),
		});
		const packed = packClipSequence(plan!.after);
		expect(packed.map((clip) => getClipSourceStartMs(clip))).toEqual([0, 4000]);
		expect(packed[1].endMs - packed[1].startMs).toBe(3000);
	});

	it("refuses to delete the whole edit or nothing", () => {
		const createId = createIdFactory();
		expect(
			planRangeRemoval({ clipRegions: twoClips, startMs: 0, endMs: 10000, createId }),
		).toBeNull();
		expect(
			planRangeRemoval({ clipRegions: twoClips, startMs: 3000, endMs: 3000, createId }),
		).toBeNull();
	});
});

describe("planTrimToPlayhead", () => {
	it("removes the head or tail of the clip under the playhead", () => {
		const head = planTrimToPlayhead({
			clipRegions: twoClips,
			playheadMs: 7000,
			side: "head",
			createId: createIdFactory(),
		});
		expect(
			packClipSequence(head!.after).map((clip) => [
				clip.startMs,
				clip.endMs,
				getClipSourceStartMs(clip),
			]),
		).toEqual([
			[0, 4000, 0],
			[4000, 7000, 7000],
		]);

		const tail = planTrimToPlayhead({
			clipRegions: twoClips,
			playheadMs: 1000,
			side: "tail",
			createId: createIdFactory(),
		});
		expect(packClipSequence(tail!.after).map((clip) => [clip.startMs, clip.endMs])).toEqual([
			[0, 1000],
			[1000, 7000],
		]);
	});

	it("does nothing on a cut", () => {
		expect(
			planTrimToPlayhead({
				clipRegions: twoClips,
				playheadMs: 4000,
				side: "head",
				createId: createIdFactory(),
			}),
		).toBeNull();
	});
});

describe("edit points", () => {
	it("lists cuts and steps between them", () => {
		expect(getEditPoints(twoClips)).toEqual([0, 4000, 10000]);
		expect(findAdjacentEditPoint(twoClips, 4000, 1)).toBe(10000);
		expect(findAdjacentEditPoint(twoClips, 4000, -1)).toBe(0);
		expect(findAdjacentEditPoint(twoClips, 5000, -1)).toBe(4000);
		expect(findAdjacentEditPoint(twoClips, 10000, 1)).toBeNull();
	});
});
