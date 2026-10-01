// Intro/outro title cards (DTD). Rendered to PNG in the renderer at export size,
// then joined around the exported MP4 by the main process (apply-intro-outro).

export interface IntroOutroCard {
	enabled: boolean;
	title: string;
	subtitle: string;
}

export interface IntroOutroSettings {
	intro: IntroOutroCard;
	outro: IntroOutroCard;
	durationSec: number;
	backgroundColor: string;
	textColor: string;
	accentColor: string;
	showLogo: boolean;
	/** Custom logo as a data URL; null uses the bundled Desk to Desk logo. */
	logoDataUrl: string | null;
}

export const INTRO_OUTRO_MIN_DURATION_SEC = 1;
export const INTRO_OUTRO_MAX_DURATION_SEC = 6;
export const INTRO_OUTRO_MAX_LOGO_BYTES = 2 * 1024 * 1024;

export const DEFAULT_INTRO_OUTRO_SETTINGS: IntroOutroSettings = {
	intro: { enabled: false, title: "", subtitle: "" },
	outro: { enabled: false, title: "Contactez-nous", subtitle: "desk-to-desk.com" },
	durationSec: 2.5,
	backgroundColor: "#FFFFFF",
	textColor: "#07293C",
	accentColor: "#2ACAA5",
	showLogo: true,
	logoDataUrl: null,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeCard(value: unknown, fallback: IntroOutroCard): IntroOutroCard {
	const raw = value && typeof value === "object" ? (value as Partial<IntroOutroCard>) : {};
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
		title: typeof raw.title === "string" ? raw.title.slice(0, 120) : fallback.title,
		subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 160) : fallback.subtitle,
	};
}

function normalizeColor(value: unknown, fallback: string): string {
	return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

export function normalizeIntroOutroSettings(value: unknown): IntroOutroSettings {
	const fallback = DEFAULT_INTRO_OUTRO_SETTINGS;
	const raw = value && typeof value === "object" ? (value as Partial<IntroOutroSettings>) : {};
	const duration =
		typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec)
			? Math.min(
					INTRO_OUTRO_MAX_DURATION_SEC,
					Math.max(INTRO_OUTRO_MIN_DURATION_SEC, raw.durationSec),
				)
			: fallback.durationSec;
	const logoDataUrl =
		typeof raw.logoDataUrl === "string" &&
		raw.logoDataUrl.startsWith("data:image/") &&
		raw.logoDataUrl.length <= INTRO_OUTRO_MAX_LOGO_BYTES * 1.4
			? raw.logoDataUrl
			: null;
	return {
		intro: normalizeCard(raw.intro, fallback.intro),
		outro: normalizeCard(raw.outro, fallback.outro),
		durationSec: duration,
		backgroundColor: normalizeColor(raw.backgroundColor, fallback.backgroundColor),
		textColor: normalizeColor(raw.textColor, fallback.textColor),
		accentColor: normalizeColor(raw.accentColor, fallback.accentColor),
		showLogo: typeof raw.showLogo === "boolean" ? raw.showLogo : fallback.showLogo,
		logoDataUrl,
	};
}

export function hasEnabledIntroOutro(settings: IntroOutroSettings): boolean {
	return settings.intro.enabled || settings.outro.enabled;
}
