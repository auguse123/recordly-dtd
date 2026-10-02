import { describe, expect, it } from "vitest";
import {
	applyColorMatrixToPixels,
	COLOR_GRADE_PRESETS,
	DEFAULT_COLOR_GRADE,
	findColorGradePreset,
	getColorGradeMatrix,
	isNeutralColorGrade,
	normalizeColorGrade,
} from "./colorGrade";

const apply = (matrix: number[], [r, g, b]: [number, number, number]) =>
	[0, 1, 2].map(
		(row) =>
			matrix[row * 5] * r +
			matrix[row * 5 + 1] * g +
			matrix[row * 5 + 2] * b +
			matrix[row * 5 + 3] +
			matrix[row * 5 + 4],
	);

describe("normalizeColorGrade", () => {
	it("clamps sliders and falls back to neutral", () => {
		expect(normalizeColorGrade({ brightness: 250, contrast: "x", temperature: -12.4 })).toEqual(
			{
				brightness: 100,
				contrast: 0,
				saturation: 0,
				temperature: -12,
				includeCamera: true,
			},
		);
		expect(normalizeColorGrade(undefined)).toEqual(DEFAULT_COLOR_GRADE);
	});
});

describe("getColorGradeMatrix", () => {
	it("leaves the picture untouched when neutral", () => {
		expect(isNeutralColorGrade(DEFAULT_COLOR_GRADE)).toBe(true);
		expect(apply(getColorGradeMatrix(DEFAULT_COLOR_GRADE), [0.2, 0.5, 0.8])).toEqual([
			0.2, 0.5, 0.8,
		]);
	});

	it("brightens, adds contrast around mid-grey and warms", () => {
		const brighter = apply(
			getColorGradeMatrix({ ...DEFAULT_COLOR_GRADE, brightness: 50 }),
			[0.5, 0.5, 0.5],
		);
		expect(brighter[0]).toBeCloseTo(0.6);

		const contrast = getColorGradeMatrix({ ...DEFAULT_COLOR_GRADE, contrast: 100 });
		expect(apply(contrast, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5);
		expect(apply(contrast, [0.75, 0.75, 0.75])[0]).toBeCloseTo(1);

		const [r, , b] = apply(
			getColorGradeMatrix({ ...DEFAULT_COLOR_GRADE, temperature: 50 }),
			[0.5, 0.5, 0.5],
		);
		expect(r).toBeGreaterThan(0.5);
		expect(b).toBeLessThan(0.5);
	});

	it("turns the picture grey at -100 saturation", () => {
		const [r, g, b] = apply(
			getColorGradeMatrix({ ...DEFAULT_COLOR_GRADE, saturation: -100 }),
			[1, 0, 0],
		);
		expect(r).toBeCloseTo(g);
		expect(g).toBeCloseTo(b);
	});
});

describe("applyColorMatrixToPixels", () => {
	it("grades RGB and keeps alpha", () => {
		const pixels = new Uint8ClampedArray([255, 0, 0, 128]);
		applyColorMatrixToPixels(
			pixels,
			getColorGradeMatrix({ ...DEFAULT_COLOR_GRADE, saturation: -100 }),
		);
		expect(pixels[0]).toBe(pixels[1]);
		expect(pixels[1]).toBe(pixels[2]);
		expect(pixels[3]).toBe(128);
	});
});

describe("presets", () => {
	it("recognises a preset from its values", () => {
		const warm = COLOR_GRADE_PRESETS.find((preset) => preset.id === "warm");
		expect(warm).toBeDefined();
		expect(findColorGradePreset({ ...DEFAULT_COLOR_GRADE, ...warm?.values })).toBe("warm");
		expect(findColorGradePreset({ ...DEFAULT_COLOR_GRADE, brightness: 3 })).toBeNull();
	});
});
