import { ColorMatrixFilter, type Container, type ColorMatrix as PixiColorMatrix } from "pixi.js";
import { type ColorGrade, getColorGradeMatrix, isNeutralColorGrade } from "../colorGrade";

/**
 * One color matrix shared by every sprite that shows the recording (and the
 * camera when the grade includes it). Used by the preview and the exporter so
 * both grade the picture identically.
 */
export class ColorGradeFilter {
	/**
	 * Pixi renders filters at resolution 1 without antialiasing by default,
	 * which halves the picture on Retina screens. Follow the render target so
	 * the grade only changes colors, never sharpness.
	 */
	readonly filter = new ColorMatrixFilter({ resolution: "inherit", antialias: "inherit" });
	private neutral = true;

	update(grade: ColorGrade | null | undefined): void {
		this.neutral = !grade || isNeutralColorGrade(grade);
		if (grade && !this.neutral) {
			this.filter.matrix = getColorGradeMatrix(grade) as PixiColorMatrix;
		}
	}

	/** Attach the grade to `targets`, or clear it when the grade is neutral or `enabled` is false. */
	applyTo(targets: ReadonlyArray<Container | null | undefined>, enabled = true): void {
		const filters = enabled && !this.neutral ? [this.filter] : null;
		for (const target of targets) {
			if (target && !target.destroyed) target.filters = filters;
		}
	}

	destroy(): void {
		this.filter.destroy();
	}
}
