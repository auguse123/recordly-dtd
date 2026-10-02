import { describe, expect, it } from "vitest";
import { getSourceAudioCorrection, SOURCE_AUDIO_SEEK_COOLDOWN_MS } from "./sourceAudioDrift";

const playing = {
	isPlaying: true,
	basePlaybackRate: 1,
	timelineJumped: false,
	msSinceLastSeek: Number.POSITIVE_INFINITY,
};

describe("getSourceAudioCorrection", () => {
	it("leaves an in-sync track alone", () => {
		expect(getSourceAudioCorrection({ ...playing, audioTime: 10, targetTime: 10.01 })).toEqual({
			seek: false,
			playbackRate: 1,
		});
	});

	it("eases small drift out with a bounded rate nudge", () => {
		const behind = getSourceAudioCorrection({ ...playing, audioTime: 10, targetTime: 10.06 });
		expect(behind.seek).toBe(false);
		expect(behind.playbackRate).toBeGreaterThan(1);
		expect(behind.playbackRate).toBeLessThanOrEqual(1.025);
		const ahead = getSourceAudioCorrection({ ...playing, audioTime: 10.1, targetTime: 10 });
		expect(ahead.playbackRate).toBeLessThan(1);
		expect(ahead.playbackRate).toBeGreaterThanOrEqual(0.975);
	});

	it("seeks on drift a viewer would see, but not right after a seek", () => {
		expect(getSourceAudioCorrection({ ...playing, audioTime: 10, targetTime: 10.3 }).seek).toBe(
			true,
		);
		expect(
			getSourceAudioCorrection({
				...playing,
				audioTime: 10,
				targetTime: 10.3,
				msSinceLastSeek: SOURCE_AUDIO_SEEK_COOLDOWN_MS - 1,
			}).seek,
		).toBe(false);
	});

	it("scales the nudge with the clip speed", () => {
		const fast = getSourceAudioCorrection({
			...playing,
			basePlaybackRate: 2,
			audioTime: 10,
			targetTime: 10.05,
		});
		expect(fast.playbackRate).toBeGreaterThan(2);
		expect(fast.playbackRate).toBeLessThanOrEqual(2.05);
	});

	it("parks a paused track exactly and follows timeline jumps", () => {
		expect(
			getSourceAudioCorrection({
				...playing,
				isPlaying: false,
				audioTime: 10,
				targetTime: 10.02,
			}).seek,
		).toBe(true);
		expect(
			getSourceAudioCorrection({
				...playing,
				timelineJumped: true,
				audioTime: 10,
				targetTime: 10,
			}).seek,
		).toBe(true);
	});
});
