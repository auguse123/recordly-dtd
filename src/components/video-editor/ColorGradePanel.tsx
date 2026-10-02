import { Label } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useScopedT } from "@/contexts/I18nContext";
import {
	COLOR_GRADE_PRESETS,
	COLOR_GRADE_SLIDERS,
	type ColorGrade,
	type ColorGradePresetId,
	type ColorGradeSlider,
	type ColorMatrix,
	DEFAULT_COLOR_GRADE,
	findColorGradePreset,
	getColorGradeMatrix,
	isNeutralColorGrade,
} from "./colorGrade";
import { SliderControl } from "./SliderControl";

/** Skin tone, sky blue and mid grey: enough to read a grade at a glance. */
const SWATCH_COLORS: ReadonlyArray<[number, number, number]> = [
	[0.87, 0.64, 0.52],
	[0.27, 0.55, 0.86],
	[0.5, 0.5, 0.5],
];

function applyMatrix(matrix: ColorMatrix, [r, g, b]: [number, number, number]): string {
	const channel = (row: number) => {
		const value =
			matrix[row * 5] * r +
			matrix[row * 5 + 1] * g +
			matrix[row * 5 + 2] * b +
			matrix[row * 5 + 3] +
			matrix[row * 5 + 4];
		return Math.round(Math.min(1, Math.max(0, value)) * 255);
	};
	return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

const PRESET_LABELS: Record<ColorGradePresetId, string> = {
	neutral: "Neutral",
	bright: "Bright",
	warm: "Warm",
	cool: "Cool",
	punchy: "Punchy",
	soft: "Soft",
	mono: "Black & white",
};

const SLIDER_LABELS: Record<ColorGradeSlider, string> = {
	brightness: "Brightness",
	contrast: "Contrast",
	saturation: "Saturation",
	temperature: "Temperature",
};

interface ColorGradePanelProps {
	colorGrade: ColorGrade;
	onColorGradeChange: (grade: ColorGrade) => void;
}

export function ColorGradePanel({ colorGrade, onColorGradeChange }: ColorGradePanelProps) {
	const t = useScopedT("settings");
	const activePreset = findColorGradePreset(colorGrade);
	const update = (patch: Partial<ColorGrade>) => onColorGradeChange({ ...colorGrade, ...patch });

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label className="text-[13px]">{t("colorGrade.presets", "Looks")}</Label>
				<div className="grid grid-cols-2 gap-2">
					{COLOR_GRADE_PRESETS.map((preset) => {
						const matrix = getColorGradeMatrix({ ...colorGrade, ...preset.values });
						const active = activePreset === preset.id;
						return (
							<button
								key={preset.id}
								type="button"
								onClick={() => update(preset.values)}
								className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
									active
										? "border-[#2ACAA5] bg-[#2ACAA5]/10 text-foreground"
										: "border-foreground/10 text-muted-foreground hover:border-foreground/25"
								}`}
							>
								<span className="flex h-5 w-8 shrink-0 overflow-hidden rounded">
									{SWATCH_COLORS.map((color) => (
										<span
											key={color.join()}
											className="flex-1"
											style={{ backgroundColor: applyMatrix(matrix, color) }}
										/>
									))}
								</span>
								{t(`colorGrade.preset.${preset.id}`, PRESET_LABELS[preset.id])}
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex flex-col gap-1">
				{COLOR_GRADE_SLIDERS.map((key) => (
					<SliderControl
						key={key}
						label={t(`colorGrade.${key}`, SLIDER_LABELS[key])}
						value={colorGrade[key]}
						min={-100}
						max={100}
						step={1}
						onChange={(value) => update({ [key]: value })}
						formatValue={(value) => (value > 0 ? `+${value}` : `${value}`)}
					/>
				))}
			</div>

			<div className="flex items-center justify-between gap-3">
				<Label className="text-[13px]">
					{t("colorGrade.includeCamera", "Apply to the camera too")}
				</Label>
				<Switch
					aria-label={t("colorGrade.includeCamera", "Apply to the camera too")}
					checked={colorGrade.includeCamera}
					onCheckedChange={(includeCamera) => update({ includeCamera })}
				/>
			</div>

			<Button
				variant="secondary"
				size="sm"
				type="button"
				disabled={isNeutralColorGrade(colorGrade)}
				onClick={() =>
					onColorGradeChange({
						...DEFAULT_COLOR_GRADE,
						includeCamera: colorGrade.includeCamera,
					})
				}
			>
				{t("colorGrade.reset", "Reset")}
			</Button>
			<p className="text-[11px] leading-relaxed text-muted-foreground">
				{t(
					"colorGrade.hint",
					"The grade applies to the whole recording, in the preview and the export.",
				)}
			</p>
		</section>
	);
}
