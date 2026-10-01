import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";

// Intro/outro images and clips are copied into an app-owned folder so the
// project keeps working if the original file moves, and so the media server
// can serve them without per-session path approvals.

export const INTRO_OUTRO_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
export const INTRO_OUTRO_VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"] as const;
export const INTRO_OUTRO_MAX_MEDIA_BYTES = 500 * 1024 * 1024;
export const INTRO_OUTRO_MAX_VIDEO_SEC = 120;

export type IntroOutroMediaType = "image" | "video";

export interface IntroOutroMediaInfo {
	path: string;
	type: IntroOutroMediaType;
	name: string;
	durationSec: number | null;
	hasAudio: boolean;
}

export function getIntroOutroMediaType(filePath: string): IntroOutroMediaType | null {
	const ext = path.extname(filePath).slice(1).toLowerCase();
	if ((INTRO_OUTRO_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
	if ((INTRO_OUTRO_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
	return null;
}

export function isInsideDirectory(filePath: string, directory: string): boolean {
	const relative = path.relative(path.resolve(directory), path.resolve(filePath));
	return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Resolves a stored media path, accepting only files inside the owned folder. */
export async function resolveOwnedIntroOutroMedia(
	mediaDir: string,
	filePath: unknown,
): Promise<string | null> {
	if (typeof filePath !== "string" || !filePath) return null;
	try {
		const [realDir, realFile] = await Promise.all([
			fs.realpath(mediaDir),
			fs.realpath(path.resolve(filePath)),
		]);
		if (!isInsideDirectory(realFile, realDir)) return null;
		if (!getIntroOutroMediaType(realFile)) return null;
		const stat = await fs.stat(realFile);
		return stat.isFile() ? realFile : null;
	} catch {
		return null;
	}
}

export async function probeIntroOutroVideo(ffmpegPath: string, filePath: string) {
	const metadata = await probeNativeVideoMetadata(ffmpegPath, filePath);
	if (!(metadata.duration > 0) || !(metadata.width > 0) || !(metadata.height > 0)) {
		throw new Error("Could not read this video");
	}
	return {
		durationSec: Math.min(INTRO_OUTRO_MAX_VIDEO_SEC, metadata.duration),
		hasAudio: metadata.hasAudio,
	};
}

/** Copies a user-picked image/clip into the owned folder (deduplicated by content stamp). */
export async function importIntroOutroMedia(options: {
	ffmpegPath: string;
	mediaDir: string;
	sourcePath: string;
}): Promise<IntroOutroMediaInfo> {
	const type = getIntroOutroMediaType(options.sourcePath);
	if (!type) throw new Error("Unsupported file type");
	const stat = await fs.stat(options.sourcePath);
	if (!stat.isFile()) throw new Error("Not a file");
	if (stat.size > INTRO_OUTRO_MAX_MEDIA_BYTES) throw new Error("File is larger than 500 MB");

	let durationSec: number | null = null;
	let hasAudio = false;
	if (type === "video") {
		const metadata = await probeNativeVideoMetadata(options.ffmpegPath, options.sourcePath);
		if (!(metadata.duration > 0) || !(metadata.width > 0)) {
			throw new Error("Could not read this video");
		}
		if (metadata.duration > INTRO_OUTRO_MAX_VIDEO_SEC + 0.5) {
			throw new Error(`Video is longer than ${INTRO_OUTRO_MAX_VIDEO_SEC} s`);
		}
		durationSec = metadata.duration;
		hasAudio = metadata.hasAudio;
	}

	const stamp = createHash("sha1")
		.update(`${path.resolve(options.sourcePath)}|${stat.size}|${stat.mtimeMs}`)
		.digest("hex")
		.slice(0, 16);
	const ext = path.extname(options.sourcePath).toLowerCase();
	await fs.mkdir(options.mediaDir, { recursive: true });
	const target = path.join(options.mediaDir, `${stamp}${ext}`);
	try {
		await fs.access(target);
	} catch {
		const partial = `${target}.part`;
		await fs.copyFile(options.sourcePath, partial);
		await fs.rename(partial, target);
	}

	return {
		path: await fs.realpath(target),
		type,
		name: path.basename(options.sourcePath),
		durationSec,
		hasAudio,
	};
}
