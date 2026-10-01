import { Play, Plus } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { EditorPlayback } from "../hooks/useIntroOutroPreview";
import { type IntroOutroSide, isIntroOutroCardActive } from "../introOutro";

/**
 * Bookend shown before/after the timeline: the intro and outro sit outside the
 * recording's own time range, so they get their own blocks rather than clips.
 */
export function IntroOutroTimelineBlock({
	side,
	introOutro,
	onOpenSettings,
}: {
	side: IntroOutroSide;
	introOutro: EditorPlayback["introOutro"];
	onOpenSettings: (side: IntroOutroSide) => void;
}) {
	const t = useScopedT("settings");
	const card = introOutro.settings[side];
	const active = isIntroOutroCardActive(card);
	const durationSec = side === "intro" ? introOutro.introSec : introOutro.outroSec;
	const label =
		side === "intro"
			? t("introOutro.timelineIntro", "Intro")
			: t("introOutro.timelineOutro", "Outro");
	const phase = introOutro.phase?.side === side ? introOutro.phase : null;
	const progress = phase && durationSec > 0 ? Math.min(1, phase.timeSec / durationSec) : 0;

	if (!active) {
		return (
			<button
				type="button"
				onClick={() => onOpenSettings(side)}
				title={label}
				className="flex w-16 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/15 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
			>
				<span>{label}</span>
				<span className="flex items-center gap-0.5">
					<Plus className="h-3 w-3" />
					{t("introOutro.timelineAdd", "Add")}
				</span>
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={() => {
				onOpenSettings(side);
				introOutro.playSide(side);
			}}
			title={label}
			className={`group relative flex w-16 flex-shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border text-[11px] transition-colors ${
				phase ? "border-[#2ACAA5]" : "border-foreground/15 hover:border-foreground/30"
			}`}
		>
			<span
				className="absolute inset-x-0 top-0 h-1.5"
				style={{ backgroundColor: card.backgroundColor }}
			/>
			<span className="font-medium text-foreground">{label}</span>
			<span className="flex items-center gap-0.5 text-muted-foreground">
				<Play className="h-2.5 w-2.5" />
				{durationSec > 0 ? `${durationSec.toFixed(1)} s` : "—"}
			</span>
			{phase && (
				<span
					className="absolute bottom-0 left-0 h-0.5 bg-[#2ACAA5]"
					style={{ width: `${progress * 100}%` }}
				/>
			)}
		</button>
	);
}
