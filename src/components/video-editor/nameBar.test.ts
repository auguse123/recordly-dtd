import { describe, expect, it } from "vitest";
import { splitNameBarLines } from "./types";

describe("splitNameBarLines", () => {
	it("uses the first line as the name and keeps non-empty title lines", () => {
		expect(splitNameBarLines("Jane Doe\nBroker\n\nDesk to Desk")).toEqual({
			name: "Jane Doe",
			subtitles: ["Broker", "Desk to Desk"],
		});
	});

	it("handles a name without a title", () => {
		expect(splitNameBarLines("Jane Doe")).toEqual({ name: "Jane Doe", subtitles: [] });
		expect(splitNameBarLines("")).toEqual({ name: "", subtitles: [] });
	});
});
