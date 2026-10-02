import React, { useMemo } from "react";
import type { SourceAudioTrackSettings } from "@/components/video-editor/audio/audioTypes";
import { resolveSourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import { getGainAt, getTransitionGainEnvelope, resolveClipTransitions } from "../clipTransitions";
import type { AudioRegion, ClipRegion } from "../types";
import { findClipAtTimelineTime } from "../types";
import { isClipMutedById } from "./clipAudio";
import { findAudioClipAt, getAudioClipSourceTimeMs, getAudioClipVolume } from "./detachedAudio";
import { useAudioPreviewSync } from "./useAudioPreviewSync";
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
	currentTime: number;
	timelineTime: number;
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
	currentTime,
	timelineTime,
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
	const activeAudioClip = useMemo(
		() => (audioClipRegions ? findAudioClipAt(timelineTime * 1000, audioClipRegions) : null),
		[audioClipRegions, timelineTime],
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
	const isSourceAudioMuted = isAudioDetached
		? !activeAudioClip || Boolean(activeAudioClip.muted)
		: isCurrentClipMuted;
	const sourceAudioGain = isAudioDetached
		? activeAudioClip
			? getAudioClipVolume(activeAudioClip)
			: 0
		: sourceTransitionGain;
	const sourceAudioTime =
		isAudioDetached && activeAudioClip
			? getAudioClipSourceTimeMs(activeAudioClip, timelineTime * 1000) / 1000
			: currentTime;
	const sourceAudioPlaybackRate = isAudioDetached
		? (activeAudioClip?.speed ?? 1)
		: (findClipAtTimelineTime(timelineTime * 1000, clipRegions)?.speed ?? 1);

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
	const getPreviewSourceTrackGain = useMemo(
		() =>
			embeddedSourceAudioPath
				? (path: string) =>
						path === embeddedSourceAudioPath
							? embeddedSourcePreviewGain
							: getSourceTrackPreviewGain(path)
				: getSourceTrackPreviewGain,
		[embeddedSourceAudioPath, embeddedSourcePreviewGain, getSourceTrackPreviewGain],
	);

	const userTrackGainEnvelopes = useMusicDuckingEnvelopes({
		audioRegions,
		clipRegions: audioClipRegions ?? clipRegions,
		voicePath: micSidecarPath ?? fallbackLookupSourcePath,
		voiceStartDelayMs: micSidecarPath
			? (sourceAudioFallbackStartDelayMsByPath[micSidecarPath] ?? 0)
			: 0,
	});

	const { playSourceAudioPreview } = useAudioPreviewSync({
		audioRegions,
		previewVolume,
		isPlaying,
		currentTime: sourceAudioTime,
		timelineTime,
		duration,
		sourcePlaybackRate: sourceAudioPlaybackRate,
		previewSourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath,
		sourceAudioResourceVersion: sourceAudioFallbackRefreshKey,
		isCurrentClipMuted: isSourceAudioMuted,
		embeddedSourceAudioPath,
		sourceTransitionGain: sourceAudioGain,
		userTrackGainEnvelopes,
		getSourceTrackPreviewGain: getPreviewSourceTrackGain,
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
		getSourceAudioTrackSettingsForClip,
		onSourceAudioTracksMetaChange,
		onSelectedClipSourceAudioTrackVolumeChange,
		onSelectedClipSourceAudioTrackNormalizeChange,
		embeddedSourcePreviewGain,
		getSourceTrackPreviewGain,
	};
}
