import dtdLogoUrl from "@/assets/branding/dtd-logo.svg";
import type { IntroOutroCard, IntroOutroSettings } from "@/components/video-editor/introOutro";

const FONT_FAMILY = '"DM Sans", -apple-system, "Helvetica Neue", Arial, sans-serif';

const logoCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadLogo(url: string): Promise<HTMLImageElement | null> {
	let pending = logoCache.get(url);
	if (!pending) {
		pending = new Promise((resolve) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => resolve(null);
			image.src = url;
		});
		logoCache.set(url, pending);
	}
	return pending;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(candidate).width > maxWidth) {
				lines.push(line);
				line = word;
			} else {
				line = candidate;
			}
		}
		if (line) lines.push(line);
	}
	return lines;
}

export async function prepareIntroOutroAssets(settings: IntroOutroSettings) {
	await Promise.all([
		document.fonts.load(`600 64px ${FONT_FAMILY}`),
		document.fonts.load(`400 36px ${FONT_FAMILY}`),
	]).catch(() => undefined);
	return settings.showLogo ? loadLogo(settings.logoDataUrl ?? dtdLogoUrl) : null;
}

/** Draws one card. Sizes are designed for a 1080px short side and scale from there. */
export function drawIntroOutroCard(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	settings: IntroOutroSettings,
	card: IntroOutroCard,
	logo: HTMLImageElement | null,
) {
	const s = Math.min(width, height) / 1080;
	const maxTextWidth = width * 0.84;

	ctx.save();
	ctx.fillStyle = settings.backgroundColor;
	ctx.fillRect(0, 0, width, height);

	let logoW = 0;
	let logoH = 0;
	if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
		const ratio = logo.naturalWidth / logo.naturalHeight;
		logoW = Math.min(width * 0.6, 720 * s, 260 * s * ratio);
		logoH = logoW / ratio;
	}

	const titleSize = 64 * s;
	const subtitleSize = 36 * s;
	ctx.font = `600 ${titleSize}px ${FONT_FAMILY}`;
	const titleLines = wrapLines(ctx, card.title.trim(), maxTextWidth);
	ctx.font = `400 ${subtitleSize}px ${FONT_FAMILY}`;
	const subtitleLines = wrapLines(ctx, card.subtitle.trim(), maxTextWidth);

	const hasText = titleLines.length > 0 || subtitleLines.length > 0;
	const barW = 80 * s;
	const barH = 6 * s;
	const gap = 40 * s;
	const titleLineH = titleSize * 1.2;
	const subtitleLineH = subtitleSize * 1.35;
	const textBlockH =
		titleLines.length * titleLineH +
		(titleLines.length && subtitleLines.length ? 12 * s : 0) +
		subtitleLines.length * subtitleLineH;
	const totalH = logoH + (logoH && hasText ? gap * 2 + barH : 0) + (hasText ? textBlockH : 0);

	let y = (height - totalH) / 2;
	if (logoH) {
		ctx.drawImage(logo as HTMLImageElement, (width - logoW) / 2, y, logoW, logoH);
		y += logoH;
		if (hasText) {
			y += gap;
			ctx.fillStyle = settings.accentColor;
			ctx.beginPath();
			ctx.roundRect((width - barW) / 2, y, barW, barH, barH / 2);
			ctx.fill();
			y += barH + gap;
		}
	}

	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = settings.textColor;
	ctx.font = `600 ${titleSize}px ${FONT_FAMILY}`;
	for (const line of titleLines) {
		ctx.fillText(line, width / 2, y + titleLineH / 2);
		y += titleLineH;
	}
	if (titleLines.length && subtitleLines.length) y += 12 * s;
	ctx.globalAlpha = 0.75;
	ctx.font = `400 ${subtitleSize}px ${FONT_FAMILY}`;
	for (const line of subtitleLines) {
		ctx.fillText(line, width / 2, y + subtitleLineH / 2);
		y += subtitleLineH;
	}
	ctx.restore();
}

export async function renderIntroOutroCardPng(
	width: number,
	height: number,
	settings: IntroOutroSettings,
	card: IntroOutroCard,
): Promise<Uint8Array> {
	const logo = await prepareIntroOutroAssets(settings);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context unavailable");
	drawIntroOutroCard(ctx, width, height, settings, card, logo);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) throw new Error("Failed to encode intro/outro card");
	return new Uint8Array(await blob.arrayBuffer());
}
