import React, { useMemo } from "react";
import type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
import { getSourceTrackIdFromPath } from "@/lib/exporter/audioRoutingEngine";
import { resolveSourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import { getGainAt, getTransitionGainEnvelope, resolveClipTransitions } from "../clipTransitions";
import type { AudioRegion, ClipRegion } from "../types";
import { findClipAtTimelineTime, mapTimelineTimeToSourceTime } from "../types";
import type { PlayheadClock } from "../videoPlayback/playheadClock";
import { isClipMutedById } from "./clipAudio";
import {
	findAudioClipAt,
	getAudioClipSourceTimeMs,
	getAudioClipTrackGain,
	getAudioClipVolume,
	resolveAudioClipSync,
} from "./detachedAudio";
import { type PreviewAudioFrame, useAudioPreviewSync } from "./useAudioPreviewSync";
import { useClipAudioSettingsController } from "./useClipAudioSettingsController";
import { useMusicDuckingEnvelopes } from "./useMusicDuckingEnvelopes";
import { useSourceAudioFallback } from "./useSourceAudioFallback";

function extractLocalPathFromMediaServerUrl(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		const url = new URL(input);
		const isLocalMediaServer =
			(url.protocol === "http:" || url.protocol === "https:") &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video";
		if (!isLocalMediaServer) return null;
		return url.searchParams.get("path");
	} catch {
		return null;
	}
}

interface UseVideoEditorAudioParams {
	currentSourcePath: string | null;
	selectedClipId: string | null;
	clipRegions: ClipRegion[];
	/** Audio clips cut apart from the video, or null while the sound follows the video. */
	audioClipRegions?: ClipRegion[] | null;
	audioRegions: AudioRegion[];
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
	setSourceAudioTrackSettingsByClip: React.Dispatch<
		React.SetStateAction<Record<string, SourceAudioTrackSettings>>
	>;
	defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
	setDefaultSourceAudioTrackSettings: React.Dispatch<
		React.SetStateAction<SourceAudioTrackSettings>
	>;
	/** Timeline time committed to React state (coarse while playing). */
	timelineTime: number;
	/** Frame-accurate playhead the preview audio follows. */
	playheadClock: PlayheadClock;
	duration: number;
	isPlaying: boolean;
	previewVolume: number;
	sourceAudioFallbackRefreshKey?: number;
	summarizeErrorMessage: (message: string) => string;
	onSourceFallbackLoadError: (error: unknown) => void;
}

