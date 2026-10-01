import { Label } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorControl } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import { drawIntroOutroCard, prepareIntroOutroAssets } from "@/lib/introOutroCard";
import { getRequestedIntroOutroSide, INTRO_OUTRO_FOCUS_EVENT } from "./hooks/useIntroOutroPreview";
import {
	DEFAULT_INTRO_OUTRO_SETTINGS,
	INTRO_OUTRO_MAX_DURATION_SEC,
	INTRO_OUTRO_MAX_LOGO_BYTES,
	INTRO_OUTRO_MIN_DURATION_SEC,
	type IntroOutroCard,
	type IntroOutroSettings,
	type IntroOutroSide,
	isIntroOutroVideo,
} from "./introOutro";
import { SliderControl } from "./SliderControl";

const BRAND_COLORS = ["#FFFFFF", "#07293C", "#2ACAA5", "#F4F7F8", "#000000"] as const;
const PREVIEW_WIDTH = 288;

function CardPreview({ card, aspectRatio }: { card: IntroOutroCard; aspectRatio: number }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [videoSrc, setVideoSrc] = useState<string | null>(null);
	const height = Math.round(PREVIEW_WIDTH / Math.min(Math.max(aspectRatio, 0.4), 3));
	const isVideo = isIntroOutroVideo(card);
	const videoPath = isVideo ? (card.media?.path ?? null) : null;

	useEffect(() => {
		if (!videoPath) {
			setVideoSrc(null);
			return;
		}
		let cancelled = false;
		void resolveMediaElementSource(videoPath).then(({ src }) => {
			if (!cancelled) setVideoSrc(src);
		});
		return () => {
			cancelled = true;
		};
	}, [videoPath]);

	useEffect(() => {
		if (isVideo) return;
		let cancelled = false;
		void prepareIntroOutroAssets(card).then((assets) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext("2d");
			if (cancelled || !canvas || !ctx) return;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = PREVIEW_WIDTH * dpr;
			canvas.height = height * dpr;
			drawIntroOutroCard(ctx, canvas.width, canvas.height, card, assets);
		});
		return () => {
			cancelled = true;
		};
	}, [card, height, isVideo]);

	const className = "max-w-full self-center rounded-md border border-foreground/10";
	if (isVideo) {
		return (
			<video
				src={videoSrc ?? undefined}
				style={{ width: PREVIEW_WIDTH, height, backgroundColor: card.backgroundColor }}
				className={`${className} object-contain`}
				controls
				playsInline
			/>
		);
	}
	return (
		<canvas ref={canvasRef} style={{ width: PREVIEW_WIDTH, height }} className={className} />
	);
}

