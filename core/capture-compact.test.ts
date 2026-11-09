import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { captureFiles } from "./capture";
import type { Capture } from "./capture";
import { agentCapture, simplifySamples } from "./capture-compact";

const sample = JSON.parse(
	readFileSync(
		new URL("../extension/review/motion-sample.capture.json", import.meta.url),
		"utf8",
	),
) as Capture;

describe("agent capture digest", () => {
	test("is deterministic, compact, and leaves the raw artifact intact", () => {
		const original = JSON.stringify(sample);
		const first = agentCapture(sample);
		const second = agentCapture(sample);
		expect(first).toEqual(second);
		expect(JSON.stringify(first).length).toBeLessThan(
			JSON.stringify(sample, null, 2).length * 0.3,
		);
		expect<unknown>(agentCapture(sample, true)).toEqual(sample);
		expect(JSON.stringify(sample)).toBe(original);
	});

	test("preserves the observed window, overshoot, rotation, and bounded curve error", () => {
		const animation = sample.elements[0]!.animations.find(
			(item) => item.samples,
		)!;
		const rows = animation.samples!;
		const digest = simplifySamples(rows);
		expect(rows).toHaveLength(122);
		expect(digest.observedWindowMs).toBe(rows.at(-1)!.t! - rows[0]!.t!);
		expect(animation.timing?.duration).toBe(2000);
		expect(
			sample.elements[0]!.animations.find(
				(item) => item.origin === "extracted",
			)!.timing?.duration,
		).toBe(1100);
		expect(digest.retained).toBeLessThan(rows.length);
		expect(digest.summary.tx.max).toBe(202.737);
		expect(digest.summary.tx.final).toBe(180);
		expect(digest.summary.b.max).toBe(0.153);
		expect(digest.summary.c.min).toBe(-0.153);

		const retained = digest.values.map((values) =>
			Object.fromEntries(
				digest.columns.map((key, index) => [key, values[index]!]),
			),
		);
		for (const row of rows) {
			const right = retained.findIndex((point) => point.t! >= row.t!);
			const a = retained[Math.max(0, right - 1)]!;
			const b = retained[Math.max(0, right)]!;
			const progress = b.t === a.t ? 0 : (row.t! - a.t!) / (b.t! - a.t!);
			for (const key of digest.columns) {
				const expected = a[key]! + (b[key]! - a[key]!) * progress;
				expect(Math.abs(row[key]! - expected)).toBeLessThanOrEqual(
					digest.tolerances[key]! + 0.001,
				);
			}
		}
	});

	test("retains overshoot, reversal, and exact endpoints in a synthetic spring", () => {
		const rows = [0, 4, 8, 12, 16, 20, 24].map((t, index) => ({
			t,
			x: [0, 14, 25, 18, 10, 10, 10][index]!,
			rotate: [0, 8, 17, 11, 4, 4, 4][index]!,
			opacity: [0, 0.5, 1, 0.8, 0.6, 0.6, 0.6][index]!,
		}));
		const digest = simplifySamples(rows);
		expect(digest.values[0]![0]).toBe(0);
		expect(digest.values.at(-1)![0]).toBe(24);
		expect(digest.summary.x.max).toBe(25);
		expect(digest.summary.x.final).toBe(10);
		expect(digest.summary.rotate.max).toBe(17);
		expect(digest.retained).toBeGreaterThan(2);
	});

	test("keeps extracted and observed animation provenance distinct", () => {
		const digest = agentCapture(sample);
		expect(
			digest.elements[0]!.animations.map((animation) => animation.origin),
		).toEqual(["extracted", "sampled"]);
		expect(
			digest.elements[0]!.animations.map((animation) => animation.kind),
		).toEqual(["waapi", "js"]);
	});

	test("normalizes equivalent box styles without dropping authored rules or variables", () => {
		const withStyles = structuredClone(sample);
		withStyles.elements[0]!.vars = { "--pill-background": "rebeccapurple" };
		withStyles.elements[0]!.rules = ["#motion-pill { padding: 18px 32px; border-radius: 999px; }"];
		const element = agentCapture(withStyles).elements[0]!;
		expect(element.css.padding).toBe("18px 32px");
		expect(element.css["padding-top"]).toBeUndefined();
		expect(element.css["border-radius"]).toBe("999px");
		expect(element.vars).toEqual({ "--pill-background": "rebeccapurple" });
		expect(element.authoredRules).toEqual(withStyles.elements[0]!.rules);
	});

	test("keeps screenshot bytes out of agent text while retaining the raw file reference", () => {
		const withSnapshot = structuredClone(sample);
		const element = withSnapshot.elements[0]!;
		const node = structuredClone(element);
		delete node.snapshots;
		const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
		element.snapshots = [{
			id: "snapshot-private-id",
			createdAt: withSnapshot.createdAt,
			node: { ...node, shots: { ...node.shots, element: "snapshot.png" } },
			image: { file: "snapshot.png", mime: "image/png", dataUrl },
		}];
		const digest = agentCapture(withSnapshot);
		expect(JSON.stringify(digest)).not.toContain(dataUrl);
		expect(JSON.stringify(digest)).not.toContain("snapshot-private-id");
		expect(captureFiles(withSnapshot)).toContain("snapshot.png");
		expect(JSON.stringify(agentCapture(withSnapshot, true))).not.toContain(dataUrl);
	});
});
