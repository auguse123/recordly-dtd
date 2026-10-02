import { useEffect, useMemo, useState } from "react";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import type { GainPoint } from "../clipTransitions";
import type { AudioRegion, ClipRegion } from "../types";
import {
	buildAudioRegionGainEnvelope,
	detectSpeechRanges,
	getClipOutputSegments,
	hasDuckingRegion,
	mapSourceRangesToOutput,
	type TimeRangeMs,
} from "./musicDucking";

/** Speech detection only needs the loudness contour, not full quality. */
const SPEECH_ANALYSIS_SAMPLE_RATE = 16_000;

const speechRangeCache = new Map<string, Promise<TimeRangeMs[]>>();

function loadSourceSpeechRanges(path: string): Promise<TimeRangeMs[]> {
	let pending = speechRangeCache.get(path);
	if (!pending) {
		pending = (async () => {
			const url = await resolveMediaResourceUrl(path);
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Failed to load voice audio (${response.status})`);
			const context = new OfflineAudioContext(1, 1, SPEECH_ANALYSIS_SAMPLE_RATE);
			const decoded = await context.decodeAudioData(await response.arrayBuffer());
			const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
				decoded.getChannelData(channel),
			);
			return detectSpeechRanges(channels, decoded.sampleRate);
		})();
		pending.catch(() => speechRangeCache.delete(path));
		speechRangeCache.set(path, pending);
	}
	return pending;
}

interface UseMusicDuckingEnvelopesParams {
	audioRegions: AudioRegion[];
	clipRegions: ClipRegion[];
	/** The mic sidecar when there is one, else the recording itself. */
	voicePath: string | null;
	voiceStartDelayMs: number;
}

/**
 * Gain curves (timeline ms) of the audio regions that fade or duck under the
 * voice, keyed by region id, for the editor preview.
 */
export function useMusicDuckingEnvelopes({
	audioRegions,
	clipRegions,
	voicePath,
	voiceStartDelayMs,
}: UseMusicDuckingEnvelopesParams): Map<string, GainPoint[]> {
	const needsSpeech = hasDuckingRegion(audioRegions);
	const [sourceSpeech, setSourceSpeech] = useState<{
		path: string;
		ranges: TimeRangeMs[];
	} | null>(null);

	useEffect(() => {
		if (!needsSpeech || !voicePath) return;
		let cancelled = false;
		loadSourceSpeechRanges(voicePath)
			.then((ranges) => {
				if (!cancelled) setSourceSpeech({ path: voicePath, ranges });
			})
			.catch((error) => {
				console.warn("[music-ducking] Voice analysis failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, [needsSpeech, voicePath]);

	const speechOutputRanges = useMemo(() => {
		if (!needsSpeech || !sourceSpeech || sourceSpeech.path !== voicePath) return [];
		const shifted = sourceSpeech.ranges.map((range) => ({
			startMs: range.startMs + voiceStartDelayMs,
			endMs: range.endMs + voiceStartDelayMs,
		}));
		return mapSourceRangesToOutput(shifted, getClipOutputSegments(clipRegions));
	}, [clipRegions, needsSpeech, sourceSpeech, voicePath, voiceStartDelayMs]);

	return useMemo(() => {
		const envelopes = new Map<string, GainPoint[]>();
		for (const region of audioRegions) {
			const envelope = buildAudioRegionGainEnvelope(region, speechOutputRanges);
			if (envelope.length > 0) envelopes.set(region.id, envelope);
		}
		return envelopes;
	}, [audioRegions, speechOutputRanges]);
}