export function useVideoEditorAudio({
	currentSourcePath,
	selectedClipId,
	clipRegions,
	audioClipRegions = null,
	audioRegions,
	sourceAudioTrackSettingsByClip,
	setSourceAudioTrackSettingsByClip,
	defaultSourceAudioTrackSettings,
	setDefaultSourceAudioTrackSettings,
	timelineTime,
	playheadClock,
	duration,
	isPlaying,
	previewVolume,
	sourceAudioFallbackRefreshKey = 0,
	summarizeErrorMessage,
	onSourceFallbackLoadError,
}: UseVideoEditorAudioParams) {
	const fallbackLookupSourcePath = useMemo(
		() => extractLocalPathFromMediaServerUrl(currentSourcePath) ?? currentSourcePath,
		[currentSourcePath],
	);

	const { sourceAudioFallbackPaths, sourceAudioFallbackStartDelayMsByPath } =
		useSourceAudioFallback({
			currentSourcePath: fallbackLookupSourcePath,
			refreshKey: sourceAudioFallbackRefreshKey,
			summarizeErrorMessage,
		});

	const sourceTrackRoutingPolicy = useMemo(
		() => resolveSourceTrackRoutingPolicy(currentSourcePath, sourceAudioFallbackPaths),
		[currentSourcePath, sourceAudioFallbackPaths],
	);
	const isAudioDetached = audioClipRegions !== null;
	const previewSourceAudioFallbackPaths = sourceTrackRoutingPolicy.playbackPaths;
	// Detached audio plays on its own clock, so the video element stays silent
	// and the recording's own sound (when it carries any) is played separately.
	const shouldMutePreviewVideo = isAudioDetached || sourceTrackRoutingPolicy.muteEmbeddedPreview;
	const embeddedSourceAudioPath =
		isAudioDetached && !sourceTrackRoutingPolicy.muteEmbeddedPreview
			? fallbackLookupSourcePath
			: null;
	// Sync offsets baked in: what the clips actually play.
	const playbackAudioClips = useMemo(
		() => (audioClipRegions ? resolveAudioClipSync(audioClipRegions) : null),
		[audioClipRegions],
	);

	const activeClipIdAtCurrentTime = useMemo(
		() => findClipAtTimelineTime(timelineTime * 1000, clipRegions)?.id ?? null,
		[clipRegions, timelineTime],
	);
	const isCurrentClipMuted = useMemo(
		() =>
			activeClipIdAtCurrentTime === null ||
			isClipMutedById(activeClipIdAtCurrentTime, clipRegions),
		[activeClipIdAtCurrentTime, clipRegions],
	);

	const transitionGainEnvelope = useMemo(
		() => getTransitionGainEnvelope(resolveClipTransitions(clipRegions)),
		[clipRegions],
	);
	const sourceTransitionGain = getGainAt(transitionGainEnvelope, timelineTime * 1000);

	const {
		sourceAudioTrackMeta,
		activeSourceAudioTrackSettings,
		selectedClipSourceAudioTrackSettings,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedSourcePreviewGain,
		getSourceTrackPreviewGain,
		getClipPreviewGains,
		embeddedTrackId,
	} = useClipAudioSettingsController({
		selectedClipId,
		activeClipId: activeClipIdAtCurrentTime,
		sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings,
	});

	const micSidecarPath = useMemo(
		() => sourceAudioFallbackPaths.find((path) => path.includes(".mic.")) ?? null,
		[sourceAudioFallbackPaths],
	);
	// Everything the preview sound needs at one playhead position, resolved per frame
	// from the clock rather than from React state (which only follows it coarsely).
	const resolvePreviewAudioFrame = useMemo(() => {
		let lastTime = Number.NaN;
		let lastFrame: PreviewAudioFrame | null = null;
		return (timelineSec: number): PreviewAudioFrame => {
			if (lastFrame && timelineSec === lastTime) return lastFrame;
			const timelineMs = timelineSec * 1000;
			const videoClip = findClipAtTimelineTime(timelineMs, clipRegions);
			const audioClip = playbackAudioClips
				? findAudioClipAt(timelineMs, playbackAudioClips)
				: null;
			const isVideoClipMuted = !videoClip || isClipMutedById(videoClip.id, clipRegions);
			const transitionGain = getGainAt(transitionGainEnvelope, timelineMs);
			const gains = getClipPreviewGains(videoClip?.id ?? null);
			const getBaseTrackGain = embeddedSourceAudioPath
				? (path: string) =>
						path === embeddedSourceAudioPath ? gains.embedded : gains.forPath(path)
				: gains.forPath;
			// A detached clip levels each track (system, mic…) on its own.
			const getSourceTrackGain = audioClip
				? (path: string) =>
						getBaseTrackGain(path) *
						getAudioClipTrackGain(
							audioClip,
							path === embeddedSourceAudioPath
								? embeddedTrackId
								: getSourceTrackIdFromPath(path),
						)
				: getBaseTrackGain;
			const frame: PreviewAudioFrame = {
				sourceTime:
					audioClip !== null
						? getAudioClipSourceTimeMs(audioClip, timelineMs) / 1000
						: mapTimelineTimeToSourceTime(timelineMs, clipRegions) / 1000,
				sourcePlaybackRate: isAudioDetached
					? (audioClip?.speed ?? 1)
					: (videoClip?.speed ?? 1),
				isSourceMuted: isAudioDetached
					? !audioClip || Boolean(audioClip.muted)
					: isVideoClipMuted,
				sourceGain: isAudioDetached
					? audioClip
						? getAudioClipVolume(audioClip)
						: 0
					: transitionGain,
				getSourceTrackGain,
				embeddedVideoGain:
					shouldMutePreviewVideo || isVideoClipMuted
						? 0
						: Math.max(0, Math.min(1, gains.embedded * transitionGain)),
			};
			lastTime = timelineSec;
			lastFrame = frame;
			return frame;
		};
	}, [
		clipRegions,
		embeddedSourceAudioPath,
		embeddedTrackId,
		getClipPreviewGains,
		isAudioDetached,
		playbackAudioClips,
		shouldMutePreviewVideo,
		transitionGainEnvelope,
	]);

	const userTrackGainEnvelopes = useMusicDuckingEnvelopes({
		audioRegions,
		clipRegions: playbackAudioClips ?? clipRegions,
		voicePath: micSidecarPath ?? fallbackLookupSourcePath,
		voiceStartDelayMs: micSidecarPath
			? (sourceAudioFallbackStartDelayMsByPath[micSidecarPath] ?? 0)
			: 0,
	});

	const { playSourceAudioPreview } = useAudioPreviewSync({
		audioRegions,
		previewVolume,
		isPlaying,
		playheadClock,
		resolveFrame: resolvePreviewAudioFrame,
		duration,
		previewSourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath,
		sourceAudioResourceVersion: sourceAudioFallbackRefreshKey,
		embeddedSourceAudioPath,
		userTrackGainEnvelopes,
		onSourceFallbackLoadError,
	});

	return {
		sourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath,
		previewSourceAudioFallbackPaths,
		shouldMutePreviewVideo,
		activeClipIdAtCurrentTime,
		isCurrentClipMuted,
		sourceTransitionGain,
		sourceAudioTrackMeta,
		activeSourceAudioTrackSettings,
		selectedClipSourceAudioTrackSettings,
		playSourceAudioPreview,
		resolvePreviewAudioFrame,
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedSourcePreviewGain,
		getSourceTrackPreviewGain,
	};
}
