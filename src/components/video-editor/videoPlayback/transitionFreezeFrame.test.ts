import { describe, expect, it } from "vitest";
import { resolveClipTransitions } from "../clipTransitions";
import { TransitionFreezeFrame } from "./transitionFreezeFrame";

const transitions = resolveClipTransitions([
	{
		id: "a",
		startMs: 0,
		endMs: 4000,
		speed: 1,
		transitionOut: { type: "crossfade", durationMs: 800 },
	},
	{
		id: "b",
		startMs: 4000,
		endMs: 8000,
		speed: 1,
		transitionOut: { type: "dip", durationMs: 500 },
	},
	{ id: "c", startMs: 8000, endMs: 12000, speed: 1 },
]);

describe("TransitionFreezeFrame seams", () => {
	it("keeps copying frames just before a crossfade seam only", () => {
		expect(TransitionFreezeFrame.findCaptureSeam(transitions, 3500)).toBeNull();
		expect(TransitionFreezeFrame.findCaptureSeam(transitions, 3700)).toBe(4000);
		expect(TransitionFreezeFrame.findCaptureSeam(transitions, 4000)).toBeNull();
		// Dips need no frozen frame.
		expect(TransitionFreezeFrame.findCaptureSeam(transitions, 7900)).toBeNull();
	});

	it("ties a source jump near a crossfade seam to that seam", () => {
		expect(TransitionFreezeFrame.findCutSeam(transitions, 4010)).toBe(4000);
		expect(TransitionFreezeFrame.findCutSeam(transitions, 3990)).toBe(4000);
		expect(TransitionFreezeFrame.findCutSeam(transitions, 8000)).toBeNull();
	});
});
