export const CAPTURE_FRAME_ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type CaptureFrameAspect = (typeof CAPTURE_FRAME_ASPECTS)[number];

export type Rect = { x: number; y: number; width: number; height: number };

export type CaptureFrame = {
	aspectRatio: CaptureFrameAspect;
	/** Frame position in screen coordinates. */
	frame: Rect;
	/** Frame position normalized (0-1) against the full captured display. */
	cropRegion: Rect;
};

export function parseCaptureFrameAspect(value: unknown): CaptureFrameAspect | null {
	return CAPTURE_FRAME_ASPECTS.includes(value as CaptureFrameAspect)
		? (value as CaptureFrameAspect)
		: null;
}

function aspectValue(aspect: CaptureFrameAspect) {
	const [w, h] = aspect.split(":").map(Number);
	return w / h;
}

/**
 * Largest rect of the target aspect centered inside `area` (the visible part of
 * the screen), with its crop normalized against `displayBounds` (the full
 * captured frame, which on macOS includes the menu bar).
 */
export function computeCaptureFrame(
	aspect: CaptureFrameAspect,
	area: Rect,
	displayBounds: Rect,
): CaptureFrame | null {
	if (
		area.width <= 0 ||
		area.height <= 0 ||
		displayBounds.width <= 0 ||
		displayBounds.height <= 0
	) {
		return null;
	}
	const ratio = aspectValue(aspect);
	let width = area.width;
	let height = width / ratio;
	if (height > area.height) {
		height = area.height;
		width = height * ratio;
	}
	width = Math.round(width);
	height = Math.round(height);
	const frame = {
		x: Math.round(area.x + (area.width - width) / 2),
		y: Math.round(area.y + (area.height - height) / 2),
		width,
		height,
	};
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	const cropX = clamp((frame.x - displayBounds.x) / displayBounds.width);
	const cropY = clamp((frame.y - displayBounds.y) / displayBounds.height);
	return {
		aspectRatio: aspect,
		frame,
		cropRegion: {
			x: cropX,
			y: cropY,
			width: Math.min(1 - cropX, frame.width / displayBounds.width),
			height: Math.min(1 - cropY, frame.height / displayBounds.height),
		},
	};
}

export type SessionCaptureFrame = { aspectRatio: CaptureFrameAspect; cropRegion: Rect };

/** Validates a capture frame coming from the renderer before it enters the session. */
export function normalizeSessionCaptureFrame(value: unknown): SessionCaptureFrame | undefined {
	if (!value || typeof value !== "object") return undefined;
	const { aspectRatio, cropRegion } = value as Record<string, unknown>;
	const aspect = parseCaptureFrameAspect(aspectRatio);
	if (!aspect || !cropRegion || typeof cropRegion !== "object") return undefined;
	const crop = cropRegion as Record<string, unknown>;
	const keys = ["x", "y", "width", "height"] as const;
	if (!keys.every((key) => typeof crop[key] === "number" && Number.isFinite(crop[key]))) {
		return undefined;
	}
	const [x, y, width, height] = keys.map((key) => crop[key] as number);
	if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) {
		return undefined;
	}
	return { aspectRatio: aspect, cropRegion: { x, y, width, height } };
}
