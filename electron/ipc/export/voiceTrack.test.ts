import { describe, expect, it } from "vitest";
import {
	buildImportedVoiceArgs,
	buildRawVoiceWavArgs,
	getVoiceTrackPaths,
	isVoiceTrackSidecarPath,
	parseAudioDurationOutput,
} from "./voiceTrack";

describe("isVoiceTrackSidecarPath", () => {
	it("accepts the live mic sidecar only", () => {
		expect(isVoiceTrackSidecarPath("/rec/take.mic.m4a")).toBe(true);
		expect(isVoiceTrackSidecarPath("/rec/take.MIC.M4A")).toBe(true);
		expect(isVoiceTrackSidecarPath("/rec/take.original.mic.m4a")).toBe(false);
		expect(isVoiceTrackSidecarPath("/rec/take.before-import.mic.m4a")).toBe(false);
		expect(isVoiceTrackSidecarPath("/rec/take.mp4")).toBe(false);
	});
});

describe("getVoiceTrackPaths", () => {
	it("derives the backups next to the sidecar", () => {
		expect(getVoiceTrackPaths("/rec/take.mic.m4a")).toEqual({
			mic: "/rec/take.mic.m4a",
			original: "/rec/take.original.mic.m4a",
			beforeImport: "/rec/take.before-import.mic.m4a",
			baseName: "take",
		});
	});
});

describe("parseAudioDurationOutput", () => {
	it("reads the duration of an audio file", () => {
		const output = [
			"Input #0, wav, from 'voice.wav':",
			"  Duration: 00:01:02.50, bitrate: 2304 kb/s",
			"  Stream #0:0: Audio: pcm_s24le, 48000 Hz, mono, s32, 1152 kb/s",
		].join("\n");
		expect(parseAudioDurationOutput(output)).toBeCloseTo(62.5);
	});

	it("rejects files without an audio stream", () => {
		const output = [
			"  Duration: 00:00:10.00, bitrate: 100 kb/s",
			"  Stream #0:0: Video: h264, yuv420p, 1920x1080",
		].join("\n");
		expect(parseAudioDurationOutput(output)).toBeNull();
	});

	it("rejects unreadable output", () => {
		expect(parseAudioDurationOutput("voice.txt: Invalid data found")).toBeNull();
	});
});

describe("ffmpeg args", () => {
	it("exports the raw voice as 24-bit 48 kHz WAV", () => {
		const args = buildRawVoiceWavArgs({ inputPath: "in.m4a", outputPath: "out.wav" });
		expect(args).toEqual(
			expect.arrayContaining(["-map", "0:a:0", "-c:a", "pcm_s24le", "-ar", "48000"]),
		);
		expect(args.at(-1)).toBe("out.wav");
	});

	it("re-encodes the processed voice into the sidecar format", () => {
		const args = buildImportedVoiceArgs({ inputPath: "in.wav", outputPath: "out.m4a" });
		expect(args).toEqual(expect.arrayContaining(["-c:a", "aac", "-b:a", "256k", "-f", "mp4"]));
		expect(args.at(-1)).toBe("out.m4a");
	});
});
