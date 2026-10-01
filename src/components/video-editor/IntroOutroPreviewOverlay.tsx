import { useEffect, useRef, useState } from "react";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import { drawIntroOutroCard, prepareIntroOutroAssets } from "@/lib/introOutroCard";
import type { EditorPlayback } from "./hooks/useIntroOutroPreview";
import { type IntroOutroCard, isIntroOutroVideo } from "./introOutro";

const SEEK_TOLERANCE_SEC = 0.25;

function CardCanvas({ card }: { card: IntroOutroCard }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState({ width: 0, height: 0 });

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const observer = new ResizeObserver(([entry]) => {
			const dpr = window.devicePixelRatio || 1;
			setSize({
				width: Math.round(entry.contentRect.width * dpr),
				height: Math.round(entry.contentRect.height * dpr),
			});
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!size.width || !size.height) return;
		let cancelled = false;
		void prepareIntroOutroAssets(card).then((assets) => {
			const canvas = canvasRef.current;
			const ctx = canvas?.getContext("2d");
			if (cancelled || !canvas || !ctx) return;
			canvas.width = size.width;
			canvas.height = size.height;
			drawIntroOutroCard(ctx, size.width, size.height, card, assets);
		});
		return () => {
			cancelled = true;
		};
	}, [card, size]);

	return <canvas ref={canvasRef} className="h-full w-full" />;
}

function ClipVideo({
	card,
	timeSec,
	playing,
	volume,
}: {
	card: IntroOutroCard;
	timeSec: number;
	playing: boolean;
	volume: number;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [src, setSrc] = useState<string | null>(null);
	const path = card.media?.path ?? null;

	useEffect(() => {
		if (!path) return;
		let cancelled = false;
		void resolveMediaElementSource(path).then((resolved) => {
			if (!cancelled) setSrc(resolved.src);
		});
		return () => {
			cancelled = true;
		};
	}, [path]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.volume = Math.min(1, Math.max(0, volume));
	}, [volume]);

	// The phase clock is the source of truth; the element follows it.
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !src) return;
		if (Math.abs(video.currentTime - timeSec) > SEEK_TOLERANCE_SEC) {
			video.currentTime = timeSec;
		}
		if (playing && video.paused) {
			video.play().catch(() => undefined);
		} else if (!playing && !video.paused) {
			video.pause();
		}
	}, [src, timeSec, playing]);

	return (
		<video
			ref={videoRef}
			src={src ?? undefined}
			className="h-full w-full object-contain"
			style={{ backgroundColor: card.backgroundColor }}
			playsInline
			preload="auto"
		/>
	);
}

/**
 * Covers the preview frame with the intro/outro while it plays, faded the same
 * way the export cross-fades it into the recording.
 */
export function IntroOutroPreviewOverlay({
	introOutro,
	volume,
}: {
	introOutro: EditorPlayback["introOutro"];
	volume: number;
}) {
	const { phase, settings, introSec, outroSec, introFadeSec, outroFadeSec } = introOutro;
	if (!phase) return null;

	const card = settings[phase.side];
	const t = phase.timeSec;
	let opacity = 1;
	if (phase.side === "intro") {
		const fadeStart = introSec - introFadeSec;
		if (t > fadeStart && introFadeSec > 0) opacity = Math.max(0, (introSec - t) / introFadeSec);
	} else if (outroFadeSec > 0) {
		opacity = Math.min(1, t / outroFadeSec);
	}
	if (outroSec <= 0 && phase.side === "outro") return null;

	return (
		<div
			className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
			style={{ opacity, backgroundColor: card.backgroundColor }}
		>
			{isIntroOutroVideo(card) ? (
				<ClipVideo card={card} timeSec={t} playing={phase.playing} volume={volume} />
			) : (
				<CardCanvas card={card} />
			)}
		</div>
	);
}
