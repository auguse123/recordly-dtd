import { toast } from "@/components/ui/toast";
import type { ExportResult } from "@/lib/exporter/types";
import { renderIntroOutroCardPng } from "@/lib/introOutroCard";
import { hasEnabledIntroOutro, type IntroOutroSettings } from "../introOutro";
import { streamExportBlobToTempFile } from "./exportPersistence";

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
		const [introPng, outroPng] = await Promise.all([
			settings.intro.enabled
				? renderIntroOutroCardPng(width, height, settings, settings.intro)
				: null,
			settings.outro.enabled
				? renderIntroOutroCardPng(width, height, settings, settings.outro)
				: null,
		]);
		const joined = await window.electronAPI.applyIntroOutro({
			tempPath,
			introPng,
			outroPng,
			durationSec: settings.durationSec,
		});
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
