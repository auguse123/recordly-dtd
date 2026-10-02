import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { IntroOutroSettings } from "../introOutro";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { getErrorMessage, summarizeErrorMessage } from "../videoEditorUtils";
import type { PlayheadClock } from "../videoPlayback/playheadClock";
import { useAnnotationRegionCommands } from "./useAnnotationRegionCommands";
import { useAudioClipCommands } from "./useAudioClipCommands";
import { useAudioRegionCommands } from "./useAudioRegionCommands";
import { useCaptionCommands } from "./useCaptionCommands";
import { useClipRegionCommands } from "./useClipRegionCommands";
import { useCursorTelemetry } from "./useCursorTelemetry";
import { useEditingShortcuts } from "./useEditingShortcuts";
import { useEditorGlobalInteractions } from "./useEditorGlobalInteractions";
import { useEditorPlaybackControls } from "./useEditorPlaybackControls";
import { useFreshRecordingAutoZoom } from "./useFreshRecordingAutoZoom";
import { useIntroOutroPreview } from "./useIntroOutroPreview";
import { useTimelineProjection } from "./useTimelineProjection";
import { useZoomRegionCommands } from "./useZoomRegionCommands";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	shortcuts: ReturnType<typeof useShortcuts>["shortcuts"];
	isMac: boolean;
	appPlatform: string;
	timeline: ReturnType<typeof useTimelineState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPath: string | null;
	videoSourcePath: string | null;
	currentSourcePath: string | null;
	duration: number;
	currentTime: number;
	/** Frame-accurate playhead; `currentTime` only follows it coarsely while playing. */
	playheadClock: PlayheadClock;
	isPlaying: boolean;
	previewVolume: number;
	introOutro: IntroOutroSettings;
	loading: boolean;
	isPreviewReady: boolean;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	setAutoSuggestZoomsTrigger: Dispatch<SetStateAction<number>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTimeoutRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
	handleUndo: () => void;
	handleRedo: () => void;
};

