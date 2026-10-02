import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";
import { getIntroOutroFadeSec } from "./introOutro";
import { probeAudioDurationSec } from "./voiceTrack";

const execFileAsync = promisify(execFile);

/** 24-bit / 48 kHz: what audio editors and DAWs expect for a lossless hand-off. */
export const SEPARATE_TRACKS_WAV_CODEC = "pcm_s24le";
export const SEPARATE_TRACKS_SAMPLE_RATE = 48_000;

export interface SeparateTracksPaths {
	folder: string;
	video: string;
	fullAudio: string;
	voice: string;
}

export function getSeparateTracksPaths(videoPath: string): SeparateTracksPaths {
	const parsed = path.parse(videoPath);
	const folder = path.join(parsed.dir, `${parsed.name} - pistes séparées`);
	return {
		folder,
		video: path.join(folder, `${parsed.name} - vidéo sans son${parsed.ext}`),
		fullAudio: path.join(folder, `${parsed.name} - son complet.wav`),
		voice: path.join(folder, `${parsed.name} - voix brute.wav`),
	};
}

const FFMPEG_PREAMBLE = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];

/** Same picture, stream-copied, no audio track. */
export function buildSilentVideoArgs(options: { inputPath: string; outputPath: string }): string[] {
	return [
		...FFMPEG_PREAMBLE,
		"-i",
		options.inputPath,
		"-map",
		"0:v:0",
		"-c",
		"copy",
		"-an",
		"-movflags",
		"+faststart",
		options.outputPath,
	];
}

/** The final mix exactly as heard in the exported MP4 (intro/outro included). */
export function buildFullAudioWavArgs(options: {
	inputPath: string;
	outputPath: string;
}): string[] {
	return [
		...FFMPEG_PREAMBLE,
		"-i",
		options.inputPath,
		"-map",
		"0:a:0",
		"-vn",
		"-c:a",
		SEPARATE_TRACKS_WAV_CODEC,
		"-ar",
		String(SEPARATE_TRACKS_SAMPLE_RATE),
		options.outputPath,
	];
}

/**
 * Edited voice rendered on the main timeline, shifted to where the main clip
 * starts in the final video and padded/trimmed to the exact final length, so it
 * lines up with the silent video when both start at 0 in an editor.
 */
export function buildAlignedVoiceWavArgs(options: {
	inputPath: string;
	outputPath: string;
	offsetSec: number;
	totalDurationSec: number;
}): string[] {
	const delayMs = Math.max(0, Math.round(options.offsetSec * 1000));
	const duration = Math.max(0.01, options.totalDurationSec).toFixed(3);
	return [
		...FFMPEG_PREAMBLE,
		"-i",
		options.inputPath,
		"-af",
		`adelay=${delayMs}:all=1,apad,atrim=duration=${duration}`,
		"-c:a",
		SEPARATE_TRACKS_WAV_CODEC,
		"-ar",
		String(SEPARATE_TRACKS_SAMPLE_RATE),
		options.outputPath,
	];
}

/** Where the main clip begins in the joined export: the intro minus its cross-fade. */
export function getMainClipOffsetSec(introSec: number, mainSec: number): number {
	if (!(introSec > 0)) return 0;
	return Math.max(0, introSec - getIntroOutroFadeSec(introSec, mainSec));
}

export async function generateSeparateTracks(options: {
	ffmpegPath: string;
	videoPath: string;
	/** WAV of the voice rendered on the edited timeline (no intro/outro). */
	voiceWavPath?: string | null;
	introSec: number;
}): Promise<SeparateTracksPaths & { hasFullAudio: boolean; hasVoice: boolean }> {
	const metadata = await probeNativeVideoMetadata(options.ffmpegPath, options.videoPath);
	if (!(metadata.duration > 0)) {
		throw new Error("Could not read the exported video");
	}

	const paths = getSeparateTracksPaths(options.videoPath);
	await fs.mkdir(paths.folder, { recursive: true });

	const run = (args: string[]) =>
		execFileAsync(options.ffmpegPath, args, {
			timeout: 10 * 60_000,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});

	await run(buildSilentVideoArgs({ inputPath: options.videoPath, outputPath: paths.video }));
	if (metadata.hasAudio) {
		await run(
			buildFullAudioWavArgs({ inputPath: options.videoPath, outputPath: paths.fullAudio }),
		);
	}

	let hasVoice = false;
	if (options.voiceWavPath) {
		const mainSec = await probeAudioDurationSec(options.ffmpegPath, options.voiceWavPath);
		await run(
			buildAlignedVoiceWavArgs({
				inputPath: options.voiceWavPath,
				outputPath: paths.voice,
				offsetSec: getMainClipOffsetSec(options.introSec, mainSec ?? metadata.duration),
				totalDurationSec: metadata.duration,
			}),
		);
		hasVoice = true;
	}

	return { ...paths, hasFullAudio: metadata.hasAudio, hasVoice };
}
