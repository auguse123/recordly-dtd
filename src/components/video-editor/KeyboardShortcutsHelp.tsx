import { Kbd } from "@heroui/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Question as HelpCircle, Gear as Settings2 } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { FIXED_SHORTCUTS, formatBinding, SHORTCUT_ACTIONS, SHORTCUT_LABELS } from "@/lib/shortcuts";
import { formatShortcut } from "@/utils/platformUtils";

/** Fixed editing keys worth listing next to the configurable ones. */
const EDITING_FIXED_KEYS = new Set([
	"splitClipAlt",
	"stepFrame",
	"stepSecond",
	"jumpToCut",
	"clearMarks",
]);

export function KeyboardShortcutsHelp() {
	const { shortcuts, isMac, openConfig } = useShortcuts();
	const t = useScopedT("editor");
	const tShortcuts = useScopedT("shortcuts");

	const [scrollLabels, setScrollLabels] = useState({
		pan: "Shift + Scroll",
		zoom: "Ctrl + Scroll",
	});

	useEffect(() => {
		Promise.all([formatShortcut(["shift", "Scroll"]), formatShortcut(["mod", "Scroll"])]).then(
			([pan, zoom]) => setScrollLabels({ pan, zoom }),
		);
	}, []);

	return (
		<Popover>
			<PopoverTrigger>
				<Button variant="ghost" size="icon" aria-label={t("keyboardShortcuts.title")}>
					<HelpCircle />
				</Button>
			</PopoverTrigger>

			<PopoverContent align="end" className="w-80" aria-label={t("keyboardShortcuts.title")}>
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-semibold text-foreground">
						{t("keyboardShortcuts.title")}
					</span>
					<Button
						variant="ghost"
						type="button"
						onClick={openConfig}
						title={t("keyboardShortcuts.customizeTooltip")}
						className="flex items-center gap-1"
					>
						<Settings2 className="w-3 h-3" />
						{t("keyboardShortcuts.customize")}
					</Button>
				</div>

				<div className="space-y-1.5 text-[10px]">
					{SHORTCUT_ACTIONS.map((action) => (
						<div key={action} className="flex items-center justify-between">
							<span className="text-muted-foreground">
								{tShortcuts(`actions.${action}`, SHORTCUT_LABELS[action])}
							</span>
							<Kbd>{formatBinding(shortcuts[action], isMac)}</Kbd>
						</div>
					))}
					{FIXED_SHORTCUTS.filter(
						({ labelKey }) => labelKey && EDITING_FIXED_KEYS.has(labelKey),
					).map(({ label, labelKey, display }) => (
						<div key={label} className="flex items-center justify-between">
							<span className="text-muted-foreground">
								{tShortcuts(`actions.${labelKey}`, label)}
							</span>
							<Kbd>{display}</Kbd>
						</div>
					))}

					<div className="pt-1 border-t border-foreground/5 mt-1">
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.panTimeline")}
							</span>
							<Kbd>{scrollLabels.pan}</Kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.zoomTimeline")}
							</span>
							<Kbd>{scrollLabels.zoom}</Kbd>
						</div>
						<div className="flex items-center justify-between mt-1.5">
							<span className="text-muted-foreground">
								{t("keyboardShortcuts.cycleAnnotations")}
							</span>
							<Kbd>{t("keyboardShortcuts.tab")}</Kbd>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
