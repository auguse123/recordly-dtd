import { describe, expect, it } from "vitest";
import { buildIntroOutroFfmpegArgs } from "./introOutro";

const base = {
	mainPath: "main.mp4",
	outputPath: "out.mp4",
	width: 1920,
	height: 1080,
	frameRate: 30,
	mainDurationSec: 10,
	cardDurationSec: 3,
};

function filterOf(args: string[]) {
	return args[args.indexOf("-filter_complex") + 1];
}

describe("buildIntroOutroFfmpegArgs", () => {
	it("fades the intro into the main clip and the main clip into the outro", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			introPath: "intro.png",
			outroPath: "outro.png",
			hasAudio: true,
		});
		const filter = filterOf(args);
		expect(filter).toContain(
			"[vIntro][vMain]xfade=transition=fade:duration=0.500:offset=2.500",
		);
		// intro (3) + main (10) - fade (0.5) = 12.5, outro starts fading at 12.0
		expect(filter).toContain(
			"[vJoin1][vOutro]xfade=transition=fade:duration=0.500:offset=12.000",
		);
		expect(filter).toContain("[aJoin1][aOutro]acrossfade");
		expect(args).toContain("[vJoin2]");
		expect(args).toContain("[aJoin2]");
		expect(args.at(-1)).toBe("out.mp4");
	});

	it("drops audio branches when the export is silent", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			outroPath: "outro.png",
			hasAudio: false,
		});
		const filter = filterOf(args);
		expect(filter).not.toContain("anullsrc");
		expect(filter).not.toContain("acrossfade");
		expect(filter).toContain(
			"[vMain][vOutro]xfade=transition=fade:duration=0.500:offset=9.500",
		);
		expect(args).toContain("-an");
	});

	it("shortens the fade for very short cards", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			cardDurationSec: 1,
			introPath: "intro.png",
			hasAudio: false,
		});
		expect(filterOf(args)).toContain("xfade=transition=fade:duration=0.333:offset=0.667");
	});
});
