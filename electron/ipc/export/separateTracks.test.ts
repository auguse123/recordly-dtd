import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildAlignedVoiceWavArgs,
	buildFullAudioWavArgs,
	buildSilentVideoArgs,
	getMainClipOffsetSec,
	getSeparateTracksPaths,
} from "./separateTracks";

describe("getSeparateTracksPaths", () => {
	it("puts every track in a sibling folder named after the export", () => {
		const paths = getSeparateTracksPaths(path.join("/exports", "Visite.mp4"));
		const folder = path.join("/exports", "Visite - pistes séparées");
		expect(paths).toEqual({
			folder,
			video: path.join(folder, "Visite - vidéo sans son.mp4"),
			fullAudio: path.join(folder, "Visite - son complet.wav"),
			voice: path.join(folder, "Visite - voix brute.wav"),
		});
	});
});

describe("ffmpeg args", () => {
	it("stream-copies the picture without audio", () => {
		const args = buildSilentVideoArgs({ inputPath: "in.mp4", outputPath: "out.mp4" });
		expect(args).toEqual(expect.arrayContaining(["-map", "0:v:0", "-c", "copy", "-an"]));
		expect(args.at(-1)).toBe("out.mp4");
	});

	it("extracts the full mix as 24-bit 48 kHz WAV", () => {
		const args = buildFullAudioWavArgs({ inputPath: "in.mp4", outputPath: "out.wav" });
		expect(args).toEqual(
			expect.arrayContaining(["-map", "0:a:0", "-vn", "-c:a", "pcm_s24le", "-ar", "48000"]),
		);
		expect(args.at(-1)).toBe("out.wav");
	});

	it("delays and pads the voice to the final length", () => {
		const args = buildAlignedVoiceWavArgs({
			inputPath: "voice.wav",
			outputPath: "out.wav",
			offsetSec: 2.5,
			totalDurationSec: 15.25,
		});
		expect(args[args.indexOf("-af") + 1]).toBe("adelay=2500:all=1,apad,atrim=duration=15.250");
		expect(args).toEqual(expect.arrayContaining(["-c:a", "pcm_s24le", "-ar", "48000"]));
	});

	it("never uses a negative delay", () => {
		const args = buildAlignedVoiceWavArgs({
			inputPath: "voice.wav",
			outputPath: "out.wav",
			offsetSec: -1,
			totalDurationSec: 10,
		});
		expect(args[args.indexOf("-af") + 1]).toMatch(/^adelay=0:all=1,/);
	});
});

describe("getMainClipOffsetSec", () => {
	it("is zero without an intro", () => {
		expect(getMainClipOffsetSec(0, 10)).toBe(0);
	});

	it("starts the main clip one cross-fade before the intro ends", () => {
		expect(getMainClipOffsetSec(3, 10)).toBeCloseTo(2.5);
	});

	it("shortens the fade for a short intro", () => {
		expect(getMainClipOffsetSec(0.9, 10)).toBeCloseTo(0.6);
	});
});
