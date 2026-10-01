import { BrowserWindow, ipcMain } from "electron";
import {
	type CaptureFrame,
	type CaptureFrameAspect,
	computeCaptureFrame,
	parseCaptureFrameAspect,
	type Rect,
} from "./captureFrameGeometry";
import { getDisplayBoundsForSource, getDisplayWorkAreaForSource } from "./ipc/recording/ffmpeg";
import { selectedSource } from "./ipc/state";
import { getScreen } from "./ipc/utils";
import {
	getHudOverlayWindow,
	isHudShowingRecorder,
	onHudPresentationChanged,
	reassertHudOverlayMousePassthrough,
} from "./windows";

const FRAME_COLOR = "#2ACAA5";

let frameAspect: CaptureFrameAspect | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayKey = "";

/**
 * The target-format frame for the selected screen, or null when no frame is
 * chosen or the source is a window (window captures keep their own shape).
 */
export function getActiveCaptureFrame(): (CaptureFrame & { overlayArea: Rect }) | null {
	if (!frameAspect || !selectedSource?.id?.startsWith("screen:")) {
		return null;
	}
	try {
		const displayBounds = getDisplayBoundsForSource(selectedSource);
		// macOS keeps windows below the menu bar, so the frame must fit the
		// work area to stay fully visible; elsewhere the whole display is usable.
		const overlayArea =
			process.platform === "darwin"
				? getDisplayWorkAreaForSource(selectedSource)
				: displayBounds;
		const frame = computeCaptureFrame(frameAspect, overlayArea, displayBounds);
		return frame ? { ...frame, overlayArea } : null;
	} catch (error) {
		console.warn("Unable to compute capture frame:", error);
		return null;
	}
}

function buildOverlayHtml(frame: Rect, label: string) {
	return `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;overflow:hidden;width:100vw;height:100vh;font-family:-apple-system,system-ui,sans-serif}
.frame{position:fixed;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;
  box-shadow:0 0 0 100000px rgba(0,0,0,.35);outline:2px solid ${FRAME_COLOR};outline-offset:-2px}
.label{position:absolute;left:8px;top:8px;padding:2px 8px;border-radius:999px;
  background:${FRAME_COLOR};color:#04261d;font-size:11px;font-weight:600}
</style></head><body><div class="frame"><span class="label">${label}</span></div></body></html>`;
}

function destroyOverlay() {
	overlayKey = "";
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		overlayWindow.destroy();
	}
	overlayWindow = null;
	reassertHudOverlayMousePassthrough();
}

function createOverlayWindow(area: Rect) {
	const win = new BrowserWindow({
		x: Math.round(area.x),
		y: Math.round(area.y),
		width: Math.max(1, Math.round(area.width)),
		height: Math.max(1, Math.round(area.height)),
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		resizable: false,
		movable: false,
		focusable: false,
		show: false,
		...(process.platform === "darwin" ? { type: "panel" as const } : {}),
		webPreferences: { nodeIntegration: false, contextIsolation: true },
	});
	win.setIgnoreMouseEvents(true);
	// Keep the guide out of the recording; macOS 15+ ScreenCaptureKit may ignore
	// this, so the recorder additionally excludes Recordly's process.
	win.setContentProtection(true);
	win.setAlwaysOnTop(true, "screen-saver");
	if (process.platform === "darwin") {
		win.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
	}
	win.on("closed", () => {
		if (overlayWindow === win) {
			overlayWindow = null;
			overlayKey = "";
		}
	});
	return win;
}

export function refreshCaptureFrameOverlay() {
	const captureFrame = isHudShowingRecorder() ? getActiveCaptureFrame() : null;
	if (!captureFrame) {
		destroyOverlay();
		return;
	}
	const { overlayArea, frame, aspectRatio } = captureFrame;
	const key = JSON.stringify([overlayArea, frame, aspectRatio]);
	if (key === overlayKey && overlayWindow && !overlayWindow.isDestroyed()) {
		return;
	}
	overlayKey = key;
	if (!overlayWindow || overlayWindow.isDestroyed()) {
		overlayWindow = createOverlayWindow(overlayArea);
	} else {
		overlayWindow.setBounds({
			x: Math.round(overlayArea.x),
			y: Math.round(overlayArea.y),
			width: Math.max(1, Math.round(overlayArea.width)),
			height: Math.max(1, Math.round(overlayArea.height)),
		});
	}
	const win = overlayWindow;
	const localFrame = {
		x: frame.x - Math.round(overlayArea.x),
		y: frame.y - Math.round(overlayArea.y),
		width: frame.width,
		height: frame.height,
	};
	win.loadURL(
		`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml(localFrame, aspectRatio))}`,
	)
		.then(() => {
			if (!win.isDestroyed() && overlayWindow === win) {
				win.showInactive();
				// Keep the recorder controls above the dimmed area.
				getHudOverlayWindow()?.moveTop();
				reassertHudOverlayMousePassthrough();
			}
		})
		.catch((error) => {
			console.warn("Failed to show capture frame overlay:", error);
		});
}

export function registerCaptureFrameHandlers() {
	ipcMain.handle("set-capture-frame-aspect", (_event, aspect: unknown) => {
		frameAspect = parseCaptureFrameAspect(aspect);
		refreshCaptureFrameOverlay();
		return { success: true, aspect: frameAspect };
	});
	ipcMain.handle("get-capture-frame", () => {
		const captureFrame = getActiveCaptureFrame();
		return captureFrame
			? { aspectRatio: captureFrame.aspectRatio, cropRegion: captureFrame.cropRegion }
			: null;
	});
	onHudPresentationChanged(refreshCaptureFrameOverlay);
	const screen = getScreen();
	screen.on("display-metrics-changed", refreshCaptureFrameOverlay);
	screen.on("display-removed", refreshCaptureFrameOverlay);
	screen.on("display-added", refreshCaptureFrameOverlay);
}
