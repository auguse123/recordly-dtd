/**
 * Simple grade applied to the recording (and optionally the camera). Each
 * slider runs from -100 to 100; 0 leaves the picture untouched.
 */
export interface ColorGrade {
	brightness: number;
	contrast: number;
	saturation: number;
	/** Negative is cooler (blue), positive warmer (orange). */
	temperature: number;
	/** Grade the camera bubble too, so faces match the screen. */
	includeCamera: boolean;
}

export const COLOR_GRADE_SLIDERS = ["brightness", "contrast", "saturation", "temperature"] as const;
export type ColorGradeSlider = (typeof COLOR_GRADE_SLIDERS)[number];

export const DEFAULT_COLOR_GRADE: ColorGrade = {
	brightness: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	includeCamera: true,
};

export type ColorGradePresetId =
	| "neutral"
	| "bright"
	| "warm"
	| "cool"
	| "punchy"
	| "soft"
	| "mono";

export const COLOR_GRADE_PRESETS: ReadonlyArray<{
	id: ColorGradePresetId;
	values: Record<ColorGradeSlider, number>;
}> = [
	{ id: "neutral", values: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } },
	{ id: "bright", values: { brightness: 15, contrast: 10, saturation: 10, temperature: 5 } },
	{ id: "warm", values: { brightness: 5, contrast: 5, saturation: 10, temperature: 35 } },
	{ id: "cool", values: { brightness: 0, contrast: 5, saturation: 0, temperature: -30 } },
	{ id: "punchy", values: { brightness: 0, contrast: 30, saturation: 25, temperature: 0 } },
	{ id: "soft", values: { brightness: 8, contrast: -20, saturation: -10, temperature: 10 } },
	{ id: "mono", values: { brightness: 0, contrast: 20, saturation: -100, temperature: 0 } },
];

const clampSlider = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.round(Math.min(100, Math.max(-100, value)))
		: 0;

export function normalizeColorGrade(value: unknown): ColorGrade {
	if (!value || typeof value !== "object") return { ...DEFAULT_COLOR_GRADE };
	const raw = value as Partial<ColorGrade>;
	return {
		brightness: clampSlider(raw.brightness),
		contrast: clampSlider(raw.contrast),
		saturation: clampSlider(raw.saturation),
		temperature: clampSlider(raw.temperature),
		includeCamera: typeof raw.includeCamera === "boolean" ? raw.includeCamera : true,
	};
}

export function isNeutralColorGrade(grade: ColorGrade | null | undefined): boolean {
	return !grade || COLOR_GRADE_SLIDERS.every((key) => !grade[key]);
}

export function findColorGradePreset(grade: ColorGrade): ColorGradePresetId | null {
	return (
		COLOR_GRADE_PRESETS.find((preset) =>
			COLOR_GRADE_SLIDERS.every((key) => preset.values[key] === grade[key]),
		)?.id ?? null
	);
}

/** Row-major 4×5 color matrix, offsets in 0–1 (Pixi ColorMatrixFilter / SVG feColorMatrix). */
export type ColorMatrix = number[];

const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** `outer ∘ inner`: apply `inner` first, then `outer`. */
function compose(outer: ColorMatrix, inner: ColorMatrix): ColorMatrix {
	const result = new Array<number>(20).fill(0);
	for (let row = 0; row < 4; row += 1) {
		for (let col = 0; col < 5; col += 1) {
			let sum = col === 4 ? outer[row * 5 + 4] : 0;
			for (let k = 0; k < 4; k += 1) {
				sum += outer[row * 5 + k] * inner[k * 5 + col];
			}
			result[row * 5 + col] = sum;
		}
	}
	return result;
}

function scaleOffset(scale: number, offset: number): ColorMatrix {
	return [scale, 0, 0, 0, offset, 0, scale, 0, 0, offset, 0, 0, scale, 0, offset, 0, 0, 0, 1, 0];
}

/** Rec. 709 luma weights. */
const LUMA = [0.2126, 0.7152, 0.0722];

function saturationMatrix(amount: number): ColorMatrix {
	const rows: number[] = [];
	for (let row = 0; row < 3; row += 1) {
		for (let col = 0; col < 3; col += 1) {
			rows.push((1 - amount) * LUMA[col] + (row === col ? amount : 0));
		}
		rows.push(0, 0);
	}
	return [...rows, 0, 0, 0, 1, 0];
}

export function getColorGradeMatrix(grade: ColorGrade): ColorMatrix {
	if (isNeutralColorGrade(grade)) return [...IDENTITY];
	const brightness = grade.brightness / 100;
	const contrast = grade.contrast / 100;
	const saturation = grade.saturation / 100;
	const temperature = grade.temperature / 100;

	const brightnessMatrix = scaleOffset(1 + brightness * 0.4, 0);
	const contrastScale = contrast >= 0 ? 1 + contrast : 1 + contrast * 0.75;
	const contrastMatrix = scaleOffset(contrastScale, 0.5 * (1 - contrastScale));
	const saturationMatrixValue = saturationMatrix(1 + saturation);
	const temperatureMatrix: ColorMatrix = [
		1 + temperature * 0.15,
		0,
		0,
		0,
		0,
		0,
		1 + temperature * 0.02,
		0,
		0,
		0,
		0,
		0,
		1 - temperature * 0.15,
		0,
		0,
		0,
		0,
		0,
		1,
		0,
	];

	return compose(
		temperatureMatrix,
		compose(saturationMatrixValue, compose(contrastMatrix, brightnessMatrix)),
	);
}

/** Space-separated values for an SVG `<feColorMatrix type="matrix">`. */
export function toSvgColorMatrixValues(matrix: ColorMatrix): string {
	return matrix.map((value) => Number(value.toFixed(5))).join(" ");
}

/** Grade RGBA pixels in place (unpremultiplied, as `getImageData` returns them). */
export function applyColorMatrixToPixels(pixels: Uint8ClampedArray, matrix: ColorMatrix): void {
	const [r0, r1, r2, , r4, g0, g1, g2, , g4, b0, b1, b2, , b4] = matrix;
	for (let index = 0; index < pixels.length; index += 4) {
		const r = pixels[index] / 255;
		const g = pixels[index + 1] / 255;
		const b = pixels[index + 2] / 255;
		pixels[index] = (r0 * r + r1 * g + r2 * b + r4) * 255;
		pixels[index + 1] = (g0 * r + g1 * g + g2 * b + g4) * 255;
		pixels[index + 2] = (b0 * r + b1 * g + b2 * b + b4) * 255;
	}
}
