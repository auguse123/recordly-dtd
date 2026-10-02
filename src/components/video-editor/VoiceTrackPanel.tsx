import { Label } from "@heroui/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";

type Busy = "export" | "import" | "restore" | null;

function formatDuration(sec: number): string {
	const total = Math.round(sec);
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Round-trip the microphone track through an external audio tool: export the
 * untouched full-length voice as WAV, then import the processed file in place
 * of the mic sidecar (same length, so sync and every edit stay valid).
 */
export function VoiceTrackPanel({
	micPath,
	onVoiceChanged,
}: {
	micPath: string | null;
	onVoiceChanged: () => void;
}) {
	const t = useScopedT("settings");
	const [busy, setBusy] = useState<Busy>(null);
	const [hasImported, setHasImported] = useState(false);
	const [durationSec, setDurationSec] = useState<number | null>(null);
	const [infoVersion, setInfoVersion] = useState(0);

	useEffect(() => {
		// Re-read after each import/restore; infoVersion is the trigger.
		void infoVersion;
		if (!micPath) return;
		let cancelled = false;
		void window.electronAPI.getVoiceTrackInfo(micPath).then((info) => {
			if (cancelled || !info.success) return;
			setHasImported(Boolean(info.hasImported));
			setDurationSec(info.durationSec ?? null);
		});
		return () => {
			cancelled = true;
		};
	}, [micPath, infoVersion]);

	if (!micPath) {
		return (
			<section className="flex flex-col gap-3">
				<Label className="text-[13px]">{t("voice.heading", "Voice")}</Label>
				<p className="text-xs text-muted-foreground">
					{t(
						"voice.noTrack",
						"This recording has no separate microphone track. Record with the microphone on to use these tools.",
					)}
				</p>
			</section>
		);
	}

	const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
		setBusy(kind);
		try {
			await action();
		} catch (error) {
			console.error(`Voice ${kind} failed:`, error);
			toast.error(t("voice.failed", "Something went wrong with the voice track."));
		} finally {
			setBusy(null);
		}
	};

	const handleExport = () =>
		run("export", async () => {
			const result = await window.electronAPI.exportRawVoice(micPath);
			if (result.canceled) return;
			if (result.success) {
				toast.success(t("voice.exported", "Raw voice exported (WAV)."));
			} else {
				toast.error(
					result.error || t("voice.failed", "Something went wrong with the voice track."),
				);
			}
		});

	const handleImport = () =>
		run("import", async () => {
			const result = await window.electronAPI.importProcessedVoice(micPath);
			if (result.canceled) return;
			if (result.success) {
				toast.success(
					t(
						"voice.imported",
						"Processed voice imported. The preview and exports now use it.",
					),
				);
				setInfoVersion((version) => version + 1);
				onVoiceChanged();
			} else if (result.durationMismatch) {
				toast.error(
					t(
						"voice.durationMismatch",
						"This file lasts {{actual}} but the recording lasts {{expected}}. Process the full raw voice exported here, without cutting it.",
						{
							actual: formatDuration(result.durationMismatch.actualSec),
							expected: formatDuration(result.durationMismatch.expectedSec),
						},
					),
				);
			} else {
				toast.error(
					result.error || t("voice.failed", "Something went wrong with the voice track."),
				);
			}
		});

	const handleRestore = () =>
		run("restore", async () => {
			const result = await window.electronAPI.restoreVoiceBeforeImport(micPath);
			if (result.success) {
				toast.success(t("voice.restored", "Previous voice restored."));
				setInfoVersion((version) => version + 1);
				onVoiceChanged();
			} else {
				toast.error(
					result.error || t("voice.failed", "Something went wrong with the voice track."),
				);
			}
		});

	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-col gap-1.5">
				<Label className="text-[13px]">{t("voice.heading", "Voice")}</Label>
				<p className="text-xs text-muted-foreground">
					{t(
						"voice.intro",
						"Process the voice in another tool (Audition, Adobe Podcast, iZotope…), then bring it back. Cuts and sync are kept.",
					)}
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<Label className="text-[13px]">{t("voice.step1", "1. Export the raw voice")}</Label>
				<p className="text-xs text-muted-foreground">
					{durationSec
						? t(
								"voice.exportHintDuration",
								"Full recording ({{duration}}), before clean-up, as WAV.",
								{ duration: formatDuration(durationSec) },
							)
						: t("voice.exportHint", "Full recording, before clean-up, as WAV.")}
				</p>
				<Button
					type="button"
					variant="secondary"
					disabled={busy !== null}
					onClick={handleExport}
					className="h-8 w-full text-xs"
				>
					{busy === "export"
						? t("voice.exporting", "Exporting…")
						: t("voice.export", "Export raw voice (WAV)")}
				</Button>
			</div>

			<div className="flex flex-col gap-2">
				<Label className="text-[13px]">
					{t("voice.step2", "2. Import the processed voice")}
				</Label>
				<p className="text-xs text-muted-foreground">
					{t(
						"voice.importHint",
						"Same length as the exported file. It replaces the voice for every project using this recording.",
					)}
				</p>
				<Button
					type="button"
					variant="secondary"
					disabled={busy !== null}
					onClick={handleImport}
					className="h-8 w-full text-xs"
				>
					{busy === "import"
						? t("voice.importing", "Importing…")
						: t("voice.import", "Import processed voice…")}
				</Button>
				{hasImported ? (
					<Button
						type="button"
						variant="ghost"
						disabled={busy !== null}
						onClick={handleRestore}
						className="h-8 w-full text-xs"
					>
						{busy === "restore"
							? t("voice.restoring", "Restoring…")
							: t("voice.restore", "Back to the previous voice")}
					</Button>
				) : null}
			</div>
		</section>
	);
}
