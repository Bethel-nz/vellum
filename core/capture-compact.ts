import type { Capture } from "./capture";

const properties = new Set(
	"display position box-sizing width height min-width max-width min-height max-height padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left gap flex-direction align-items justify-content grid-template-columns color background-color font-family font-size font-weight line-height letter-spacing text-align border-top-width border-right-width border-bottom-width border-left-width border-top-color border-right-color border-bottom-color border-left-color border-top-style border-right-style border-bottom-style border-left-style border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius opacity transform transform-origin translate rotate scale perspective overflow box-shadow text-shadow filter backdrop-filter transition".split(
		" ",
	),
);
const round = (value: number) => Math.round(value * 1000) / 1000;
const spread = (length: number, limit: number) => [
	...new Set(
		Array.from({ length: Math.min(length, limit) }, (_, index) =>
			Math.round(
				(index * (length - 1)) / Math.max(1, Math.min(length, limit) - 1),
			),
		),
	),
];

const tolerance = (name: string) =>
	/^(x|y|tx|ty|w|h|sw|sh|width|height)$/.test(name)
		? 0.5
		: /^(a|b|c|d|scale|rotate|rotation)$/.test(name)
			? 0.005
			: name === "opacity"
				? 0.005
				: 0.01;

function compactCss(css: Record<string, string>) {
	const result = Object.fromEntries(
		Object.entries(css).filter(([name]) => properties.has(name)),
	);
	const shorthand = (prefix: "padding" | "margin") => {
		const sides = [
			`${prefix}-top`,
			`${prefix}-right`,
			`${prefix}-bottom`,
			`${prefix}-left`,
		];
		const values = sides.map((side) => result[side]);
		if (
			values.every((value) => value === values[0]) &&
			values[0] !== undefined
		) {
			result[prefix] = values[0]!;
			sides.forEach((side) => {
				delete result[side];
			});
		} else if (
			values[0] !== undefined &&
			values[2] === values[0] &&
			values[1] === values[3]
		) {
			result[prefix] = `${values[0]} ${values[1]}`;
			sides.forEach((side) => {
				delete result[side];
			});
		}
	};
	shorthand("padding");
	shorthand("margin");
	for (const part of ["width", "color", "style"]) {
		const sides = ["top", "right", "bottom", "left"].map(
			(side) => `border-${side}-${part}`,
		);
		const values = sides.map((side) => result[side]);
		if (values.every((value) => value !== undefined && value === values[0])) {
			result[`border-${part}`] = values[0]!;
			sides.forEach((side) => {
				delete result[side];
			});
		}
	}
	const radii = [
		"border-top-left-radius",
		"border-top-right-radius",
		"border-bottom-right-radius",
		"border-bottom-left-radius",
	];
	if (
		radii.every(
			(name) =>
				result[name] !== undefined && result[name] === result[radii[0]!],
		)
	) {
		result["border-radius"] = result[radii[0]!]!;
		radii.forEach((name) => {
			delete result[name];
		});
	}
	return result;
}

export type SampleDigest = {
	count: number;
	retained: number;
	simplified?: boolean;
	observedWindowMs?: number;
	columns: string[];
	tolerances: Record<string, number>;
	summary: Record<string, { start: number; min: number; minAt: number; max: number; maxAt: number; final: number }>;
	values: number[][];
	curveRef?: string;
	requiresRawCurve?: boolean;
};

