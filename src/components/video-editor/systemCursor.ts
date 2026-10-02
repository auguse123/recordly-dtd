import type { CursorClickEffectStyle, CursorStyle } from "./types";

export interface SystemCursorSettings {
	cursorStyle: CursorStyle;
	cursorSize: number;
	cursorSmoothing: number;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorSway: number;
	cursorClickEffect: CursorClickEffectStyle;
}

/**
 * The cursor as it looked on screen: the stock macOS pointers (arrow, hand,
 * I-beam…) following the raw mouse path, at roughly their on-screen size, with
 * no smoothing, blur, bounce, sway or click effect.
 */
export const SYSTEM_CURSOR_SETTINGS: SystemCursorSettings = {
	cursorStyle: "macos",
	cursorSize: 1,
	cursorSmoothing: 0,
	cursorMotionBlur: 0,
	cursorClickBounce: 0,
	cursorSway: 0,
	cursorClickEffect: "none",
};

/** Size stays free: only the "no effects" part decides whether the system cursor is on. */
export function isSystemCursorActive(settings: SystemCursorSettings): boolean {
	return (
		settings.cursorStyle === SYSTEM_CURSOR_SETTINGS.cursorStyle &&
		settings.cursorSmoothing <= 0 &&
		settings.cursorMotionBlur <= 0 &&
		settings.cursorClickBounce <= 0 &&
		settings.cursorSway <= 0 &&
		settings.cursorClickEffect === "none"
	);
}
