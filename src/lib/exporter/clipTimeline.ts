import { hasClipTransitions } from "@/components/video-editor/clipTransitions";
import { type ClipRegion, getClipSourceStartMs } from "@/components/video-editor/types";

/**
 * Trim-only native paths concatenate source ranges; they cannot place clips or
 * draw (and fade the sound of) transitions between them.
 */
export function requiresClipTimelineRendering(clips?: ClipRegion[]): boolean {
	if (!clips) return false;
	return (
		hasClipTransitions(clips) ||
		clips.length !== 1 ||
		clips[0].startMs !== 0 ||
		getClipSourceStartMs(clips[0]) !== 0 ||
		clips[0].speed !== 1
	);
}