export function useTimelineEditingController(input: Input) {
	const { timeline } = input;
	const handleSourceFallbackLoadError = useCallback((error: unknown) => {
		toast.warning(
			`Could not load companion audio source: ${summarizeErrorMessage(getErrorMessage(error))}`,
			{ duration: 10000 },
		);
	}, []);
	const cursor = useCursorTelemetry({
		videoPath: input.videoPath,
		videoSourcePath: input.videoSourcePath,
		duration: input.duration,
		loopCursor: input.appearance.loopCursor,
		timeline,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
	});
	const projection = useTimelineProjection({
		timeline,
		duration: input.duration,
		currentTime: input.currentTime,
		nextClipIdRef: input.nextClipIdRef,
		initializedRef: input.clipInitializedRef,
		autoFullTrackIdRef: input.autoFullTrackClipIdRef,
		autoFullTrackEndRef: input.autoFullTrackClipEndMsRef,
	});
	const audio = useVideoEditorAudio({
		currentSourcePath: input.currentSourcePath,
		selectedClipId: timeline.selectedClipId,
		clipRegions: timeline.clipRegions,
		audioClipRegions: timeline.audioClipRegions,
		audioRegions: timeline.audioRegions,
		sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip: timeline.setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings: timeline.setDefaultSourceAudioTrackSettings,
		timelineTime: projection.timelinePlayheadTime,
		playheadClock: input.playheadClock,
		duration: input.duration,
		isPlaying: input.isPlaying,
		previewVolume: input.previewVolume,
		sourceAudioFallbackRefreshKey: timeline.sourceAudioFallbackRefreshKey,
		summarizeErrorMessage,
		onSourceFallbackLoadError: handleSourceFallbackLoadError,
	});
	const basePlayback = useEditorPlaybackControls({
		videoPlaybackRef: input.videoPlaybackRef,
		timelineRef: input.timelineRef,
		playSourceAudioPreview: audio.playSourceAudioPreview,
		playheadClock: input.playheadClock,
		timelineDuration: projection.timelineDuration,
	});
	const playback = useIntroOutroPreview({
		base: basePlayback,
		settings: input.introOutro,
		videoPlaybackRef: input.videoPlaybackRef,
		isPlaying: input.isPlaying,
		playheadSec: projection.timelinePlayheadTime,
		mainDurationSec: projection.timelineDuration,
	});
	const captionCommands = useCaptionCommands({
		clipRegions: timeline.clipRegions,
		autoCaptions: timeline.autoCaptions,
		setAutoCaptions: timeline.setAutoCaptions,
		setAutoCaptionSettings: timeline.setAutoCaptionSettings,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setActiveEffectSection: input.setActiveEffectSection,
		videoPlaybackRef: input.videoPlaybackRef,
		mapSourceTimeToTimelineTime: projection.mapSourceTimeToTimelineTime,
		handleSeek: playback.handleSeek,
	});
	const zoomCommands = useZoomRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		videoPath: input.videoPath,
		setZoomRegions: timeline.setZoomRegions,
		selectedZoomId: timeline.selectedZoomId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextZoomIdRef: input.nextZoomIdRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
	});
	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			timeline.setSelectedAnnotationId(id);
			if (id) {
				timeline.setSelectedClipId(null);
				timeline.setSelectedZoomId(null);
				timeline.setSelectedAudioId(null);
				timeline.setSelectedCaptionId(null);
			}
		},
		[
			timeline.setSelectedAnnotationId,
			timeline.setSelectedClipId,
			timeline.setSelectedZoomId,
			timeline.setSelectedAudioId,
			timeline.setSelectedCaptionId,
		],
	);
	const freshZoom = useFreshRecordingAutoZoom({
		appPlatform: input.appPlatform,
		videoPath: input.videoPath,
		loading: input.loading,
		isPreviewReady: input.isPreviewReady,
		duration: input.duration,
		cursorTelemetryCount: timeline.cursorTelemetry.length,
		normalizedCursorTelemetry: cursor.normalizedCursorTelemetry,
		zoomRegions: timeline.zoomRegions,
		setZoomRegions: timeline.setZoomRegions,
		setAutoSuggestZoomsTrigger: input.setAutoSuggestZoomsTrigger,
		videoPlaybackRef: input.videoPlaybackRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAutoSuggestTimeoutRef:
			input.pendingFreshRecordingAutoSuggestTimeoutRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef:
			input.pendingFreshRecordingAutoSuggestTelemetryCountRef,
	});
	const clipCommands = useClipRegionCommands({
		setAnnotationRegions: timeline.setAnnotationRegions,
		setAudioRegions: timeline.setAudioRegions,
		sourceDurationMs: input.duration * 1000,
		clipRegions: timeline.clipRegions,
		setClipRegions: timeline.setClipRegions,
		zoomRegions: timeline.zoomRegions,
		setZoomRegions: timeline.setZoomRegions,
		selectedClipId: timeline.selectedClipId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextClipIdRef: input.nextClipIdRef,
		t: input.t,
	});
	const audioCommands = useAudioRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		setAudioRegions: timeline.setAudioRegions,
		selectedAudioId: timeline.selectedAudioId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextAudioIdRef: input.nextAudioIdRef,
	});
	const clearSelectionsForAudioClip = useCallback(() => {
		timeline.setSelectedClipId(null);
		timeline.setSelectedZoomId(null);
		timeline.setSelectedAnnotationId(null);
		timeline.setSelectedAudioId(null);
		timeline.setSelectedCaptionId(null);
	}, [timeline]);
	const audioClipCommands = useAudioClipCommands({
		clipRegions: timeline.clipRegions,
		audioClipRegions: timeline.audioClipRegions,
		setAudioClipRegions: timeline.setAudioClipRegions,
		selectedAudioClipId: timeline.selectedAudioClipId,
		setSelectedAudioClipId: timeline.setSelectedAudioClipId,
		otherSelectedIds: [
			timeline.selectedClipId,
			timeline.selectedZoomId,
			timeline.selectedAnnotationId,
			timeline.selectedAudioId,
			timeline.selectedCaptionId,
		],
		clearOtherSelections: clearSelectionsForAudioClip,
		setActiveEffectSection: input.setActiveEffectSection,
		sourceDurationMs: input.duration * 1000,
		timelineDurationMs: projection.timelineDuration * 1000,
	});
	const { handleAudioClipSplit, handleAudioClipDelete } = audioClipCommands;
	const selectedAudioClipId = timeline.selectedAudioClipId;
	const { handleClipSplit } = clipCommands;
	/** ⌘B cuts the selected audio clip when there is one, otherwise the video. */
	const handleTimelineSplit = useCallback(
		(splitMs: number) => {
			if (selectedAudioClipId && handleAudioClipSplit(splitMs)) return;
			handleClipSplit(splitMs);
		},
		[handleAudioClipSplit, handleClipSplit, selectedAudioClipId],
	);
	const annotationCommands = useAnnotationRegionCommands({
		onSelectAnnotation: handleSelectAnnotation,
		setAnnotationRegions: timeline.setAnnotationRegions,
		selectedAnnotationId: timeline.selectedAnnotationId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});

	useEditorGlobalInteractions({
		timeline,
		shortcuts: input.shortcuts,
		isMac: input.isMac,
		handleUndo: input.handleUndo,
		handleRedo: input.handleRedo,
		togglePlayPause: playback.togglePlayPause,
	});
	const editTools = useEditingShortcuts({
		shortcuts: input.shortcuts,
		isMac: input.isMac,
		videoPath: input.videoPath,
		clipRegions: timeline.clipRegions,
		playheadSec: projection.timelinePlayheadTime,
		playheadClock: input.playheadClock,
		durationSec: projection.timelineDuration,
		isPreviewPlaying: playback.isPreviewPlaying,
		startPlayback: playback.startPlayback,
		togglePlayPause: playback.togglePlayPause,
		handleSeek: playback.handleSeek,
		handleClipSplit: handleTimelineSplit,
		handleRemoveRange: clipCommands.handleRemoveRange,
		handleTrimToPlayhead: clipCommands.handleTrimToPlayhead,
	});

	const { deleteMarkedRange } = editTools;
	const handleDeleteWithoutSelection = useCallback((): boolean => {
		if (selectedAudioClipId) {
			handleAudioClipDelete(selectedAudioClipId);
			return true;
		}
		return deleteMarkedRange();
	}, [deleteMarkedRange, handleAudioClipDelete, selectedAudioClipId]);

	return {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		audioClipCommands,
		annotationCommands,
		editTools,
		handleTimelineSplit,
		handleDeleteWithoutSelection,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed: freshZoom.handleAutoSuggestZoomsConsumed,
	};
}
