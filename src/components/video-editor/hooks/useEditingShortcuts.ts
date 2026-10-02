import { useCallback, useEffect, useRef, useState } from "react";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	EMPTY_TIMELINE_MARKS,
	FRAME_STEP_MS,
	findAdjacentEditPoint,
	getMarkedRange,
	setTimelineMark,
	type TimelineMarks,
} from "../editTools";
import type { ClipRegion } from "../types";
import type { PlayheadClock } from "../videoPlayback/playheadClock";

/** How often the J shuttle steps the playhead back. */
const SHUTTLE_TICK_MS = 100;
const MAX_SHUTTLE_SPEED = 8;

/** Focus targets that own their keys (sliders, tabs, menus…). */
const KEY_OWNER_SELECTOR = [
	"[data-recording-library]",
	'[role="slider"]',
	'[role="radiogroup"]',
	'[role="radio"]',
	'[role="tablist"]',
	'[role="tab"]',
	'[role="spinbutton"]',
	'[role="combobox"]',
	'[role="option"]',
	'[role="listbox"]',
	'[role="menu"]',
	'[role="dialog"]',
	'[role="alertdialog"]',
].join(", ");

function isKeyOwnedByTarget(target: EventTarget | null): boolean {
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	) {
		return true;
	}
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || Boolean(target.closest(KEY_OWNER_SELECTOR)))
	);
}

type Input = {
	shortcuts: ReturnType<typeof useShortcuts>["shortcuts"];
	isMac: boolean;
	videoPath: string | null;
	clipRegions: ClipRegion[];
	/** Edited timeline, seconds. */
	playheadSec: number;
	/** Frame-accurate playhead; `playheadSec` may lag behind it while playing. */
	playheadClock?: PlayheadClock;
	durationSec: number;
	isPreviewPlaying: boolean;
	startPlayback: () => void;
	togglePlayPause: () => void;
	handleSeek: (timeSec: number, options?: { pause?: boolean }) => void;
	handleClipSplit: (splitMs: number) => void;
	handleRemoveRange: (startMs: number, endMs: number) => boolean;
	handleTrimToPlayhead: (playheadMs: number, side: "head" | "tail") => boolean;
};

/**
 * DaVinci-style editing keys: J/K/L shuttle, I/O marks (Delete removes the
 * marked range and closes the gap), Q/W ripple trims to the playhead, ↑/↓ jump
 * between cuts, ←/→ step frames (⇧ for seconds) and ⌘B splits at the playhead.
 */
