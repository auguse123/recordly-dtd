import { memo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** One frame at 30 fps, the finest step the nudge buttons offer. */
export const SYNC_OFFSET_FRAME_MS = 1000 / 30;
export const MAX_SYNC_OFFSET_MS = 10 * 60 * 1000;

export function clampSyncOffsetMs(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(Math.max(-MAX_SYNC_OFFSET_MS, Math.min(MAX_SYNC_OFFSET_MS, value)));
}

export function formatSyncOffsetSeconds(valueMs: number): string {
	const seconds = valueMs / 1000;
	const text = seconds.toFixed(3).replace(/\.?0+$/, "");
	return seconds > 0 ? `+${text}` : text;
}

/** Parses "1.5", "-0,25" or "+2" (seconds); null when it is not a number. */
export function parseSyncOffsetSeconds(text: string): number | null {
	const normalized = text.trim().replace(",", ".").replace(/s$/i, "").trim();
	if (!normalized) return null;
	const seconds = Number(normalized);
	return Number.isFinite(seconds) ? clampSyncOffsetMs(seconds * 1000) : null;
}

const NUDGES: Array<{ label: string; deltaMs: number }> = [
	{ label: "−1 s", deltaMs: -1000 },
	{ label: "−0.1", deltaMs: -100 },
	{ label: "−1 img", deltaMs: -SYNC_OFFSET_FRAME_MS },
	{ label: "+1 img", deltaMs: SYNC_OFFSET_FRAME_MS },
	{ label: "+0.1", deltaMs: 100 },
	{ label: "+1 s", deltaMs: 1000 },
];

interface SyncOffsetControlProps {
	label: string;
	hint: string;
	resetLabel: string;
	valueMs: number;
	onChange: (valueMs: number) => void;
}

/** Signed time offset in seconds with frame-accurate nudges, for fixing A/V sync by hand. */
export const SyncOffsetControl = memo(function SyncOffsetControl({
	label,
	hint,
	resetLabel,
	valueMs,
	onChange,
}: SyncOffsetControlProps) {
	const [draft, setDraft] = useState(() => formatSyncOffsetSeconds(valueMs));
	useEffect(() => setDraft(formatSyncOffsetSeconds(valueMs)), [valueMs]);

	const commitDraft = () => {
		const parsed = parseSyncOffsetSeconds(draft);
		if (parsed === null) {
			setDraft(formatSyncOffsetSeconds(valueMs));
			return;
		}
		if (parsed !== valueMs) onChange(parsed);
		else setDraft(formatSyncOffsetSeconds(valueMs));
	};

	return (
		<div className="flex flex-col gap-2 py-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">{label}</span>
				<div className="flex items-center gap-1">
					<input
						type="text"
						inputMode="decimal"
						aria-label={label}
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commitDraft}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commitDraft();
							} else if (event.key === "Escape") {
								event.preventDefault();
								setDraft(formatSyncOffsetSeconds(valueMs));
							}
							event.stopPropagation();
						}}
						className="h-7 w-20 rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 text-right text-xs tabular-nums text-foreground outline-none focus:border-accent"
					/>
					<span className="text-xs text-muted-foreground">s</span>
				</div>
			</div>
			<div className="grid grid-cols-6 gap-1">
				{NUDGES.map((nudge) => (
					<Button
						key={nudge.label}
						type="button"
						variant="outline"
						size="sm"
						className="h-7 min-w-0 px-0 text-[10px] tabular-nums"
						onClick={() => onChange(clampSyncOffsetMs(valueMs + nudge.deltaMs))}
					>
						{nudge.label}
					</Button>
				))}
			</div>
			<div className="flex items-center justify-between gap-2">
				<p className="text-[11px] leading-snug text-muted-foreground/70">{hint}</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 shrink-0 text-xs"
					isDisabled={valueMs === 0}
					onClick={() => onChange(0)}
				>
					{resetLabel}
				</Button>
			</div>
		</div>
	);
});