export function simplifySamples(rows: Array<Record<string, number>>): SampleDigest {
	if (!rows.length)
		return {
			count: 0,
			retained: 0,
			columns: [],
			tolerances: {},
			summary: {},
			values: [],
		};
	const columns = Object.keys(rows[0]!).filter((key) =>
		rows.some((row) => Math.abs(row[key]! - rows[0]![key]!) > 0.0001),
	);
	const tolerances = Object.fromEntries(
		columns.map((key) => [key, tolerance(key)]),
	);
	const keep = new Set([0, rows.length - 1]);
	const simplifyRange = (start: number, end: number) => {
		if (end <= start + 1) return;
		const t0 = rows[start]!.t ?? start;
		const t1 = rows[end]!.t ?? end;
		let worst = 1;
		let at = -1;
		for (let index = start + 1; index < end; index++) {
			const time = rows[index]!.t ?? index;
			const progress =
				t1 === t0 ? (index - start) / (end - start) : (time - t0) / (t1 - t0);
			for (const key of columns) {
				const expected =
					rows[start]![key]! +
					(rows[end]![key]! - rows[start]![key]!) * progress;
				const error =
					Math.abs(rows[index]![key]! - expected) / tolerances[key]!;
				if (error > worst) {
					worst = error;
					at = index;
				}
			}
		}
		if (at !== -1) {
			keep.add(at);
			simplifyRange(start, at);
			simplifyRange(at, end);
		}
	};
	simplifyRange(0, rows.length - 1);
	const indices = [...keep].sort((a, b) => a - b);
	return {
		count: rows.length,
		retained: indices.length,
		simplified: indices.length < rows.length,
		...(rows[0]?.t !== undefined && rows.at(-1)?.t !== undefined
			? { observedWindowMs: round(rows.at(-1)!.t! - rows[0]!.t!) }
			: {}),
		columns,
		tolerances,
		summary: Object.fromEntries(
			columns
				.filter((key) => key !== "t")
				.map((key) => {
					const minIndex = rows.reduce(
						(best, row, index) =>
							row[key]! < rows[best]![key]! ? index : best,
						0,
					);
					const maxIndex = rows.reduce(
						(best, row, index) =>
							row[key]! > rows[best]![key]! ? index : best,
						0,
					);
					return [
						key,
						{
							start: round(rows[0]![key]!),
							min: round(rows[minIndex]![key]!),
							minAt: round(rows[minIndex]!.t ?? minIndex),
							max: round(rows[maxIndex]![key]!),
							maxAt: round(rows[maxIndex]!.t ?? maxIndex),
							final: round(rows.at(-1)![key]!),
						},
					];
				}),
		),
		values: indices.map((index) =>
			columns.map((key) => round(rows[index]![key]!)),
		),
		...(indices.length > 48
			? { curveRef: "raw capture samples", requiresRawCurve: true }
			: {}),
	};
}

function easing(value: unknown, curveRef: string) {
	if (typeof value !== "string" || value.length <= 180) return value;
	const points = [...value.matchAll(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)%/g)].map(
		(match) => [Number(match[2]) / 100, Number(match[1])],
	);
	if (!value.startsWith("linear(") || !points.length)
		return {
			type: "custom",
			characters: value.length,
			curveRef,
		};
	const indices = new Set(spread(points.length, 8));
	indices.add(
		points.reduce(
			(best, row, index) => (row[1]! > points[best]![1]! ? index : best),
			0,
		),
	);
	indices.add(
		points.reduce(
			(best, row, index) => (row[1]! < points[best]![1]! ? index : best),
			0,
		),
	);
	return {
		type: "linear",
		simplified: true,
		pointCount: points.length,
		curveRef,
		points: [...indices]
			.sort((a, b) => a - b)
			.map((index) => points[index]!.map(round)),
	};
}

function withoutInlineImageData(capture: Capture) {
	return {
		...capture,
		elements: capture.elements.map((element) => ({
			...element,
			snapshots: element.snapshots?.map((snapshot) => ({
				...snapshot,
				image: { file: snapshot.image.file, mime: snapshot.image.mime },
			})),
		})),
	};
}

