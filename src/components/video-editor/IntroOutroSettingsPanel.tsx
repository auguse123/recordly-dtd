import { Label } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorControl } from "@/components/ui/color-picker";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import { drawIntroOutroCard, prepareIntroOutroAssets } from "@/lib/introOutroCard";
import {
	DEFAULT_INTRO_OUTRO_SETTINGS,
	INTRO_OUTRO_MAX_DURATION_SEC,
	INTRO_OUTRO_MAX_LOGO_BYTES,
	INTRO_OUTRO_MIN_DURATION_SEC,
	type IntroOutroCard,
	type IntroOutroSettings,
} from "./introOutro";
import { SliderControl } from "./SliderControl";

const BRAND_COLORS = ["#FFFFFF", "#07293C", "#2ACAA5", "#F4F7F8", "#000000"] as const;
const PREVIEW_WIDTH = 288;

type CardKey = "intro" | "outro";

function CardPreview({
	settings,
	card,
	aspectRatio,
}: {
	settings: IntroOutroSettings;
	card: IntroOutroCard;
	aspectRatio: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const height = Math.round(PREVIEW_WIDTH / Math.min(Math.max(aspectRatio, 0.4), 3));

	useEffect(() => {
		let cancelled = false;
		void prepareIntroOutroAssets(settings).then((logo) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext("2d");
			if (cancelled || !canvas || !ctx) return;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = PREVIEW_WIDTH * dpr;
			canvas.height = height * dpr;
			drawIntroOutroCard(ctx, canvas.width, canvas.height, settings, card, logo);
		});
		return () => {
			cancelled = true;
		};
	}, [settings, card, height]);

	return (
		<canvas
			ref={canvasRef}
			style={{ width: PREVIEW_WIDTH, height }}
			className="max-w-full self-center rounded-md border border-foreground/10"
		/>
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
	const [previewCard, setPreviewCard] = useState<CardKey>("intro");

	const update = (patch: Partial<IntroOutroSettings>) => onChange({ ...settings, ...patch });
	const updateCard = (key: CardKey, patch: Partial<IntroOutroCard>) =>
		onChange({ ...settings, [key]: { ...settings[key], ...patch } });

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
		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				update({ logoDataUrl: reader.result, showLogo: true });
			}
		};
		reader.readAsDataURL(file);
	};

	const renderCardFields = (key: CardKey, label: string) => {
		const card = settings[key];
		return (
			<div className="flex flex-col gap-2.5">
				<div className="flex items-center justify-between gap-3">
					<Label className="text-[13px]">{label}</Label>
					<Switch
						aria-label={label}
						checked={card.enabled}
						onCheckedChange={(enabled) => {
							updateCard(key, { enabled });
							if (enabled) setPreviewCard(key);
						}}
					/>
				</div>
				{card.enabled && (
					<div className="flex flex-col gap-2">
						<Input
							aria-label={t("introOutro.title", "Title")}
							placeholder={t("introOutro.title", "Title")}
							value={card.title}
							maxLength={120}
							onFocus={() => setPreviewCard(key)}
							onChange={(e) => updateCard(key, { title: e.target.value })}
						/>
						<Input
							aria-label={t("introOutro.subtitle", "Subtitle")}
							placeholder={t("introOutro.subtitle", "Subtitle")}
							value={card.subtitle}
							maxLength={160}
							onFocus={() => setPreviewCard(key)}
							onChange={(e) => updateCard(key, { subtitle: e.target.value })}
						/>
					</div>
				)}
			</div>
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
					onClick={() => onChange(DEFAULT_INTRO_OUTRO_SETTINGS)}
				>
					{t("introOutro.reset", "Reset")}
				</Button>
			</div>
			<p className="-mt-3 text-xs text-muted-foreground">
				{t(
					"introOutro.hint",
					"Title cards added at the start and end of MP4 exports, with a short fade.",
				)}
			</p>

			<div className="flex flex-col gap-2">
				<div className="flex gap-1 self-center rounded-lg bg-foreground/[0.04] p-0.5">
					{(["intro", "outro"] as const).map((key) => (
						<button
							key={key}
							type="button"
							onClick={() => setPreviewCard(key)}
							className={`rounded-md px-3 py-1 text-xs ${
								previewCard === key
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground"
							}`}
						>
							{key === "intro"
								? t("introOutro.intro", "Intro")
								: t("introOutro.outro", "Outro")}
						</button>
					))}
				</div>
				<CardPreview
					settings={settings}
					card={settings[previewCard]}
					aspectRatio={aspectRatio}
				/>
			</div>

			{renderCardFields("intro", t("introOutro.intro", "Intro"))}
			{renderCardFields("outro", t("introOutro.outro", "Outro"))}

			<SliderControl
				label={t("introOutro.duration", "Card duration")}
				value={settings.durationSec}
				min={INTRO_OUTRO_MIN_DURATION_SEC}
				max={INTRO_OUTRO_MAX_DURATION_SEC}
				step={0.5}
				onChange={(durationSec) => update({ durationSec })}
				formatValue={(v) => `${v.toFixed(1)} s`}
			/>

			<div className="flex flex-col gap-2.5">
				<div className="flex items-center justify-between gap-3">
					<Label className="text-[13px]">{t("introOutro.logo", "Logo")}</Label>
					<Switch
						aria-label={t("introOutro.logo", "Logo")}
						checked={settings.showLogo}
						onCheckedChange={(showLogo) => update({ showLogo })}
					/>
				</div>
				{settings.showLogo && (
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							size="sm"
							type="button"
							onClick={() => fileInputRef.current?.click()}
						>
							{t("introOutro.uploadLogo", "Upload logo")}
						</Button>
						{settings.logoDataUrl && (
							<Button
								variant="ghost"
								size="sm"
								type="button"
								onClick={() => update({ logoDataUrl: null })}
							>
								{t("introOutro.defaultLogo", "Use Desk to Desk logo")}
							</Button>
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
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<Label className="text-[13px]">{t("introOutro.colors", "Colors")}</Label>
				<div className="grid grid-cols-3 gap-2">
					<ColorControl
						compact
						label={t("introOutro.background", "Background")}
						value={settings.backgroundColor}
						colors={BRAND_COLORS}
						onChange={(backgroundColor) => update({ backgroundColor })}
					/>
					<ColorControl
						compact
						label={t("introOutro.text", "Text")}
						value={settings.textColor}
						colors={BRAND_COLORS}
						onChange={(textColor) => update({ textColor })}
					/>
					<ColorControl
						compact
						label={t("introOutro.accent", "Accent")}
						value={settings.accentColor}
						colors={BRAND_COLORS}
						onChange={(accentColor) => update({ accentColor })}
					/>
				</div>
			</div>
		</section>
	);
}
