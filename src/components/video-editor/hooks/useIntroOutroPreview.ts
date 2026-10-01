import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
	getIntroOutroDurationSec,
	getIntroOutroFadeSec,
	type IntroOutroSettings,
	type IntroOutroSide,
} from "../introOutro";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useEditorPlaybackControls } from "./useEditorPlaybackControls";

/** Which side is on screen and how far into it (seconds from the side's start). */
export interface IntroOutroPhase {
	side: IntroOutroSide;
	timeSec: number;
	playing: boolean;
}

interface Clock {
	side: IntroOutroSide;
	anchorSec: number;
	anchorNow: number;
	playing: boolean;
}

function clockTime(clock: Clock) {
	return clock.playing
		? clock.anchorSec + (performance.now() - clock.anchorNow) / 1000
		: clock.anchorSec;
}

const END_EPSILON_SEC = 0.05;
/** How much of the recording plays before the outro when its timeline block is clicked. */
const OUTRO_LEAD_IN_SEC = 1;

export const INTRO_OUTRO_FOCUS_EVENT = "dtd:intro-outro-focus";

let lastFocusedSide: IntroOutroSide = "intro";

/** The side the settings panel should show when it (re)mounts. */
export function getRequestedIntroOutroSide(): IntroOutroSide {
	return lastFocusedSide;
}

/** Asks the intro/outro settings panel to show one side, mounted or not yet. */
export function requestIntroOutroFocus(side: IntroOutroSide) {
	lastFocusedSide = side;
	window.dispatchEvent(
		new CustomEvent<IntroOutroSide>(INTRO_OUTRO_FOCUS_EVENT, { detail: side }),
	);
}

/**
 * Previews the intro/outro around editor playback with the same timing as the
 * export: the intro plays first and cross-fades into the recording, and the
 * outro fades in over the last moments of the recording. The recording's own
 * transport is untouched; this layer only decides when to start/stop it.
 */
