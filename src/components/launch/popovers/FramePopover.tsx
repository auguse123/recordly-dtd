import type { ReactElement } from "react";
import { Crop } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "../LaunchWindow.module.css";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import { DropdownItem, HudPopover } from "./PopoverScaffold";

const POPOVER_ID = "frame";
export const CAPTURE_FRAME_OPTIONS = ["none", "16:9", "9:16", "1:1", "4:5"] as const;
export type CaptureFrameOption = (typeof CAPTURE_FRAME_OPTIONS)[number];

export function parseCaptureFrameOption(value: unknown): CaptureFrameOption {
	return CAPTURE_FRAME_OPTIONS.includes(value as CaptureFrameOption)
		? (value as CaptureFrameOption)
		: "none";
}

export function FramePopover({
	trigger,
	frameAspect,
	onSelectAspect,
}: {
	trigger: ReactElement;
	frameAspect: CaptureFrameOption;
	onSelectAspect: (aspect: CaptureFrameOption) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="center"
		>
			<div className={styles.ddLabel}>{t("recording.captureFrame")}</div>
			{CAPTURE_FRAME_OPTIONS.map((aspect) => (
				<DropdownItem
					key={aspect}
					icon={<Crop size={16} />}
					selected={frameAspect === aspect}
					onClick={() => {
						onSelectAspect(aspect);
						requestClose(POPOVER_ID);
					}}
				>
					{aspect === "none" ? t("recording.captureFrameNone") : aspect}
				</DropdownItem>
			))}
			<div className="max-w-[200px] px-[10px] pb-1.5 pt-1 text-[10px] text-[var(--launch-label)]">
				{t("recording.captureFrameScreenOnly")}
			</div>
		</HudPopover>
	);
}
