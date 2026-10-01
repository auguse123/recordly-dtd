import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";

const execFileAsync = promisify(execFile);

export interface IntroOutroJoinPlan {
	introPath?: string;
	outroPath?: string;
	mainPath: string;
	outputPath: string;
	width: number;
	height: number;
	frameRate: number;
	mainDurationSec: number;
	cardDurationSec: number;
	hasAudio: boolean;
}

/**
 * ffmpeg args that cross-fade still title cards into and out of the main clip.
 * Every video branch is normalised to the same size/fps/timebase (required by
 * xfade); the main clip is padded then trimmed so its length is exact.
 */
export function buildIntroOutroFfmpegArgs(plan: IntroOutroJoinPlan): string[] {
	const fps = plan.frameRate;
	const card = plan.cardDurationSec;
	const fade = Math.min(0.5, card / 3);
	const mainDur = plan.mainDurationSec;
	const norm = `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,settb=AVTB`;

	const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
	const filters: string[] = [];
	let inputIndex = 0;

	const addCard = (pngPath: string, label: string) => {
		args.push("-loop", "1", "-framerate", String(fps), "-t", card.toFixed(3), "-i", pngPath);
		filters.push(`[${inputIndex}:v]${norm}[${label}]`);
		inputIndex += 1;
	};
	const addSilence = (label: string) => {
		args.push("-f", "lavfi", "-t", card.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
		filters.push(
			`[${inputIndex}:a]aformat=sample_rates=48000:channel_layouts=stereo[${label}]`,
		);
		inputIndex += 1;
	};

	if (plan.introPath) {
		addCard(plan.introPath, "vIntro");
		if (plan.hasAudio) addSilence("aIntro");
	}

	const mainIndex = inputIndex;
	args.push("-i", plan.mainPath);
	inputIndex += 1;
	filters.push(
		`[${mainIndex}:v]${norm},tpad=stop_mode=clone:stop_duration=1,trim=duration=${mainDur.toFixed(3)},setpts=PTS-STARTPTS[vMain]`,
	);
	if (plan.hasAudio) {
		filters.push(
			`[${mainIndex}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${mainDur.toFixed(3)},asetpts=PTS-STARTPTS[aMain]`,
		);
	}

	if (plan.outroPath) {
		addCard(plan.outroPath, "vOutro");
		if (plan.hasAudio) addSilence("aOutro");
	}

	let video = "vMain";
	let audio = "aMain";
	let length = mainDur;
	if (plan.introPath) {
		filters.push(
			`[vIntro][${video}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(card - fade).toFixed(3)}[vJoin1]`,
		);
		video = "vJoin1";
		if (plan.hasAudio) {
			filters.push(`[aIntro][${audio}]acrossfade=d=${fade.toFixed(3)}[aJoin1]`);
			audio = "aJoin1";
		}
		length = card + mainDur - fade;
	}
	if (plan.outroPath) {
		filters.push(
			`[${video}][vOutro]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${(length - fade).toFixed(3)}[vJoin2]`,
		);
		video = "vJoin2";
		if (plan.hasAudio) {
			filters.push(`[${audio}][aOutro]acrossfade=d=${fade.toFixed(3)}[aJoin2]`);
			audio = "aJoin2";
		}
	}

	args.push("-filter_complex", filters.join(";"), "-map", `[${video}]`);
	if (plan.hasAudio) {
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

/** Writes the cards next to the output, runs ffmpeg, removes the cards. */
export async function joinIntroOutro(options: {
	ffmpegPath: string;
	mainPath: string;
	workDir: string;
	introPng?: Uint8Array;
	outroPng?: Uint8Array;
	cardDurationSec: number;
}): Promise<string> {
	const metadata = await probeNativeVideoMetadata(options.ffmpegPath, options.mainPath);
	// Container duration; the main branch is clone-padded so a slightly shorter
	// video stream still fills it exactly.
	const mainDurationSec = metadata.duration;
	if (!(mainDurationSec > 0) || !(metadata.width > 0) || !(metadata.height > 0)) {
		throw new Error("Could not read the exported video for intro/outro");
	}

	const introPath = options.introPng ? path.join(options.workDir, "intro.png") : undefined;
	const outroPath = options.outroPng ? path.join(options.workDir, "outro.png") : undefined;
	if (introPath && options.introPng) await fs.writeFile(introPath, options.introPng);
	if (outroPath && options.outroPng) await fs.writeFile(outroPath, options.outroPng);

	const outputPath = path.join(options.workDir, "export-with-cards.mp4");
	const args = buildIntroOutroFfmpegArgs({
		introPath,
		outroPath,
		mainPath: options.mainPath,
		outputPath,
		width: metadata.width,
		height: metadata.height,
		frameRate: metadata.frameRate > 0 ? Math.round(metadata.frameRate) : 30,
		mainDurationSec,
		cardDurationSec: options.cardDurationSec,
		hasAudio: metadata.hasAudio,
	});

	try {
		await execFileAsync(options.ffmpegPath, args, {
			timeout: 30 * 60_000,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});
	} finally {
		await Promise.all(
			[introPath, outroPath]
				.filter((file): file is string => Boolean(file))
				.map((file) => fs.rm(file, { force: true })),
		);
	}
	return outputPath;
}
