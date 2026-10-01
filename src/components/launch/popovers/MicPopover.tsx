import { MagicWand, MicrophoneSlashIcon, SpeakerHighIcon, SpeakerXIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import { DropdownItem, HudPopover, MicDeviceRow } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { type ReactElement, useEffect, useState } from "react";
import styles from "../LaunchWindow.module.css";

const POPOVER_ID = "mic";

export function MicPopover({
	trigger,
	disabled,
	systemAudioEnabled,
	onToggleSystemAudio,
	microphoneEnabled,
	onDisableMicrophone,
	devices,
	microphoneDeviceId,
	selectedDeviceId,
	onSelectDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	systemAudioEnabled: boolean;
	onToggleSystemAudio: () => void;
	microphoneEnabled: boolean;
	onDisableMicrophone: () => void;
	devices: DeviceOption[];
	microphoneDeviceId?: string;
	selectedDeviceId?: string;
	onSelectDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);
	const [voiceDenoiseEnabled, setVoiceDenoiseEnabled] = useState(true);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void window.electronAPI.getRecordingPreferences().then((prefs) => {
			if (!cancelled) setVoiceDenoiseEnabled(prefs.voiceDenoiseEnabled !== false);
		});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const toggleVoiceDenoise = () => {
		const next = !voiceDenoiseEnabled;
		setVoiceDenoiseEnabled(next);
		void window.electronAPI.setRecordingPreferences({ voiceDenoiseEnabled: next });
	};

	return (
		<HudPopover
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabled) {
					return;
				}
				requestOpen(POPOVER_ID);
			}}
			trigger={trigger}
			align="start"
		>
			<div className={styles.ddLabel}>{t("recording.microphone")}</div>
			<DropdownItem
				icon={
					systemAudioEnabled ? <SpeakerHighIcon size={16} /> : <SpeakerXIcon size={16} />
				}
				selected={systemAudioEnabled}
				onClick={onToggleSystemAudio}
			>
				{systemAudioEnabled
					? t("recording.disableSystemAudio")
					: t("recording.enableSystemAudio")}
			</DropdownItem>
			<DropdownItem
				icon={<MagicWand size={16} />}
				selected={voiceDenoiseEnabled}
				onClick={toggleVoiceDenoise}
			>
				{t("recording.voiceDenoise")}
			</DropdownItem>
			{microphoneEnabled && (
				<DropdownItem
					icon={<MicrophoneSlashIcon size={16} />}
					onClick={() => {
						onDisableMicrophone();
						requestClose(POPOVER_ID);
					}}
				>
					{t("recording.turnOffMicrophone")}
				</DropdownItem>
			)}
			{!microphoneEnabled && (
				<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
					{t("recording.selectMicToEnable")}
				</div>
			)}
			{devices.map((device) => (
				<MicDeviceRow
					key={device.deviceId}
					device={device}
					selected={
						microphoneEnabled &&
						(microphoneDeviceId === device.deviceId ||
							selectedDeviceId === device.deviceId)
					}
					onSelect={() => onSelectDevice(device.deviceId)}
				/>
			))}
			{devices.length === 0 && (
				<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
					{t("recording.noMicrophonesFound")}
				</div>
			)}
		</HudPopover>
	);
}
