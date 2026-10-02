import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseFfmpegDurationSeconds } from "../ffmpeg/metadata";

const execFileAsync = promisify(execFile);

const MIC_SIDECAR_SUFFIX = ".mic.m4a";
const ORIGINAL_SUFFIX = ".original.mic.m4a";
const BEFORE_IMPORT_SUFFIX = ".before-import.mic.m4a";

/** A processed voice may drift slightly in length; anything more means a cut/trimmed file. */
export const VOICE_IMPORT_DURATION_TOLERANCE_SEC = 1;

export const VOICE_IMPORT_EXTENSIONS = [
	"wav",
	"aif",
	"aiff",
	"flac",
	"m4a",
	"mp3",
	"aac",
	"caf",
	"ogg",
];

export interface VoiceTrackPaths {
	/** The sidecar the editor plays (`<stem>.mic.m4a`). */
	mic: string;
	/** Untouched capture (`<stem>.original.mic.m4a`), written by the voice clean-up. */
	original: string;
	/** Copy of `mic` taken before the first import, used to revert. */
	beforeImport: string;
	/** Recording name without folder or sidecar suffix. */
	baseName: string;
}

/** Only the live mic sidecar qualifies, never one of our backups. */
export function isVoiceTrackSidecarPath(candidate: string): boolean {
	const lower = candidate.toLowerCase();
	return (
		lower.endsWith(MIC_SIDECAR_SUFFIX) &&
		!lower.endsWith(ORIGINAL_SUFFIX) &&
		!lower.endsWith(BEFORE_IMPORT_SUFFIX)
	);
}

export function getVoiceTrackPaths(micPath: string): VoiceTrackPaths {
	const stem = micPath.slice(0, -MIC_SIDECAR_SUFFIX.length);
	return {
		mic: micPath,
		original: `${stem}${ORIGINAL_SUFFIX}`,
		beforeImport: `${stem}${BEFORE_IMPORT_SUFFIX}`,
		baseName: path.basename(stem),
	};
}

export function parseAudioDurationOutput(output: string): number | null {
	const match = output.match(/Duration:\s*([0-9:.]+)/i);
	if (!match || !/\bAudio:/i.test(output)) return null;
	const duration = parseFfmpegDurationSeconds(match[1]);
	return duration && duration > 0 ? duration : null;
}

export async function probeAudioDurationSec(
	ffmpegPath: string,
	inputPath: string,
): Promise<number | null> {
	let output = "";
	try {
		const result = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", inputPath], {
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
		});
		output = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		// `ffmpeg -i` without an output always exits non-zero; the probe is in stderr.
		const processOutput = error as { stdout?: unknown; stderr?: unknown };
		output = [processOutput.stdout, processOutput.stderr]
			.filter((value): value is string => typeof value === "string")
			.join("\n");
	}
	return parseAudioDurationOutput(output);
}

/** Full-length capture as lossless WAV, for processing in an external tool. */
export function buildRawVoiceWavArgs(options: { inputPath: string; outputPath: string }): string[] {
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-i",
		options.inputPath,
		"-map",
		"0:a:0",
		"-vn",
		"-c:a",
		"pcm_s24le",
		"-ar",
		"48000",
		options.outputPath,
	];
}

/** Processed voice back into the sidecar format the editor and exporter read. */
export function buildImportedVoiceArgs(options: {
	inputPath: string;
	outputPath: string;
}): string[] {
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-i",
		options.inputPath,
		"-map",
		"0:a:0",
		"-vn",
		"-c:a",
		"aac",
		"-b:a",
		"256k",
		"-ar",
		"48000",
		"-f",
		"mp4",
		options.outputPath,
	];
}

/** Rename over `destination`, falling back to copy across volumes. */
async function replaceFile(sourcePath: string, destinationPath: string) {
	try {
		await fs.rename(sourcePath, destinationPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await fs.copyFile(sourcePath, destinationPath);
		await fs.unlink(sourcePath);
	}
}

export interface VoiceTrackInfo {
	micPath: string;
	/** Best untouched source: the original capture when the clean-up kept one. */
	rawPath: string;
	hasImported: boolean;
	durationSec: number | null;
}

export async function getVoiceTrackInfo(
	ffmpegPath: string,
	micPath: string,
): Promise<VoiceTrackInfo> {
	const paths = getVoiceTrackPaths(micPath);
	const rawPath = existsSync(paths.original) ? paths.original : paths.mic;
	return {
		micPath,
		rawPath,
		hasImported: existsSync(paths.beforeImport),
		durationSec: await probeAudioDurationSec(ffmpegPath, rawPath),
	};
}

async function runFfmpeg(ffmpegPath: string, args: string[]) {
	await execFileAsync(ffmpegPath, args, {
		timeout: 10 * 60_000,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
	});
}

export async function exportRawVoiceWav(options: {
	ffmpegPath: string;
	micPath: string;
	outputPath: string;
}): Promise<void> {
	const info = await getVoiceTrackInfo(options.ffmpegPath, options.micPath);
	await runFfmpeg(
		options.ffmpegPath,
		buildRawVoiceWavArgs({ inputPath: info.rawPath, outputPath: options.outputPath }),
	);
}

export class VoiceDurationMismatchError extends Error {
	constructor(
		readonly expectedSec: number,
		readonly actualSec: number,
	) {
		super(
			`Imported voice lasts ${actualSec.toFixed(1)}s but the recording lasts ${expectedSec.toFixed(1)}s`,
		);
		this.name = "VoiceDurationMismatchError";
	}
}

/**
 * Replace the mic sidecar with a processed version of the full-length raw voice.
 * The untouched capture and the pre-import sidecar are kept so the swap can be
 * undone; the `.mic.m4a.json` start-delay file is left alone so sync is kept.
 */
export async function importProcessedVoice(options: {
	ffmpegPath: string;
	micPath: string;
	sourcePath: string;
	workDir: string;
}): Promise<void> {
	const paths = getVoiceTrackPaths(options.micPath);
	const rawPath = existsSync(paths.original) ? paths.original : paths.mic;
	const [expectedSec, actualSec] = await Promise.all([
		probeAudioDurationSec(options.ffmpegPath, rawPath),
		probeAudioDurationSec(options.ffmpegPath, options.sourcePath),
	]);
	if (actualSec === null) {
		throw new Error("The chosen file has no readable audio");
	}
	if (
		expectedSec !== null &&
		Math.abs(expectedSec - actualSec) > VOICE_IMPORT_DURATION_TOLERANCE_SEC
	) {
		throw new VoiceDurationMismatchError(expectedSec, actualSec);
	}

	const convertedPath = path.join(options.workDir, "imported-voice.m4a");
	await runFfmpeg(
		options.ffmpegPath,
		buildImportedVoiceArgs({ inputPath: options.sourcePath, outputPath: convertedPath }),
	);

	if (!existsSync(paths.original)) {
		await fs.copyFile(paths.mic, paths.original);
	}
	if (!existsSync(paths.beforeImport)) {
		await fs.copyFile(paths.mic, paths.beforeImport);
	}
	await replaceFile(convertedPath, paths.mic);
}

/** Put back the sidecar that was in place before the first import. */
export async function restoreVoiceBeforeImport(micPath: string): Promise<void> {
	const paths = getVoiceTrackPaths(micPath);
	if (!existsSync(paths.beforeImport)) {
		throw new Error("No previous voice to restore");
	}
	await replaceFile(paths.beforeImport, paths.mic);
}
