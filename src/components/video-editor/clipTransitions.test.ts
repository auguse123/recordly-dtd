import { describe, expect, it } from "vitest";
import {
	getGainAt,
	getTransitionFrameState,
	getTransitionGainEnvelope,
	normalizeClipTransition,
	resolveClipTransitions,
} from "./clipTransitions";
import type { ClipRegion } from "./types";

const clips = (first: ClipRegion["transitionOut"], second?: ClipRegion["transitionOut"]) =>
	[
		{ id: "a", startMs: 0, endMs: 4000, speed: 1, transitionOut: first },
		{ id: "b", startMs: 4000, endMs: 10000, speed: 1, transitionOut: second },
	] satisfies ClipRegion[];

describe("normalizeClipTransition", () => {
	it("keeps known types and clamps the duration", () => {
		expect(normalizeClipTransition({ type: "dip", durationMs: 50 })).toEqual({
			type: "dip",
			durationMs: 100,
		});
		expect(normalizeClipTransition({ type: "crossfade" })).toEqual({
			type: "crossfade",
			durationMs: 500,
		});
		expect(normalizeClipTransition({ type: "wipe", durationMs: 500 })).toBeUndefined();
		expect(normalizeClipTransition(null)).toBeUndefined();
	});
});

describe("transition frames", () => {
	it("dips to black across the seam", () => {
		const transitions = resolveClipTransitions(clips({ type: "dip", durationMs: 1000 }));
		expect(getTransitionFrameState(transitions, 3000).blackAlpha).toBe(0);
		expect(getTransitionFrameState(transitions, 3750).blackAlpha).toBeCloseTo(0.5);
		expect(getTransitionFrameState(transitions, 4000).blackAlpha).toBe(1);
		expect(getTransitionFrameState(transitions, 4250).blackAlpha).toBeCloseTo(0.5);
		expect(getTransitionFrameState(transitions, 4500).blackAlpha).toBe(0);
	});

	it("dissolves the outgoing clip's last frame over the next clip", () => {
		const transitions = resolveClipTransitions(clips({ type: "crossfade", durationMs: 1000 }));
		expect(getTransitionFrameState(transitions, 3900).crossfade).toBeNull();
		const state = getTransitionFrameState(transitions, 4250);
		expect(state.crossfade?.opacity).toBeCloseTo(0.75);
		expect(state.crossfade?.from.id).toBe("a");
		expect(state.blackAlpha).toBe(0);
		expect(getTransitionFrameState(transitions, 5000).crossfade).toBeNull();
	});

	it("fades the last clip out to black", () => {
		const transitions = resolveClipTransitions(
			clips(undefined, { type: "crossfade", durationMs: 2000 }),
		);
		expect(transitions[0]).toMatchObject({ type: "dip", to: null, seamMs: 10000 });
		expect(getTransitionFrameState(transitions, 8000).blackAlpha).toBe(0);
		expect(getTransitionFrameState(transitions, 9000).blackAlpha).toBeCloseTo(0.5);
		expect(getTransitionFrameState(transitions, 10000).blackAlpha).toBe(1);
	});

	it("never outlasts a short clip", () => {
		const [transition] = resolveClipTransitions([
			{
				id: "a",
				startMs: 0,
				endMs: 300,
				speed: 1,
				transitionOut: { type: "dip", durationMs: 2000 },
			},
			{ id: "b", startMs: 300, endMs: 5000, speed: 1 },
		]);
		expect(transition.durationMs).toBe(300);
	});
});

describe("transition gain envelope", () => {
	it("ducks the sound to silence at a dip and back", () => {
		const envelope = getTransitionGainEnvelope(
			resolveClipTransitions(clips({ type: "dip", durationMs: 1000 })),
		);
		expect(getGainAt(envelope, 0)).toBe(1);
		expect(getGainAt(envelope, 3750)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 4000)).toBe(0);
		expect(getGainAt(envelope, 4250)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 6000)).toBe(1);
	});

	it("only dips briefly for a crossfade and stays silent after the final fade", () => {
		const envelope = getTransitionGainEnvelope(
			resolveClipTransitions(
				clips({ type: "crossfade", durationMs: 1000 }, { type: "dip", durationMs: 1000 }),
			),
		);
		expect(getGainAt(envelope, 3800)).toBe(1);
		expect(getGainAt(envelope, 4000)).toBe(0);
		expect(getGainAt(envelope, 4200)).toBe(1);
		expect(getGainAt(envelope, 9500)).toBeCloseTo(0.5);
		expect(getGainAt(envelope, 10000)).toBe(0);
	});
});