export function useIntroOutroPreview({
	base,
	settings,
	videoPlaybackRef,
	isPlaying,
	playheadSec,
	mainDurationSec,
}: {
	base: ReturnType<typeof useEditorPlaybackControls>;
	settings: IntroOutroSettings;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	isPlaying: boolean;
	playheadSec: number;
	mainDurationSec: number;
}) {
	const [phase, setPhase] = useState<IntroOutroPhase | null>(null);
	const clockRef = useRef<Clock | null>(null);
	const mainStartedRef = useRef(false);

	const introSec = mainDurationSec > 0 ? getIntroOutroDurationSec(settings.intro) : 0;
	const outroSec = mainDurationSec > 0 ? getIntroOutroDurationSec(settings.outro) : 0;
	const introFadeSec = introSec > 0 ? getIntroOutroFadeSec(introSec, mainDurationSec) : 0;
	const outroFadeSec = outroSec > 0 ? getIntroOutroFadeSec(outroSec, mainDurationSec) : 0;

	const latest = useRef({ base, introSec, introFadeSec, outroSec });
	latest.current = { base, introSec, introFadeSec, outroSec };

	const setClock = useCallback((clock: Clock | null) => {
		clockRef.current = clock;
		setPhase(
			clock ? { side: clock.side, timeSec: clock.anchorSec, playing: clock.playing } : null,
		);
	}, []);

	const stopPhase = useCallback(() => {
		if (clockRef.current) setClock(null);
	}, [setClock]);

	// Drive the active side while it plays.
	const phaseSide = phase?.side;
	const phasePlaying = phase?.playing ?? false;
	useEffect(() => {
		if (!phasePlaying) return;
		let frame = 0;
		const tick = () => {
			const clock = clockRef.current;
			if (!clock?.playing) return;
			const now = latest.current;
			const t = clockTime(clock);
			if (clock.side === "intro") {
				if (!mainStartedRef.current && t >= now.introSec - now.introFadeSec) {
					mainStartedRef.current = true;
					now.base.startPlayback();
				}
				if (t >= now.introSec) {
					setClock(null);
					return;
				}
			} else if (t >= now.outroSec) {
				setClock({ ...clock, anchorSec: now.outroSec, playing: false });
				return;
			}
			setPhase({ side: clock.side, timeSec: t, playing: true });
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [phasePlaying, phaseSide, setClock]);

	// The recording reaching the outro's fade-in point hands over to the outro.
	const wasPlayingRef = useRef(false);
	useEffect(() => {
		const wasPlaying = wasPlayingRef.current;
		wasPlayingRef.current = isPlaying;
		if (outroSec <= 0 || clockRef.current) return;
		const start = mainDurationSec - outroFadeSec;
		const reachedWhilePlaying = isPlaying && playheadSec >= start;
		const endedJustNow = wasPlaying && !isPlaying && playheadSec >= start - 0.1;
		if (reachedWhilePlaying || endedJustNow) {
			setClock({
				side: "outro",
				anchorSec: Math.max(0, playheadSec - start),
				anchorNow: performance.now(),
				playing: true,
			});
		}
	}, [isPlaying, playheadSec, mainDurationSec, outroSec, outroFadeSec, setClock]);

	// Settings changes that remove the active side end its preview.
	useEffect(() => {
		const side = clockRef.current?.side;
		if ((side === "intro" && introSec <= 0) || (side === "outro" && outroSec <= 0)) {
			stopPhase();
		}
	}, [introSec, outroSec, stopPhase]);

	const playIntroFrom = useCallback(
		(fromSec: number) => {
			base.handleSeek(0, { pause: true });
			mainStartedRef.current = false;
			setClock({
				side: "intro",
				anchorSec: fromSec,
				anchorNow: performance.now(),
				playing: true,
			});
		},
		[base, setClock],
	);

	const pause = useCallback(() => {
		const clock = clockRef.current;
		if (clock?.playing) setClock({ ...clock, anchorSec: clockTime(clock), playing: false });
		const playback = videoPlaybackRef.current;
		if (playback?.isPlaying) playback.pause();
	}, [setClock, videoPlaybackRef]);

	const startPlayback = useCallback(() => {
		const clock = clockRef.current;
		if (clock?.playing) return;
		if (clock) {
			const finishedOutro =
				clock.side === "outro" && clock.anchorSec >= outroSec - END_EPSILON_SEC;
			if (!finishedOutro) {
				setClock({ ...clock, anchorNow: performance.now(), playing: true });
				const mainShouldRun =
					clock.side === "intro"
						? mainStartedRef.current
						: playheadSec < mainDurationSec - END_EPSILON_SEC;
				if (mainShouldRun) base.startPlayback();
				return;
			}
			setClock(null);
			if (introSec > 0) {
				playIntroFrom(0);
				return;
			}
			base.handleSeek(0, { pause: true });
			base.startPlayback();
			return;
		}
		const atStart = playheadSec < END_EPSILON_SEC;
		const atEnd = playheadSec >= mainDurationSec - END_EPSILON_SEC;
		if (introSec > 0 && (atStart || atEnd)) {
			playIntroFrom(0);
			return;
		}
		base.startPlayback();
	}, [base, introSec, outroSec, mainDurationSec, playheadSec, playIntroFrom, setClock]);

	const isPreviewPlaying = isPlaying || phasePlaying;

	const togglePlayPause = useCallback(() => {
		if (!videoPlaybackRef.current?.video) return;
		if (clockRef.current?.playing || videoPlaybackRef.current.isPlaying) pause();
		else startPlayback();
	}, [pause, startPlayback, videoPlaybackRef]);

	const handleSeek = useCallback(
		(time: number, options: { pause?: boolean } = {}) => {
			stopPhase();
			base.handleSeek(time, options);
		},
		[base, stopPhase],
	);

	const handleTimelineSeek = useCallback(
		(time: number) => handleSeek(time, { pause: true }),
		[handleSeek],
	);

	const handlePreviewSkipBack = useCallback(() => {
		stopPhase();
		base.handlePreviewSkipBack();
	}, [base, stopPhase]);

	const handlePreviewSkipForward = useCallback(() => {
		stopPhase();
		base.handlePreviewSkipForward();
	}, [base, stopPhase]);

	/** Timeline block click: play that side with its transition. */
	const playSide = useCallback(
		(side: IntroOutroSide) => {
			if (side === "intro") {
				if (introSec > 0) playIntroFrom(0);
				return;
			}
			if (outroSec <= 0) return;
			stopPhase();
			base.handleSeek(Math.max(0, mainDurationSec - outroFadeSec - OUTRO_LEAD_IN_SEC), {
				pause: true,
			});
			base.startPlayback();
		},
		[base, introSec, outroSec, outroFadeSec, mainDurationSec, playIntroFrom, stopPhase],
	);

	return {
		...base,
		startPlayback,
		togglePlayPause,
		handleSeek,
		handleTimelineSeek,
		handlePreviewSkipBack,
		handlePreviewSkipForward,
		isPreviewPlaying,
		introOutro: {
			settings,
			phase,
			introSec,
			outroSec,
			introFadeSec,
			outroFadeSec,
			playSide,
		},
	};
}

export type EditorPlayback = ReturnType<typeof useIntroOutroPreview>;
