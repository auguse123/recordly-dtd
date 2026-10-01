import { describe, expect, it } from "vitest";
import {
	computeCaptureFrame,
	normalizeSessionCaptureFrame,
	parseCaptureFrameAspect,
} from "./captureFrameGeometry";

const display = { x: 0, y: 0, width: 1440, height: 900 };
const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe("computeCaptureFrame", () => {
	it("fits a portrait frame to the work area height and centers it", () => {
		const result = computeCaptureFrame("9:16", workArea, display)!;
		expect(result.frame.height).toBe(875);
		expect(result.frame.width).toBe(492);
		expect(result.frame.y).toBe(25);
		expect(result.frame.x).toBe(Math.round((1440 - 492) / 2));
		expect(result.cropRegion.y).toBeCloseTo(25 / 900);
		expect(result.cropRegion.height).toBeCloseTo(875 / 900);
		expect(result.cropRegion.width).toBeCloseTo(492 / 1440);
	});

	it("fits a landscape frame to the work area width", () => {
		const result = computeCaptureFrame("16:9", workArea, display)!;
		expect(result.frame.width).toBe(1440);
		expect(result.frame.height).toBe(810);
		expect(result.cropRegion.x).toBe(0);
		expect(result.cropRegion.width).toBe(1);
	});

	it("uses coordinates relative to secondary displays", () => {
		const secondary = { x: 1440, y: -200, width: 1920, height: 1080 };
		const result = computeCaptureFrame("1:1", secondary, secondary)!;
		expect(result.frame).toEqual({ x: 1440 + 420, y: -200, width: 1080, height: 1080 });
		expect(result.cropRegion.x).toBeCloseTo(420 / 1920);
		expect(result.cropRegion.y).toBe(0);
	});

	it("rejects empty areas and unknown aspects", () => {
		expect(
			computeCaptureFrame("1:1", { x: 0, y: 0, width: 0, height: 10 }, display),
		).toBeNull();
		expect(parseCaptureFrameAspect("4:5")).toBe("4:5");
		expect(parseCaptureFrameAspect("native")).toBeNull();
		expect(parseCaptureFrameAspect(null)).toBeNull();
	});
});

describe("normalizeSessionCaptureFrame", () => {
	it("keeps valid frames and drops malformed ones", () => {
		const cropRegion = { x: 0.3, y: 0.02, width: 0.34, height: 0.97 };
		expect(normalizeSessionCaptureFrame({ aspectRatio: "9:16", cropRegion })).toEqual({
			aspectRatio: "9:16",
			cropRegion,
		});
		expect(normalizeSessionCaptureFrame({ aspectRatio: "native", cropRegion })).toBeUndefined();
		expect(
			normalizeSessionCaptureFrame({
				aspectRatio: "1:1",
				cropRegion: { ...cropRegion, x: 0.9 },
			}),
		).toBeUndefined();
		expect(normalizeSessionCaptureFrame(null)).toBeUndefined();
	});
});