/** A deterministic view for agents; capture.json and image files remain the raw source. */
/** The compact view of an element's animations; `ref` is where the full data sits in capture.json. */
function compactAnimations(animations: Capture["elements"][number]["animations"], ref: string) {
	return animations.map((animation, index) => ({
		id: index + 1,
		origin: animation.origin,
		kind: animation.kind,
		...(animation.name ? { name: animation.name } : {}),
		...(animation.trigger ? { trigger: animation.trigger } : {}),
		...(animation.gesture ? { gesture: animation.gesture } : {}),
		...(animation.timing
			? {
					timing: {
						...animation.timing,
						...(animation.timing.easing
							? { easing: easing(animation.timing.easing, `${ref}.animations[${index}].timing.easing`) }
							: {}),
					},
				}
			: {}),
		...(animation.keyframes
			? {
					keyframes: spread(animation.keyframes.length, 16).map(
						(frameIndex) => animation.keyframes![frameIndex],
					),
					...(animation.keyframes.length > 16
						? {
								keyframeCount: animation.keyframes.length,
								curveRef: `${ref}.animations[${index}].keyframes`,
							}
						: {}),
				}
			: {}),
		...(animation.samples
			? { observedMotion: { ...simplifySamples(animation.samples), curveRef: `${ref}.animations[${index}].samples` } }
			: {}),
		...(animation.frames?.length
			? { screenshotRefs: animation.frames }
			: {}),
	}));
}

export function agentCapture(capture: Capture, full: true): ReturnType<typeof withoutInlineImageData>;
export function agentCapture(capture: Capture, full?: false): ReturnType<typeof compactCapture>;
export function agentCapture(capture: Capture, full?: boolean): ReturnType<typeof withoutInlineImageData> | ReturnType<typeof compactCapture>;
export function agentCapture(capture: Capture, full = false) {
	return full ? withoutInlineImageData(capture) : compactCapture(capture);
}

function compactCapture(capture: Capture) {
	return {
		version: capture.version,
		id: capture.id,
		page: capture.page,
		compact: true,
		raw: {
			directory: "capture directory",
			file: "capture.json",
			available: true,
		},
		elements: capture.elements.map((element, elementIndex) => ({
			id: elementIndex + 1,
			selector: element.selector,
			note: element.note,
			html: element.html.slice(0, 2000),
			...(element.html.length > 2000 ? { htmlTruncated: true } : {}),
			css: compactCss(element.css),
			...(element.vars ? { vars: element.vars } : {}),
			box: Object.fromEntries(
				Object.entries(element.box).map(([name, value]) => [
					name,
					round(value),
				]),
			),
			...(element.parent ? { parent: element.parent } : {}),
			...(element.react ? { react: element.react } : {}),
			animations: compactAnimations(element.animations, `elements[${elementIndex}]`),
			shots: element.shots,
			...(element.snapshots?.length
				? {
					snapshots: element.snapshots.map((snapshot, index) => ({
						id: index + 1,
							createdAt: snapshot.createdAt,
							selector: snapshot.node.selector,
							box: snapshot.node.box,
							file: snapshot.image.file,
						})),
					}
				: {}),
			...(element.rules?.length ? { authoredRules: element.rules } : {}),
			...(element.pseudo ? { pseudo: element.pseudo } : {}),
			...(element.listeners?.length ? { listeners: element.listeners } : {}),
			...(element.related?.length
				? {
						related: element.related.map((related, index) => ({
							id: index + 1,
							change: related.change,
							selector: related.selector,
							...(related.role ? { role: related.role } : {}),
							...(related.label ? { label: related.label } : {}),
							...(related.text ? { text: related.text } : {}),
							box: Object.fromEntries(Object.entries(related.box).map(([name, value]) => [name, round(value)])),
							animations: compactAnimations(related.animations, `elements[${elementIndex}].related[${index}]`),
							...(related.shot ? { shot: related.shot } : {}),
						})),
					}
				: {}),
			...(element.changes?.length ? { changes: element.changes } : {}),
		})),
		...(capture.pageShot ? { pageShot: capture.pageShot } : {}),
	};
}
