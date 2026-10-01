import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";

const execFileAsync = promisify(execFile);

/** GIF teaser: short, email-width, small palette so it stays a few MB. */
export const SHARE_KIT_GIF_SECONDS = 6;
export const SHARE_KIT_GIF_WIDTH = 600;
export const SHARE_KIT_GIF_FPS = 10;
export const SHARE_KIT_THUMBNAIL_MAX_WIDTH = 1280;

const PLAY_BUTTON_SOURCE_SIZE = 400;

export interface ShareKitPaths {
	folder: string;
	video: string;
	gif: string;
	thumbnail: string;
}

export function getShareKitPaths(videoPath: string): ShareKitPaths {
	const parsed = path.parse(videoPath);
	const folder = path.join(parsed.dir, `${parsed.name} - kit de partage`);
	return {
		folder,
		video: path.join(folder, `${parsed.name}${parsed.ext}`),
		gif: path.join(folder, `${parsed.name} - aperçu.gif`),
		thumbnail: path.join(folder, `${parsed.name} - vignette.png`),
	};
}

export function buildShareKitGifArgs(options: {
	inputPath: string;
	outputPath: string;
	durationSec: number;
}): string[] {
	const length = Math.min(SHARE_KIT_GIF_SECONDS, Math.max(0.5, options.durationSec));
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-t",
		length.toFixed(3),
		"-i",
		options.inputPath,
		"-filter_complex",
		`fps=${SHARE_KIT_GIF_FPS},scale=${SHARE_KIT_GIF_WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
		"-loop",
		"0",
		options.outputPath,
	];
}

/**
 * Thumbnail = one frame with a round play button (brand green, white triangle)
 * drawn by geq at 400px and scaled down for smooth edges.
 */
export function buildShareKitThumbnailArgs(options: {
	inputPath: string;
	outputPath: string;
	atSec: number;
	width: number;
	height: number;
}): string[] {
	const scale = Math.min(1, SHARE_KIT_THUMBNAIL_MAX_WIDTH / options.width);
	const outW = Math.round((options.width * scale) / 2) * 2;
	const outH = Math.round((options.height * scale) / 2) * 2;
	const button = Math.round(Math.min(outW, outH) * 0.22);

	const size = PLAY_BUTTON_SOURCE_SIZE;
	const c = size / 2;
	const radius = c - 2;
	// Triangle pointing right, nudged right of centre so it looks optically centred.
	const tLeft = Math.round(size * 0.39);
	const tRight = Math.round(size * 0.73);
	const tHalf = Math.round(size * 0.21);
	const inCircle = `lte(hypot(X-${c},Y-${c}),${radius})`;
	const inTriangle = `gte(X,${tLeft})*lte(abs(Y-${c}),(${tRight}-X)*${(tHalf / (tRight - tLeft)).toFixed(4)})`;
	const geq = [
		`r='if(${inTriangle},255,42)'`,
		`g='if(${inTriangle},255,202)'`,
		`b='if(${inTriangle},255,165)'`,
		`a='if(${inCircle},if(${inTriangle},255,235),0)'`,
	].join(":");

	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-ss",
		options.atSec.toFixed(3),
		"-i",
		options.inputPath,
		"-f",
		"lavfi",
		"-i",
		`color=c=black@0:s=${size}x${size},format=rgba`,
		"-filter_complex",
		`[0:v]scale=${outW}:${outH}:flags=lanczos,setsar=1,format=rgba[bg];[1:v]geq=${geq},scale=${button}:${button}:flags=lanczos[btn];[bg][btn]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgb24`,
		"-frames:v",
		"1",
		options.outputPath,
	];
}

/** Frame worth showing: past an intro card / fade-in, but never past the end. */
export function pickThumbnailTime(durationSec: number): number {
	if (!(durationSec > 0)) return 0;
	return Math.min(durationSec * 0.5, Math.max(durationSec * 0.2, Math.min(4, durationSec * 0.4)));
}

export async function generateShareKit(options: {
	ffmpegPath: string;
	videoPath: string;
}): Promise<ShareKitPaths> {
	const metadata = await probeNativeVideoMetadata(options.ffmpegPath, options.videoPath);
	if (!(metadata.width > 0) || !(metadata.height > 0) || !(metadata.duration > 0)) {
		throw new Error("Could not read the exported video");
	}

	const paths = getShareKitPaths(options.videoPath);
	await fs.mkdir(paths.folder, { recursive: true });
	await fs.copyFile(options.videoPath, paths.video);

	const run = (args: string[]) =>
		execFileAsync(options.ffmpegPath, args, {
			timeout: 10 * 60_000,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});

	await run(
		buildShareKitGifArgs({
			inputPath: options.videoPath,
			outputPath: paths.gif,
			durationSec: metadata.duration,
		}),
	);
	await run(
		buildShareKitThumbnailArgs({
			inputPath: options.videoPath,
			outputPath: paths.thumbnail,
			atSec: pickThumbnailTime(metadata.duration),
			width: metadata.width,
			height: metadata.height,
		}),
	);
	return paths;
}
