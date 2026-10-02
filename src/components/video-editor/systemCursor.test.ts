import { describe, expect, it } from "vitest";
import { isSystemCursorActive, SYSTEM_CURSOR_SETTINGS } from "./systemCursor";

describe("isSystemCursorActive", () => {
	it("recognises the preset", () => {
		expect(isSystemCursorActive(SYSTEM_CURSOR_SETTINGS)).toBe(true);
	});

	it("ignores the size so it can be adjusted", () => {
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorSize: 1.6 })).toBe(true);
	});

	it("is off as soon as an effect comes back", () => {
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorStyle: "tahoe" })).toBe(
			false,
		);
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorSmoothing: 0.5 })).toBe(
			false,
		);
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorMotionBlur: 0.2 })).toBe(
			false,
		);
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorClickBounce: 1 })).toBe(
			false,
		);
		expect(isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorSway: 0.4 })).toBe(false);
		expect(
			isSystemCursorActive({ ...SYSTEM_CURSOR_SETTINGS, cursorClickEffect: "ripple" }),
		).toBe(false);
	});
});
