/** Past this drift a playing source track jumps back in sync instead of easing in. */
export const SOURCE_AUDIO_PLAYING_SEEK_DRIFT_SECONDS = 0.12;
/** A paused track is always parked exactly on the frame shown. */
export const SOURCE_AUDIO_PAUSED_SEEK_DRIFT_SECONDS = 0.01;
/** A seek needs a moment to land; re-seeking sooner makes the sound stutter. */
export const SOURCE_AUDIO_SEEK_COOLDOWN_MS = 350;
/** Drift that is left alone: below what anyone hears or sees on lips. */
const DRIFT_TOLERANCE_SECONDS = 0.02;
/** Largest playback-rate nudge, small enough to stay inaudible with pitch preserved. */
const MAX_RATE_ADJUSTMENT = 0.025;
/** The rate nudge closes the gap over about this long. */
const CORRECTION_WINDOW_SECONDS = 1;

export interface SourceAudioCorrection {
	seek: boolean;
	playbackRate: number;
}

/**
 * Keeps a source audio track locked to the picture: small drift is eased out
 * by playing slightly faster or slower, large drift (a cut in the audio, a
 * late start) is fixed by a seek.
 */
export function getSourceAudioCorrection({
	audioTime,
	targetTime,
	isPlaying,
	basePlaybackRate,
	timelineJumped,
	msSinceLastSeek,
}: {
	audioTime: number;
	targetTime: number;
	isPlaying: boolean;
	basePlaybackRate: number;
	timelineJumped: boolean;
	msSinceLastSeek: number;
}): SourceAudioCorrection {
	const baseRate =
		Number.isFinite(basePlaybackRate) && basePlaybackRate > 0 ? basePlaybackRate : 1;
	if (!Number.isFinite(audioTime) || !Number.isFinite(targetTime)) {
		return { seek: true, playbackRate: baseRate };
	}
	const driftSeconds = targetTime - audioTime;
	if (timelineJumped) return { seek: true, playbackRate: baseRate };
	if (!isPlaying) {
		return {
			seek: Math.abs(driftSeconds) > SOURCE_AUDIO_PAUSED_SEEK_DRIFT_SECONDS,
			playbackRate: baseRate,
		};
	}
	if (Math.abs(driftSeconds) > SOURCE_AUDIO_PLAYING_SEEK_DRIFT_SECONDS) {
		// Right after a seek the element may still report its old position.
		if (msSinceLastSeek >= SOURCE_AUDIO_SEEK_COOLDOWN_MS) {
			return { seek: true, playbackRate: baseRate };
		}
		return { seek: false, playbackRate: baseRate };
	}
	if (Math.abs(driftSeconds) <= DRIFT_TOLERANCE_SECONDS) {
		return { seek: false, playbackRate: baseRate };
	}
	const adjustment = Math.max(
		-MAX_RATE_ADJUSTMENT,
		Math.min(MAX_RATE_ADJUSTMENT, driftSeconds / CORRECTION_WINDOW_SECONDS),
	);
	return { seek: false, playbackRate: baseRate * (1 + adjustment) };
}
