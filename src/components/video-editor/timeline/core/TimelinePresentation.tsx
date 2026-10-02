import { useTimelineContext } from "dnd-timeline";
import { createContext, type ReactNode, type RefObject, useContext, useMemo } from "react";
import type { DndEngineConfig } from "../dnd/engine";
import { type ClipPresentation, getClipDisplaySpan } from "./clipPresentation";
import { CLIP_ROW_ID } from "./constants";
import type { TimelineRegionSpan } from "./timelineTypes";

type PreviewConfig = Pick<
	DndEngineConfig,
	"totalMs" | "minItemDurationMs" | "allRegionSpans" | "hasOverlap"
>;
const Context = createContext<{
	clips: ClipPresentation[];
	regions: TimelineRegionSpan[];
	/** Playhead and in/out marks; a ref so blocks don't re-render every frame. */
	snapTimesRef?: RefObject<number[]>;
	previewConfig: PreviewConfig;
}>({
	clips: [],
	regions: [],
	previewConfig: {
		totalMs: 0,
		minItemDurationMs: 1,
		allRegionSpans: [],
		hasOverlap: () => false,
	},
});
export const useTimelinePresentation = () => useContext(Context);
export function TimelinePresentation({
	regions,
	children,
	totalMs,
	minItemDurationMs,
	hasOverlap,
	snapTimesRef,
}: {
	regions: TimelineRegionSpan[];
	children: ReactNode;
	snapTimesRef?: RefObject<number[]>;
} & Omit<PreviewConfig, "allRegionSpans">) {
	const { pixelsToValue } = useTimelineContext();
	const value = useMemo(() => {
		const spans = regions
			.filter((region) => region.rowId === CLIP_ROW_ID)
			.map(({ start, end }) => ({ start, end }));
		return {
			regions,
			snapTimesRef,
			previewConfig: { totalMs, minItemDurationMs, hasOverlap, allRegionSpans: regions },
			clips: spans.map((span) => ({
				span,
				displaySpan: getClipDisplaySpan(span, spans, pixelsToValue(1)),
			})),
		};
	}, [regions, snapTimesRef, pixelsToValue, totalMs, minItemDurationMs, hasOverlap]);
	return <Context.Provider value={value}>{children}</Context.Provider>;
}
