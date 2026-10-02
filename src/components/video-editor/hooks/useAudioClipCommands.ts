import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from "react";
import {
	changeAudioClipSpan,
	clampAudioClipsToDuration,
	DETACHED_AUDIO_CLIP_ID_PREFIX,
	detachClipAudio,
	findAudioClipAt,
	getAudioClipSyncOffsetMs,
	getAudioClipVolume,
	MAX_AUDIO_CLIP_VOLUME,
	nextAudioClipNumber,
	setAudioClipSyncOffset,
	splitAudioClip,
} from "../audio/detachedAudio";
import type { ClipRegion, EditorEffectSection } from "../types";

interface UseAudioClipCommandsParams {
	clipRegions: ClipRegion[];
	audioClipRegions: ClipRegion[] | null;
	setAudioClipRegions: Dispatch<SetStateAction<ClipRegion[] | null>>;
	selectedAudioClipId: string | null;
	setSelectedAudioClipId: Dispatch<SetStateAction<string | null>>;
	/** Other selections, cleared when an audio clip gets selected. */
	otherSelectedIds: ReadonlyArray<string | null>;
	clearOtherSelections: () => void;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	sourceDurationMs: number;
	timelineDurationMs: number;
}

/** Commands of the audio clips once the sound is detached from the video. */
export function useAudioClipCommands({
	clipRegions,
	audioClipRegions,
	setAudioClipRegions,
	selectedAudioClipId,
	setSelectedAudioClipId,
	otherSelectedIds,
	clearOtherSelections,
	setActiveEffectSection,
	sourceDurationMs,
	timelineDurationMs,
}: UseAudioClipCommandsParams) {
	const hasOtherSelection = otherSelectedIds.some((id) => id !== null);
	useEffect(() => {
		if (hasOtherSelection) setSelectedAudioClipId(null);
	}, [hasOtherSelection, setSelectedAudioClipId]);

	// Audio never outlasts the video: trim it when the video gets shorter.
	useEffect(() => {
		if (!audioClipRegions || timelineDurationMs <= 0) return;
		const clamped = clampAudioClipsToDuration(audioClipRegions, timelineDurationMs);
		if (clamped !== audioClipRegions) setAudioClipRegions(clamped);
	}, [audioClipRegions, setAudioClipRegions, timelineDurationMs]);

	useEffect(() => {
		if (
			selectedAudioClipId &&
			!audioClipRegions?.some((clip) => clip.id === selectedAudioClipId)
		) {
			setSelectedAudioClipId(null);
		}
	}, [audioClipRegions, selectedAudioClipId, setSelectedAudioClipId]);

	const handleDetachAudio = useCallback(() => {
		let next = nextAudioClipNumber(null);
		setAudioClipRegions(
			(current) =>
				current ??
				detachClipAudio(clipRegions, () => `${DETACHED_AUDIO_CLIP_ID_PREFIX}${next++}`),
		);
	}, [clipRegions, setAudioClipRegions]);

	const handleReattachAudio = useCallback(() => {
		setAudioClipRegions(null);
		setSelectedAudioClipId(null);
		setActiveEffectSection((section) => (section === "clip" ? "scene" : section));
	}, [setActiveEffectSection, setAudioClipRegions, setSelectedAudioClipId]);

	const handleSelectAudioClip = useCallback(
		(id: string | null) => {
			if (id) {
				clearOtherSelections();
				setActiveEffectSection("clip");
			}
			setSelectedAudioClipId(id);
		},
		[clearOtherSelections, setActiveEffectSection, setSelectedAudioClipId],
	);

	const handleAudioClipSpanChange = useCallback(
		(id: string, startMs: number, endMs: number) => {
			setAudioClipRegions((current) =>
				current
					? changeAudioClipSpan(
							current,
							id,
							startMs,
							endMs,
							sourceDurationMs,
							timelineDurationMs,
						)
					: current,
			);
		},
		[setAudioClipRegions, sourceDurationMs, timelineDurationMs],
	);

	/** Cuts the selected audio clip, or the one under the playhead, at `atMs`. */
	const handleAudioClipSplit = useCallback(
		(atMs: number): boolean => {
			if (!audioClipRegions) return false;
			const target =
				audioClipRegions.find(
					(clip) =>
						clip.id === selectedAudioClipId && atMs > clip.startMs && atMs < clip.endMs,
				) ?? findAudioClipAt(atMs, audioClipRegions);
			if (!target) return false;
			const newId = `${DETACHED_AUDIO_CLIP_ID_PREFIX}${nextAudioClipNumber(audioClipRegions)}`;
			const next = splitAudioClip(audioClipRegions, target.id, atMs, newId);
			if (!next) return false;
			setAudioClipRegions(next);
			return true;
		},
		[audioClipRegions, selectedAudioClipId, setAudioClipRegions],
	);

	const handleAudioClipDelete = useCallback(
		(id: string) => {
			setAudioClipRegions((current) =>
				current ? current.filter((clip) => clip.id !== id) : current,
			);
			setSelectedAudioClipId((selected) => (selected === id ? null : selected));
		},
		[setAudioClipRegions, setSelectedAudioClipId],
	);

	const updateSelectedAudioClip = useCallback(
		(patch: (clip: ClipRegion) => ClipRegion) => {
			if (!selectedAudioClipId) return;
			setAudioClipRegions((current) =>
				current
					? current.map((clip) => (clip.id === selectedAudioClipId ? patch(clip) : clip))
					: current,
			);
		},
		[selectedAudioClipId, setAudioClipRegions],
	);

	const handleAudioClipVolumeChange = useCallback(
		(volume: number) =>
			updateSelectedAudioClip((clip) => ({
				...clip,
				volume: Math.max(0, Math.min(MAX_AUDIO_CLIP_VOLUME, volume)),
			})),
		[updateSelectedAudioClip],
	);

	const handleAudioClipMutedChange = useCallback(
		(muted: boolean) =>
			updateSelectedAudioClip((clip) => {
				const { muted: _muted, ...rest } = clip;
				return muted ? { ...rest, muted: true } : rest;
			}),
		[updateSelectedAudioClip],
	);

	/** Re-syncs the selected audio clip, or every audio clip, against the picture. */
	const handleAudioClipSyncOffsetChange = useCallback(
		(offsetMs: number, applyToAll: boolean) => {
			if (!applyToAll && !selectedAudioClipId) return;
			const ids = applyToAll ? null : new Set([selectedAudioClipId as string]);
			setAudioClipRegions((current) =>
				current ? setAudioClipSyncOffset(current, ids, offsetMs) : current,
			);
		},
		[selectedAudioClipId, setAudioClipRegions],
	);

	const selectedAudioClip = useMemo(() => {
		const clip = audioClipRegions?.find((item) => item.id === selectedAudioClipId);
		return clip
			? {
					volume: getAudioClipVolume(clip),
					muted: Boolean(clip.muted),
					syncOffsetMs: getAudioClipSyncOffsetMs(clip),
				}
			: null;
	}, [audioClipRegions, selectedAudioClipId]);

	return {
		isAudioDetached: audioClipRegions !== null,
		selectedAudioClip,
		handleDetachAudio,
		handleReattachAudio,
		handleSelectAudioClip,
		handleAudioClipSpanChange,
		handleAudioClipSplit,
		handleAudioClipDelete,
		handleAudioClipVolumeChange,
		handleAudioClipMutedChange,
		handleAudioClipSyncOffsetChange,
	};
}
