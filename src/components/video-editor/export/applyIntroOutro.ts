import { toast } from "@/components/ui/toast";
import type { ExportResult } from "@/lib/exporter/types";
import { renderIntroOutroCardPng } from "@/lib/introOutroCard";
import {
	hasEnabledIntroOutro,
	type IntroOutroCard,
	type IntroOutroSettings,
	isIntroOutroCardActive,
	isIntroOutroVideo,
} from "../introOutro";
import { streamExportBlobToTempFile } from "./exportPersistence";

type SegmentPayload =
	| { kind: "still"; png: Uint8Array; durationSec: number }
	| { kind: "video"; mediaPath: string };

async function buildSegment(
	card: IntroOutroCard,
	width: number,
	height: number,
): Promise<SegmentPayload | undefined> {
	if (!isIntroOutroCardActive(card)) return undefined;
	if (isIntroOutroVideo(card) && card.media) {
		return { kind: "video", mediaPath: card.media.path };
	}
	return {
		kind: "still",
		png: await renderIntroOutroCardPng(width, height, card),
		durationSec: card.durationSec,
	};
}

/**
 * Wraps a finished MP4 export with the intro/outro cards. On failure the
 * original export is kept (main only deletes it once the joined file exists).
 */
export async function applyIntroOutroToExport(
	result: ExportResult,
	settings: IntroOutroSettings,
	width: number,
	height: number,
): Promise<ExportResult> {
	if (
		!result.success ||
		!hasEnabledIntroOutro(settings) ||
		!window.electronAPI?.applyIntroOutro
	) {
		return result;
	}
	const tempPath =
		result.tempFilePath ??
		(result.blob ? await streamExportBlobToTempFile(result.blob, "mp4") : null);
	if (!tempPath) {
		return result;
	}
	const baseResult: ExportResult = { ...result, tempFilePath: tempPath, blob: undefined };

	try {
		const [intro, outro] = await Promise.all([
			buildSegment(settings.intro, width, height),
			buildSegment(settings.outro, width, height),
		]);
		const joined = await window.electronAPI.applyIntroOutro({ tempPath, intro, outro });
		if (!joined.success || !joined.tempPath) {
			throw new Error(joined.error || "Intro/outro failed");
		}
		return { ...baseResult, tempFilePath: joined.tempPath };
	} catch (error) {
		console.error("[intro-outro]", error);
		toast.error("Début/fin non ajoutés : la vidéo est exportée sans.");
		return baseResult;
	}
}
