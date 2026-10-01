import path from "node:path";
import { app } from "electron";

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

export const USER_DATA_PATH = app.getPath("userData");
// Recordly DTD keeps its own settings but shares the stock Recordly recordings
// folder, so existing takes stay in the library.
export const RECORDINGS_DIR = process.env["VITE_DEV_SERVER_URL"]
	? path.join(USER_DATA_PATH, "recordings")
	: path.join(app.getPath("appData"), "Recordly", "recordings");
