import { describe, expect, it } from "vitest";
import { buildIntroOutroFfmpegArgs, type IntroOutroSegment } from "./introOutro";

const base = {
	mainPath: "main.mp4",
	outputPath: "out.mp4",
	width: 1920,
	height: 1080,
	frameRate: 30,
	mainDurationSec: 10,
};

const still = (path: string, durationSec = 3): IntroOutroSegment => ({
	kind: "still",
	path,
	durationSec,
});

function filterOf(args: string[]) {
	return args[args.indexOf("-filter_complex") + 1];
}

describe("buildIntroOutroFfmpegArgs", () => {
	it("fades the intro into the main clip and the main clip into the outro", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			intro: still("intro.png"),
			outro: still("outro.png"),
			mainHasAudio: true,
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

	it("uses different lengths for the intro and the outro", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			intro: still("intro.png", 2),
			outro: still("outro.png", 5),
			mainHasAudio: false,
		});
		const filter = filterOf(args);
		expect(filter).toContain("[vIntro][vMain]xfade=transition=fade:duration=0.500:offset=1.500");
		// 2 + 10 - 0.5 = 11.5, outro fades in at 11.0
		expect(filter).toContain(
			"[vJoin1][vOutro]xfade=transition=fade:duration=0.500:offset=11.000",
		);
		expect(args).toContain("5.000");
	});

	it("drops audio branches when nothing has sound", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			outro: still("outro.png"),
			mainHasAudio: false,
		});
		const filter = filterOf(args);
		expect(filter).not.toContain("anullsrc");
		expect(filter).not.toContain("acrossfade");
		expect(filter).toContain(
			"[vMain][vOutro]xfade=transition=fade:duration=0.500:offset=9.500",
		);
		expect(args).toContain("-an");
	});

	it("shortens the fade for very short segments", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			intro: still("intro.png", 1),
			mainHasAudio: false,
		});
		expect(filterOf(args)).toContain("xfade=transition=fade:duration=0.333:offset=0.667");
	});

	it("joins a video intro with its own sound onto a silent recording", () => {
		const args = buildIntroOutroFfmpegArgs({
			...base,
			intro: { kind: "video", path: "intro.mov", durationSec: 4, hasAudio: true },
			outro: still("outro.png"),
			mainHasAudio: false,
		});
		const filter = filterOf(args);
		expect(args).toContain("intro.mov");
		expect(filter).toContain("[0:a]aresample=48000");
		expect(filter).toContain("trim=duration=4.000");
		// The silent main clip and the still outro get generated silence.
		expect(filter.match(/anullsrc/g)).toBeNull();
		expect(args.filter((arg) => arg === "anullsrc=r=48000:cl=stereo")).toHaveLength(2);
		expect(filter).toContain("[vIntro][vMain]xfade=transition=fade:duration=0.500:offset=3.500");
		expect(filter).toContain("[aIntro][aMain]acrossfade");
		expect(args).toContain("[aJoin2]");
		expect(args).not.toContain("-an");
	});
});
