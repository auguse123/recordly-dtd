import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";

const execFileAsync = promisify(execFile);

export type IntroOutroSegment =
	| { kind: "still"; path: string; durationSec: number }
	| { kind: "video"; path: string; durationSec: number; hasAudio: boolean };

export interface IntroOutroJoinPlan {
	intro?: IntroOutroSegment;
	outro?: IntroOutroSegment;
	mainPath: string;
	outputPath: string;
	width: number;
	height: number;
	frameRate: number;
	mainDurationSec: number;
	mainHasAudio: boolean;
}

export const INTRO_OUTRO_MAX_FADE_SEC = 0.5;

/** Cross-fade length at a junction: short clips get a proportionally shorter fade. */
export function getIntroOutroFadeSec(segmentSec: number, mainSec: number): number {
	return Math.min(INTRO_OUTRO_MAX_FADE_SEC, segmentSec / 3, mainSec / 3);
}

/**
 * ffmpeg args that cross-fade intro/outro segments (still card or video clip)
 * into and out of the main clip. Every video branch is normalised to the same
 * size/fps/timebase (required by xfade); clips are padded then trimmed so each
 * length is exact. Segments without sound get silence when the output has audio.
 */
export function buildIntroOutroFfmpegArgs(plan: IntroOutroJoinPlan): string[] {
	const fps = plan.frameRate;
	const mainDur = plan.mainDurationSec;
	const norm = `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,settb=AVTB`;
	const hasAudio =
		plan.mainHasAudio ||
		(plan.intro?.kind === "video" && plan.intro.hasAudio) ||
		(plan.outro?.kind === "video" && plan.outro.hasAudio);
	const audioNorm = "aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo";

	const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
	const filters: string[] = [];
	let inputIndex = 0;

	const addSilence = (durationSec: number, label: string) => {
		args.push("-f", "lavfi", "-t", durationSec.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
		filters.push(`[${inputIndex}:a]${audioNorm}[${label}]`);
		inputIndex += 1;
	};
	const addClip = (
		clipPath: string,
		durationSec: number,
		clipHasAudio: boolean,
		vLabel: string,
		aLabel: string,
	) => {
		const index = inputIndex;
		args.push("-i", clipPath);
		inputIndex += 1;
		const d = durationSec.toFixed(3);
		filters.push(
			`[${index}:v]${norm},tpad=stop_mode=clone:stop_duration=1,trim=duration=${d},setpts=PTS-STARTPTS[${vLabel}]`,
		);
		if (!hasAudio) return;
		if (clipHasAudio) {
			filters.push(`[${index}:a]${audioNorm},apad,atrim=duration=${d},asetpts=PTS-STARTPTS[${aLabel}]`);
		} else {
			addSilence(durationSec, aLabel);
		}
	};
	const addSegment = (segment: IntroOutroSegment, vLabel: string, aLabel: string) => {
		if (segment.kind === "video") {
			addClip(segment.path, segment.durationSec, segment.hasAudio, vLabel, aLabel);
			return;
		}
		const d = segment.durationSec.toFixed(3);
		args.push("-loop", "1", "-framerate", String(fps), "-t", d, "-i", segment.path);
		filters.push(`[${inputIndex}:v]${norm}[${vLabel}]`);
		inputIndex += 1;
		if (hasAudio) addSilence(segment.durationSec, aLabel);
	};

	if (plan.intro) addSegment(plan.intro, "vIntro", "aIntro");
	addClip(plan.mainPath, mainDur, plan.mainHasAudio, "vMain", "aMain");
	if (plan.outro) addSegment(plan.outro, "vOutro", "aOutro");

	let video = "vMain";
	let audio = "aMain";
	let length = mainDur;
	if (plan.intro) {
		const fade = getIntroOutroFadeSec(plan.intro.durationSec, mainDur);
		filters.push(
			`[vIntro][${video}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(plan.intro.durationSec - fade).toFixed(3)}[vJoin1]`,
		);
		video = "vJoin1";
		if (hasAudio) {
			filters.push(`[aIntro][${audio}]acrossfade=d=${fade.toFixed(3)}[aJoin1]`);
			audio = "aJoin1";
		}
		length = plan.intro.durationSec + mainDur - fade;
	}
	if (plan.outro) {
		const fade = getIntroOutroFadeSec(plan.outro.durationSec, mainDur);
		filters.push(
			`[${video}][vOutro]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(length - fade).toFixed(3)}[vJoin2]`,
		);
		video = "vJoin2";
		if (hasAudio) {
			filters.push(`[${audio}][aOutro]acrossfade=d=${fade.toFixed(3)}[aJoin2]`);
			audio = "aJoin2";
		}
	}

	args.push("-filter_complex", filters.join(";"), "-map", `[${video}]`);
	if (hasAudio) {
		args.push("-map", `[${audio}]`, "-c:a", "aac", "-b:a", "192k");
	} else {
		args.push("-an");
	}
	args.push(
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-crf",
		"18",
		"-pix_fmt",
		"yuv420p",
		"-r",
		String(fps),
		"-movflags",
		"+faststart",
		plan.outputPath,
	);
	return args;
}

export type IntroOutroSegmentInput =
	| { kind: "still"; png: Uint8Array; durationSec: number }
	| { kind: "video"; path: string; durationSec: number; hasAudio: boolean };

/** Writes still cards next to the output, runs ffmpeg, removes the cards. */
export async function joinIntroOutro(options: {
	ffmpegPath: string;
	mainPath: string;
	workDir: string;
	intro?: IntroOutroSegmentInput;
	outro?: IntroOutroSegmentInput;
}): Promise<string> {
	const metadata = await probeNativeVideoMetadata(options.ffmpegPath, options.mainPath);
	// Container duration; the main branch is clone-padded so a slightly shorter
	// video stream still fills it exactly.
	const mainDurationSec = metadata.duration;
	if (!(mainDurationSec > 0) || !(metadata.width > 0) || !(metadata.height > 0)) {
		throw new Error("Could not read the exported video for intro/outro");
	}

	const written: string[] = [];
	const toSegment = async (
		input: IntroOutroSegmentInput | undefined,
		name: string,
	): Promise<IntroOutroSegment | undefined> => {
		if (!input) return undefined;
		if (input.kind === "video") return input;
		const pngPath = path.join(options.workDir, `${name}.png`);
		await fs.writeFile(pngPath, input.png);
		written.push(pngPath);
		return { kind: "still", path: pngPath, durationSec: input.durationSec };
	};

	const outputPath = path.join(options.workDir, "export-with-cards.mp4");
	try {
		const args = buildIntroOutroFfmpegArgs({
			intro: await toSegment(options.intro, "intro"),
			outro: await toSegment(options.outro, "outro"),
			mainPath: options.mainPath,
			outputPath,
			width: metadata.width,
			height: metadata.height,
			frameRate: metadata.frameRate > 0 ? Math.round(metadata.frameRate) : 30,
			mainDurationSec,
			mainHasAudio: metadata.hasAudio,
		});
		await execFileAsync(options.ffmpegPath, args, {
			timeout: 30 * 60_000,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});
	} finally {
		await Promise.all(written.map((file) => fs.rm(file, { force: true })));
	}
	return outputPath;
}
