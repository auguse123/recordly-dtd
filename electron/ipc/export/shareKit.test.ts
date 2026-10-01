import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildShareKitGifArgs,
	buildShareKitThumbnailArgs,
	getShareKitPaths,
	pickThumbnailTime,
} from "./shareKit";

describe("share kit", () => {
	it("puts every file in a sibling folder named after the video", () => {
		const paths = getShareKitPaths(path.join("/exports", "Visite Opéra.mp4"));
		expect(paths.folder).toBe(path.join("/exports", "Visite Opéra - kit de partage"));
		expect(paths.video).toBe(path.join(paths.folder, "Visite Opéra.mp4"));
		expect(path.dirname(paths.gif)).toBe(paths.folder);
		expect(path.dirname(paths.thumbnail)).toBe(paths.folder);
	});

	it("caps the GIF length at 6 seconds", () => {
		const args = buildShareKitGifArgs({
			inputPath: "in.mp4",
			outputPath: "out.gif",
			durationSec: 90,
		});
		expect(args[args.indexOf("-t") + 1]).toBe("6.000");
		expect(args.at(-1)).toBe("out.gif");
	});

	it("scales large thumbnails down to 1280px wide with even dimensions", () => {
		const args = buildShareKitThumbnailArgs({
			inputPath: "in.mp4",
			outputPath: "thumb.png",
			atSec: 3,
			width: 3440,
			height: 1440,
		});
		expect(args[args.indexOf("-filter_complex") + 1]).toContain("scale=1280:536:");
	});

	it("picks a frame inside the video", () => {
		expect(pickThumbnailTime(0)).toBe(0);
		expect(pickThumbnailTime(2)).toBeLessThanOrEqual(1);
		expect(pickThumbnailTime(60)).toBe(12);
	});
});