export function useEditingShortcuts(input: Input) {
	const [marks, setMarks] = useState<TimelineMarks>(EMPTY_TIMELINE_MARKS);
	const latest = useRef(input);
	latest.current = input;

	const shuttleRef = useRef<{ timer: number; speed: number; positionSec: number } | null>(null);
	const stopShuttle = useCallback(() => {
		const shuttle = shuttleRef.current;
		if (!shuttle) return;
		window.clearInterval(shuttle.timer);
		shuttleRef.current = null;
	}, []);

	useEffect(() => {
		void input.videoPath;
		setMarks(EMPTY_TIMELINE_MARKS);
		stopShuttle();
	}, [input.videoPath, stopShuttle]);

	useEffect(() => stopShuttle, [stopShuttle]);

	// Forward playback (Space, L, the play button) always wins over the shuttle.
	useEffect(() => {
		if (input.isPreviewPlaying) stopShuttle();
	}, [input.isPreviewPlaying, stopShuttle]);

	const startReverseShuttle = useCallback(() => {
		const current = shuttleRef.current;
		if (current) {
			current.speed = Math.min(MAX_SHUTTLE_SPEED, current.speed * 2);
			return;
		}
		const { playheadSec, playheadClock, isPreviewPlaying, togglePlayPause } = latest.current;
		if (isPreviewPlaying) togglePlayPause();
		const shuttle = {
			speed: 1,
			positionSec: playheadClock ? playheadClock.getTime() : playheadSec,
			timer: window.setInterval(() => {
				const active = shuttleRef.current;
				if (!active) return;
				active.positionSec = Math.max(
					0,
					active.positionSec - (SHUTTLE_TICK_MS / 1000) * active.speed,
				);
				latest.current.handleSeek(active.positionSec, { pause: true });
				if (active.positionSec <= 0) stopShuttle();
			}, SHUTTLE_TICK_MS),
		};
		shuttleRef.current = shuttle;
	}, [stopShuttle]);

	const deleteMarkedRange = useCallback(() => {
		const range = getMarkedRange(marks, latest.current.durationSec * 1000);
		if (!range) return false;
		if (!latest.current.handleRemoveRange(range.startMs, range.endMs)) return false;
		setMarks(EMPTY_TIMELINE_MARKS);
		latest.current.handleSeek(range.startMs / 1000, { pause: true });
		return true;
	}, [marks]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			if (isKeyOwnedByTarget(event.target)) return;
			const now = latest.current;
			const { shortcuts, isMac } = now;
			const playheadMs =
				(now.playheadClock ? now.playheadClock.getTime() : now.playheadSec) * 1000;
			const durationMs = now.durationSec * 1000;
			const seekTo = (ms: number) => {
				stopShuttle();
				now.handleSeek(Math.min(durationMs, Math.max(0, ms)) / 1000, { pause: true });
			};
			const handled = () => event.preventDefault();

			if (matchesShortcut(event, shortcuts.playReverse, isMac)) {
				handled();
				if (!event.repeat) startReverseShuttle();
				return;
			}
			if (matchesShortcut(event, shortcuts.stopPlayback, isMac)) {
				handled();
				stopShuttle();
				if (now.isPreviewPlaying) now.togglePlayPause();
				return;
			}
			if (matchesShortcut(event, shortcuts.playForward, isMac)) {
				handled();
				if (event.repeat) return;
				stopShuttle();
				if (!now.isPreviewPlaying) now.startPlayback();
				return;
			}
			if (matchesShortcut(event, shortcuts.markIn, isMac)) {
				handled();
				setMarks((current) => setTimelineMark(current, "in", playheadMs));
				return;
			}
			if (matchesShortcut(event, shortcuts.markOut, isMac)) {
				handled();
				setMarks((current) => setTimelineMark(current, "out", playheadMs));
				return;
			}
			if (matchesShortcut(event, shortcuts.trimHeadToPlayhead, isMac)) {
				handled();
				stopShuttle();
				const clip = now.clipRegions.find(
					(candidate) => playheadMs > candidate.startMs && playheadMs < candidate.endMs,
				);
				// The head cut slides everything after it left: land on the cut.
				if (clip && now.handleTrimToPlayhead(playheadMs, "head")) seekTo(clip.startMs);
				return;
			}
			if (matchesShortcut(event, shortcuts.trimTailToPlayhead, isMac)) {
				handled();
				stopShuttle();
				now.handleTrimToPlayhead(playheadMs, "tail");
				return;
			}
			// ⌥X: clear both marks (event.code: ⌥ changes event.key on macOS).
			if (event.code === "KeyX" && event.altKey && !event.metaKey && !event.ctrlKey) {
				handled();
				setMarks(EMPTY_TIMELINE_MARKS);
				return;
			}
			if (event.code === "KeyB" && (isMac ? event.metaKey : event.ctrlKey) && !event.altKey) {
				handled();
				if (!event.shiftKey) now.handleClipSplit(playheadMs);
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			switch (event.key) {
				case "ArrowLeft":
				case "ArrowRight": {
					handled();
					const direction = event.key === "ArrowRight" ? 1 : -1;
					const step = event.shiftKey ? 1000 : FRAME_STEP_MS;
					seekTo(playheadMs + direction * step);
					return;
				}
				case "ArrowUp":
				case "ArrowDown": {
					if (event.shiftKey) return;
					handled();
					const point = findAdjacentEditPoint(
						now.clipRegions,
						playheadMs,
						event.key === "ArrowDown" ? 1 : -1,
					);
					if (point !== null) seekTo(point);
					return;
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [startReverseShuttle, stopShuttle]);

	return { marks, setMarks, deleteMarkedRange };
}