export function IntroOutroSettingsPanel({
	settings,
	onChange,
	aspectRatio,
}: {
	settings: IntroOutroSettings;
	onChange: (settings: IntroOutroSettings) => void;
	aspectRatio: number;
}) {
	const t = useScopedT("settings");
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [side, setSide] = useState<IntroOutroSide>(getRequestedIntroOutroSide);
	const [importing, setImporting] = useState(false);

	useEffect(() => {
		const handleFocus = (event: Event) => {
			const detail = (event as CustomEvent<IntroOutroSide>).detail;
			if (detail === "intro" || detail === "outro") setSide(detail);
		};
		window.addEventListener(INTRO_OUTRO_FOCUS_EVENT, handleFocus);
		return () => window.removeEventListener(INTRO_OUTRO_FOCUS_EVENT, handleFocus);
	}, []);
	const card = settings[side];

	const updateCard = (patch: Partial<IntroOutroCard>) =>
		onChange({ ...settings, [side]: { ...settings[side], ...patch } });

	const handleLogoFile = (file: File | undefined) => {
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			toast.error(t("introOutro.logoInvalid", "Choose an image file (PNG, SVG, JPG)."));
			return;
		}
		if (file.size > INTRO_OUTRO_MAX_LOGO_BYTES) {
			toast.error(t("introOutro.logoTooLarge", "Logo must be under 2 MB."));
			return;
		}
		const target = side;
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				onChange({
					...settings,
					[target]: { ...settings[target], logoDataUrl: reader.result, showLogo: true },
				});
			}
		};
		reader.readAsDataURL(file);
	};

	const handleChooseMedia = async () => {
		if (!window.electronAPI?.importIntroOutroMedia || importing) return;
		const target = side;
		setImporting(true);
		try {
			const result = await window.electronAPI.importIntroOutroMedia();
			if (result.canceled) return;
			if (!result.success || !result.media) {
				toast.error(
					result.error ||
						t(
							"introOutro.mediaFailed",
							"This file could not be used as an intro/outro.",
						),
				);
				return;
			}
			onChange({
				...settings,
				[target]: {
					...settings[target],
					enabled: true,
					source: "media",
					media: result.media,
				},
			});
		} finally {
			setImporting(false);
		}
	};

	const sideLabel = (key: IntroOutroSide) =>
		key === "intro" ? t("introOutro.intro", "Intro") : t("introOutro.outro", "Outro");

	const durationSlider = (
		<SliderControl
			label={t("introOutro.duration", "Duration")}
			value={card.durationSec}
			min={INTRO_OUTRO_MIN_DURATION_SEC}
			max={INTRO_OUTRO_MAX_DURATION_SEC}
			step={0.5}
			onChange={(durationSec) => updateCard({ durationSec })}
			formatValue={(v) => `${v.toFixed(1)} s`}
		/>
	);

	const backgroundControl = (
		<ColorControl
			compact
			label={t("introOutro.background", "Background")}
			value={card.backgroundColor}
			colors={BRAND_COLORS}
			onChange={(backgroundColor) => updateCard({ backgroundColor })}
		/>
	);

	const renderCardFields = () => (
		<>
			<div className="flex flex-col gap-2">
				<Input
					aria-label={t("introOutro.title", "Title")}
					placeholder={t("introOutro.title", "Title")}
					value={card.title}
					maxLength={120}
					onChange={(e) => updateCard({ title: e.target.value })}
				/>
				<Input
					aria-label={t("introOutro.subtitle", "Subtitle")}
					placeholder={t("introOutro.subtitle", "Subtitle")}
					value={card.subtitle}
					maxLength={160}
					onChange={(e) => updateCard({ subtitle: e.target.value })}
				/>
			</div>

			{durationSlider}

			<div className="flex flex-col gap-2.5">
				<div className="flex items-center justify-between gap-3">
					<Label className="text-[13px]">{t("introOutro.logo", "Logo")}</Label>
					<Switch
						aria-label={t("introOutro.logo", "Logo")}
						checked={card.showLogo}
						onCheckedChange={(showLogo) => updateCard({ showLogo })}
					/>
				</div>
				{card.showLogo && (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							type="button"
							onClick={() => fileInputRef.current?.click()}
						>
							{t("introOutro.uploadLogo", "Upload logo")}
						</Button>
						{card.logoDataUrl && (
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onClick={() => updateCard({ logoDataUrl: null })}
							>
								{t("introOutro.defaultLogo", "Use Desk to Desk logo")}
							</Button>
						)}
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<Label className="text-[13px]">{t("introOutro.colors", "Colors")}</Label>
				<div className="grid grid-cols-3 gap-2">
					{backgroundControl}
					<ColorControl
						compact
						label={t("introOutro.text", "Text")}
						value={card.textColor}
						colors={BRAND_COLORS}
						onChange={(textColor) => updateCard({ textColor })}
					/>
					<ColorControl
						compact
						label={t("introOutro.accent", "Accent")}
						value={card.accentColor}
						colors={BRAND_COLORS}
						onChange={(accentColor) => updateCard({ accentColor })}
					/>
				</div>
			</div>
		</>
	);

	const renderMediaFields = () => {
		const media = card.media;
		return (
			<>
				<div className="flex flex-col gap-1.5">
					<Button
						variant="secondary"
						size="sm"
						type="button"
						disabled={importing}
						onClick={() => void handleChooseMedia()}
					>
						{media
							? t("introOutro.replaceMedia", "Replace image or video")
							: t("introOutro.chooseMedia", "Choose image or video")}
					</Button>
					{media && (
						<p className="truncate text-xs text-muted-foreground" title={media.name}>
							{media.type === "video"
								? t("introOutro.mediaVideo", "Video · {{seconds}} s", {
										seconds: (media.durationSec ?? 0).toFixed(1),
									})
								: t("introOutro.mediaImage", "Image")}
							{" — "}
							{media.name}
						</p>
					)}
					{media?.type === "video" && (
						<p className="text-xs text-muted-foreground">
							{t(
								"introOutro.mediaVideoHint",
								"Videos play at their own length, with their sound.",
							)}
						</p>
					)}
				</div>
				{media?.type === "image" && durationSlider}
				{media && <div className="grid grid-cols-3 gap-2">{backgroundControl}</div>}
			</>
		);
	};

	return (
		<section className="flex flex-col gap-5">
			<div className="flex items-center justify-between gap-3">
				<Label className="text-[13px]">{t("introOutro.heading", "Intro / Outro")}</Label>
				<Button
					variant="ghost"
					size="sm"
					className="text-xs text-muted"
					type="button"
					onClick={() =>
						onChange({ ...settings, [side]: DEFAULT_INTRO_OUTRO_SETTINGS[side] })
					}
				>
					{t("introOutro.reset", "Reset")}
				</Button>
			</div>
			<p className="-mt-3 text-xs text-muted-foreground">
				{t(
					"introOutro.hint",
					"Shown before and after the video, with a short fade. Each side has its own settings.",
				)}
			</p>

			<div className="flex gap-1 self-center rounded-lg bg-foreground/[0.04] p-0.5">
				{(["intro", "outro"] as const).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setSide(key)}
						className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${
							side === key
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground"
						}`}
					>
						{sideLabel(key)}
						<span
							className={`h-1.5 w-1.5 rounded-full ${
								settings[key].enabled ? "bg-[#2ACAA5]" : "bg-foreground/20"
							}`}
						/>
					</button>
				))}
			</div>

			<div className="flex items-center justify-between gap-3">
				<Label className="text-[13px]">
					{side === "intro"
						? t("introOutro.enableIntro", "Add an intro")
						: t("introOutro.enableOutro", "Add an outro")}
				</Label>
				<Switch
					aria-label={sideLabel(side)}
					checked={card.enabled}
					onCheckedChange={(enabled) => updateCard({ enabled })}
				/>
			</div>

			{card.enabled && (
				<>
					<div className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/[0.04] p-0.5">
						{(["card", "media"] as const).map((source) => (
							<button
								key={source}
								type="button"
								onClick={() => updateCard({ source })}
								className={`rounded-md px-2 py-1 text-xs ${
									card.source === source
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground"
								}`}
							>
								{source === "card"
									? t("introOutro.sourceCard", "Title card")
									: t("introOutro.sourceMedia", "Image or video")}
							</button>
						))}
					</div>

					{(card.source === "card" || card.media) && (
						<CardPreview card={card} aspectRatio={aspectRatio} />
					)}

					{card.source === "card" ? renderCardFields() : renderMediaFields()}
				</>
			)}

			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/svg+xml,image/webp"
				className="hidden"
				onChange={(e) => {
					handleLogoFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
		</section>
	);
}
