import { getIntroOutroDurationSec, type IntroOutroSettings } from "../introOutro";
import type { ClipRegion, SpeedRegion, TrimRegion } from "../types";
import { streamExportBlobToTempFile } from "./exportPersistence";

/** What the last MP4 render used, so the voice can be re-rendered on the same timeline. */
export interface SeparateTracksContext {
	videoUrl: string;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	clipRegions?: ClipRegion[];
	audioClipRegions?: ClipRegion[] | null;
	micPath: string | null;
	micStartDelayMs?: number;
	introSec: number;
}

let lastExportContext: SeparateTracksContext | null = null;

/** The live mic sidecar among the editor's companion audio paths, if any. */
export function findMicSidecarPath(paths: readonly string[] | undefined): string | null {
	return (
		paths?.find((candidate) => {
			const lower = candidate.toLowerCase();
			return (
				lower.endsWith(".mic.m4a") &&
				!lower.endsWith(".original.mic.m4a") &&
				!lower.endsWith(".before-import.mic.m4a")
			);
		}) ?? null
	);
}

export function rememberSeparateTracksContext(input: {
	videoUrl: string;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	clipRegions?: ClipRegion[];
	audioClipRegions?: ClipRegion[] | null;
	sourceAudioFallbackPaths?: string[];
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
	introOutro?: IntroOutroSettings;
}) {
	const micPath = findMicSidecarPath(input.sourceAudioFallbackPaths);
	lastExportContext = {
		videoUrl: input.videoUrl,
		trimRegions: input.trimRegions,
		speedRegions: input.speedRegions,
		clipRegions: input.clipRegions,
		audioClipRegions: input.audioClipRegions,
		micPath,
		micStartDelayMs: micPath
			? input.sourceAudioFallbackStartDelayMsByPath?.[micPath]
			: undefined,
		introSec: input.introOutro ? getIntroOutroDurationSec(input.introOutro.intro) : 0,
	};
}

/**
 * Split the saved MP4 into a silent video + full mix WAV, plus the raw voice
 * (before clean-up) rendered on the same edit and aligned with the intro.
 */
export async function createSeparateTracks(exportedPath: string) {
	const context = lastExportContext;
	let voiceWavPath: string | null = null;
	if (context?.micPath) {
		const info = await window.electronAPI.getVoiceTrackInfo(context.micPath);
		if (info.success && info.rawPath) {
			const { AudioProcessor } = await import("@/lib/exporter/audioEncoder");
			const processor = new AudioProcessor();
			processor.setDetachedAudioClips(context.audioClipRegions);
			const blob = await processor.renderIsolatedSourceTrack({
				videoUrl: context.videoUrl,
				trackPath: info.rawPath,
				startDelayMs: context.micStartDelayMs,
				trimRegions: context.trimRegions,
				speedRegions: context.speedRegions,
				clipRegions: context.clipRegions,
			});
			voiceWavPath = await streamExportBlobToTempFile(blob, "wav");
		}
	}
	return window.electronAPI.generateSeparateTracks({
		videoPath: exportedPath,
		voiceWavPath,
		introSec: context?.introSec ?? 0,
	});
}
