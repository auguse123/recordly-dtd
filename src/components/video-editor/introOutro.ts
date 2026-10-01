// Intro/outro (DTD). Each side is either a title card (rendered to PNG in the
// renderer at export size) or a user image/clip copied into the app's media
// folder. The main process joins them around the exported MP4 (apply-intro-outro).

export type IntroOutroSource = "card" | "media";

export interface IntroOutroMedia {
	/** Absolute path inside the app-owned intro/outro media folder. */
	path: string;
	type: "image" | "video";
	name: string;
	durationSec: number | null;
	hasAudio: boolean;
}

export interface IntroOutroCard {
	enabled: boolean;
	source: IntroOutroSource;
	title: string;
	subtitle: string;
	/** Length of a title card or still image; clips use their own length. */
	durationSec: number;
	backgroundColor: string;
	textColor: string;
	accentColor: string;
	showLogo: boolean;
	/** Custom logo as a data URL; null uses the bundled Desk to Desk logo. */
	logoDataUrl: string | null;
	media: IntroOutroMedia | null;
}

export interface IntroOutroSettings {
	intro: IntroOutroCard;
	outro: IntroOutroCard;
}

export type IntroOutroSide = keyof IntroOutroSettings;

export const INTRO_OUTRO_MIN_DURATION_SEC = 1;
export const INTRO_OUTRO_MAX_DURATION_SEC = 8;
export const INTRO_OUTRO_MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const INTRO_OUTRO_MAX_FADE_SEC = 0.5;

const BASE_CARD: IntroOutroCard = {
	enabled: false,
	source: "card",
	title: "",
	subtitle: "",
	durationSec: 2.5,
	backgroundColor: "#FFFFFF",
	textColor: "#07293C",
	accentColor: "#2ACAA5",
	showLogo: true,
	logoDataUrl: null,
	media: null,
};

export const DEFAULT_INTRO_OUTRO_SETTINGS: IntroOutroSettings = {
	intro: { ...BASE_CARD },
	outro: { ...BASE_CARD, title: "Contactez-nous", subtitle: "desk-to-desk.com" },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(value: unknown, fallback: string): string {
	return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

function normalizeDuration(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(INTRO_OUTRO_MAX_DURATION_SEC, Math.max(INTRO_OUTRO_MIN_DURATION_SEC, value))
		: fallback;
}

function normalizeLogo(value: unknown): string | null {
	return typeof value === "string" &&
		value.startsWith("data:image/") &&
		value.length <= INTRO_OUTRO_MAX_LOGO_BYTES * 1.4
		? value
		: null;
}

function normalizeMedia(value: unknown): IntroOutroMedia | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Partial<IntroOutroMedia>;
	if (typeof raw.path !== "string" || !raw.path) return null;
	if (raw.type !== "image" && raw.type !== "video") return null;
	const durationSec =
		typeof raw.durationSec === "number" && raw.durationSec > 0 ? raw.durationSec : null;
	if (raw.type === "video" && !durationSec) return null;
	return {
		path: raw.path,
		type: raw.type,
		name: typeof raw.name === "string" ? raw.name.slice(0, 200) : "",
		durationSec,
		hasAudio: raw.hasAudio === true,
	};
}

/** `legacy` carries the pre-split shared fields (duration, colours, logo). */
function normalizeCard(
	value: unknown,
	fallback: IntroOutroCard,
	legacy: Record<string, unknown>,
): IntroOutroCard {
	const raw = {
		...legacy,
		...(value && typeof value === "object" ? (value as Record<string, unknown>) : {}),
	};
	const media = normalizeMedia(raw.media);
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
		source: raw.source === "media" && media ? "media" : "card",
		title: typeof raw.title === "string" ? raw.title.slice(0, 120) : fallback.title,
		subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 160) : fallback.subtitle,
		durationSec: normalizeDuration(raw.durationSec, fallback.durationSec),
		backgroundColor: normalizeColor(raw.backgroundColor, fallback.backgroundColor),
		textColor: normalizeColor(raw.textColor, fallback.textColor),
		accentColor: normalizeColor(raw.accentColor, fallback.accentColor),
		showLogo: typeof raw.showLogo === "boolean" ? raw.showLogo : fallback.showLogo,
		logoDataUrl: normalizeLogo(raw.logoDataUrl),
		media,
	};
}

export function normalizeIntroOutroSettings(value: unknown): IntroOutroSettings {
	const fallback = DEFAULT_INTRO_OUTRO_SETTINGS;
	const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const legacy: Record<string, unknown> = {};
	for (const key of [
		"durationSec",
		"backgroundColor",
		"textColor",
		"accentColor",
		"showLogo",
		"logoDataUrl",
	]) {
		if (key in raw) legacy[key] = raw[key];
	}
	return {
		intro: normalizeCard(raw.intro, fallback.intro, legacy),
		outro: normalizeCard(raw.outro, fallback.outro, legacy),
	};
}

/** Enabled and has something to show (a media side needs its file). */
export function isIntroOutroCardActive(card: IntroOutroCard): boolean {
	return card.enabled && (card.source === "card" || Boolean(card.media));
}

export function isIntroOutroVideo(card: IntroOutroCard): boolean {
	return card.source === "media" && card.media?.type === "video";
}

/** Seconds this side occupies before cross-fading (clips use their own length). */
export function getIntroOutroDurationSec(card: IntroOutroCard): number {
	if (!isIntroOutroCardActive(card)) return 0;
	if (isIntroOutroVideo(card) && card.media?.durationSec) return card.media.durationSec;
	return card.durationSec;
}

export function hasEnabledIntroOutro(settings: IntroOutroSettings): boolean {
	return isIntroOutroCardActive(settings.intro) || isIntroOutroCardActive(settings.outro);
}

/** Matches the main-process fade (electron/ipc/export/introOutro.ts). */
export function getIntroOutroFadeSec(sideSec: number, mainSec: number): number {
	return Math.min(INTRO_OUTRO_MAX_FADE_SEC, sideSec / 3, mainSec / 3);
}
