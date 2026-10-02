import { Sprite, Texture } from "pixi.js";
import type { ResolvedClipTransition, TransitionFrameState } from "../clipTransitions";

/** How long before a crossfade seam the outgoing frame keeps being copied. */
const CAPTURE_WINDOW_MS = 400;

/**
 * Holds the last frame of a clip so a crossfade can dissolve it over the next
 * one. Playback and export decode one source at a time, so the outgoing clip's
 * frames are gone once the seam is crossed; a frozen copy stands in for them.
 * Shared by the preview and the exporter so both draw the same transition.
 */
export class TransitionFreezeFrame {
	readonly sprite = new Sprite(Texture.EMPTY);
	private canvas: HTMLCanvasElement | null = null;
	private capturedSeamMs: number | null = null;

	constructor() {
		this.sprite.visible = false;
	}

	/** The crossfade seam a frame shown at `timeMs` should be kept for, if any. */
	static findCaptureSeam(
		transitions: readonly ResolvedClipTransition[],
		timeMs: number,
	): number | null {
		for (const transition of transitions) {
			if (
				transition.type === "crossfade" &&
				timeMs < transition.seamMs &&
				timeMs >= transition.seamMs - CAPTURE_WINDOW_MS
			) {
				return transition.seamMs;
			}
		}
		return null;
	}

	/** The crossfade seam a source jump at `timeMs` (just past a cut) belongs to. */
	static findCutSeam(
		transitions: readonly ResolvedClipTransition[],
		timeMs: number,
	): number | null {
		for (const transition of transitions) {
			if (
				transition.type === "crossfade" &&
				Math.abs(timeMs - transition.seamMs) <= CAPTURE_WINDOW_MS
			) {
				return transition.seamMs;
			}
		}
		return null;
	}

	capture(source: CanvasImageSource, width: number, height: number, seamMs: number): void {
		const w = Math.round(width);
		const h = Math.round(height);
		if (!(w > 0 && h > 0)) return;
		let canvas = this.canvas;
		if (!canvas || canvas.width !== w || canvas.height !== h) {
			canvas = document.createElement("canvas");
			canvas.width = w;
			canvas.height = h;
			const previous = this.sprite.texture;
			this.sprite.texture = Texture.from(canvas);
			if (previous !== Texture.EMPTY) previous.destroy(true);
			this.canvas = canvas;
		}
		const context = canvas.getContext("2d");
		if (!context) return;
		try {
			context.drawImage(source, 0, 0, w, h);
		} catch {
			// A source without a decoded frame yet: keep the previous capture.
			return;
		}
		this.sprite.texture.source.update();
		this.capturedSeamMs = seamMs;
	}

	/** Show the frozen frame over `target` while the crossfade from its seam runs. */
	apply(state: TransitionFrameState, target: Sprite | null): void {
		const crossfade = state.crossfade;
		const show = Boolean(target && crossfade && this.capturedSeamMs === crossfade.seamMs);
		this.sprite.visible = show;
		if (!show || !target || !crossfade) return;
		this.sprite.alpha = crossfade.opacity;
		this.sprite.position.copyFrom(target.position);
		this.sprite.width = target.width;
		this.sprite.height = target.height;
	}

	hide(): void {
		this.sprite.visible = false;
	}

	destroy(): void {
		// The sprite may already be gone when the Pixi stage was torn down first;
		// a destroyed sprite reports a null texture.
		const texture = this.sprite.destroyed ? null : this.sprite.texture;
		this.sprite.destroy();
		if (texture && texture !== Texture.EMPTY && !texture.destroyed) texture.destroy(true);
		this.canvas = null;
	}
}
