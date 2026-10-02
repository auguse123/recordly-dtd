import { useTimelineContext } from "dnd-timeline";
import type { TimelineMarks } from "../../../editTools";
import { type ClipPresentation, getPlayheadDisplayTime } from "../../core/clipPresentation";

interface TimelineMarksOverlayProps {
	marks?: TimelineMarks;
	clips: ClipPresentation[];
	videoDurationMs: number;
}

/** In/out marks: a tinted band over the marked range plus an edge line per mark. */
export default function TimelineMarksOverlay({
	marks,
	clips,
	videoDurationMs,
}: TimelineMarksOverlayProps) {
	const { sidebarWidth, direction, range, valueToPixels } = useTimelineContext();
	if (!marks || (marks.inMs === null && marks.outMs === null) || videoDurationMs <= 0) {
		return null;
	}
	const sideProperty = direction === "rtl" ? "right" : "left";
	const toPixels = (ms: number, edge: "start" | "end") =>
		sidebarWidth +
		valueToPixels(
			getPlayheadDisplayTime(Math.min(Math.max(ms, 0), videoDurationMs), clips, edge) -
				range.start,
		);
	const startPx = toPixels(marks.inMs ?? 0, "start");
	const endPx = toPixels(marks.outMs ?? videoDurationMs, "end");
	const viewStartPx = sidebarWidth;
	const viewEndPx = sidebarWidth + valueToPixels(range.end - range.start);
	const bandStart = Math.max(startPx, viewStartPx);
	const bandEnd = Math.min(endPx, viewEndPx);
	const isVisible = (px: number) => px >= viewStartPx && px <= viewEndPx;

	return (
		<div data-testid="timeline-marks" className="absolute inset-0 z-[44] pointer-events-none">
			{bandEnd > bandStart ? (
				<div
					className="absolute top-0 bottom-0 bg-sky-400/15"
					style={{ [sideProperty]: bandStart, width: bandEnd - bandStart }}
				/>
			) : null}
			{marks.inMs !== null && isVisible(startPx) ? (
				<div
					className="absolute top-0 bottom-0 w-px bg-sky-400"
					style={{ [sideProperty]: startPx }}
				>
					<span className="absolute top-0 left-0.5 rounded-sm bg-sky-400 px-0.5 text-[9px] font-semibold leading-3 text-black">
						I
					</span>
				</div>
			) : null}
			{marks.outMs !== null && isVisible(endPx) ? (
				<div
					className="absolute top-0 bottom-0 w-px bg-sky-400"
					style={{ [sideProperty]: endPx }}
				>
					<span className="absolute top-0 right-0.5 rounded-sm bg-sky-400 px-0.5 text-[9px] font-semibold leading-3 text-black">
						O
					</span>
				</div>
			) : null}
		</div>
	);
}
