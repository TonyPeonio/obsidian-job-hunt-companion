/**
 * Tailoring: which resume bullets answer which requirement, where the keyword gaps are, and
 * a few suggested rewordings. The model may only quote bullets that exist in the resume; a
 * deterministic check drops anything it cannot find and the note says how many were dropped.
 * The resume itself is never edited.
 */

import { parseJsonReply } from "./posting";

export interface TailorInput {
	company: string;
	role: string;
	requirements: string[];
	keywords: string[];
	resumeText: string;
}

export interface TailorMatch {
	requirement: string;
	bullet: string;
}

export interface Rewording {
	original: string;
	suggestion: string;
}

export interface Tailoring {
	matches: TailorMatch[];
	gaps: string[];
	rewordings: Rewording[];
	/** Quoted bullets that were not in the resume and were removed. */
	dropped: number;
}

export const TAILOR_LIMITS = { gaps: 5, rewordings: 3, matches: 16 } as const;

/** Bullet lines (`- `, `* `, `1. `) of the resume, markers removed, in order. */
export function resumeBullets(resume: string): string[] {
	const out: string[] = [];
	for (const raw of resume.split(/\r?\n/)) {
		const m = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/.exec(raw);
		if (m && m[1].split(/\s+/).length >= 3) out.push(m[1]);
	}
	return out;
}

/** Lower case, markdown emphasis removed, punctuation and whitespace collapsed: what "the same bullet" means. */
export function normalizeForMatch(s: string): string {
	return s
		.toLowerCase()
		.replace(/[*_`]/g, "")
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** True when `quoted` appears in the resume (after normalisation), as a bullet or as a substring. */
export function bulletInResume(quoted: string, resumeText: string): boolean {
	const q = normalizeForMatch(quoted);
	if (q.length < 8) return false;
	return normalizeForMatch(resumeText).includes(q);
}

export function tailorSystemPrompt(): string {
	return [
		"You compare a candidate's resume with a job posting's requirements. Reply with one JSON object and nothing else.",
		"Schema:",
		'{"matches": [{"requirement": string, "bullet": string}], "gaps": string[], "rewordings": [{"original": string, "suggestion": string}]}',
		"Rules:",
		"- matches: for each requirement that a resume bullet supports, one entry naming the requirement (copied from the list) and quoting the bullet VERBATIM, character for character, from the resume. Skip requirements nothing supports.",
		"- Only text that appears in the resume may be quoted. Never paraphrase, merge or invent bullets.",
		`- gaps: up to ${TAILOR_LIMITS.gaps} keywords or requirements from the posting that the resume does not mention at all.`,
		`- rewordings: up to ${TAILOR_LIMITS.rewordings} entries; "original" is an existing bullet quoted verbatim, "suggestion" rewrites it so the match to a requirement is explicit, keeping every fact the same. Do not add skills, numbers or outcomes the original lacks.`,
		"Be concise. Empty arrays are fine.",
	].join("\n");
}

export function tailorUserMessage(input: TailorInput): string {
	const reqs = input.requirements.length ? input.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(none listed)";
	return [`Posting: ${input.role} at ${input.company}`, "", "Requirements:", reqs, "", `Keywords: ${input.keywords.join(", ") || "(none)"}`, "", "Resume:", input.resumeText.trim(), "", "Return the JSON object now."].join("\n");
}

function clean(v: unknown, max = 300): string | null {
	if (typeof v !== "string") return null;
	const t = v.replace(/\s+/g, " ").trim();
	return t ? t.slice(0, max) : null;
}

/** Parses the model reply and applies the grounding filter. Null when the reply is not JSON. */
export function parseTailoring(reply: string, input: TailorInput): Tailoring | null {
	const json = parseJsonReply(reply);
	if (!json) return null;
	let dropped = 0;
	const matches: TailorMatch[] = [];
	const seen = new Set<string>();
	if (Array.isArray(json.matches)) {
		for (const m of json.matches) {
			if (!m || typeof m !== "object") continue;
			const o = m as Record<string, unknown>;
			const requirement = clean(o.requirement, 200);
			const bullet = clean(o.bullet);
			if (!requirement || !bullet) continue;
			if (!bulletInResume(bullet, input.resumeText)) {
				dropped++;
				continue;
			}
			const key = `${requirement.toLowerCase()}|${normalizeForMatch(bullet)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			matches.push({ requirement, bullet });
			if (matches.length >= TAILOR_LIMITS.matches) break;
		}
	}
	const gaps: string[] = [];
	if (Array.isArray(json.gaps)) {
		for (const g of json.gaps) {
			const s = clean(g, 120);
			if (s && !gaps.some((x) => x.toLowerCase() === s.toLowerCase())) gaps.push(s);
			if (gaps.length >= TAILOR_LIMITS.gaps) break;
		}
	}
	const rewordings: Rewording[] = [];
	if (Array.isArray(json.rewordings)) {
		for (const r of json.rewordings) {
			if (!r || typeof r !== "object") continue;
			const o = r as Record<string, unknown>;
			const original = clean(o.original);
			const suggestion = clean(o.suggestion, 400);
			if (!original || !suggestion) continue;
			if (!bulletInResume(original, input.resumeText)) {
				dropped++;
				continue;
			}
			rewordings.push({ original, suggestion });
			if (rewordings.length >= TAILOR_LIMITS.rewordings) break;
		}
	}
	return { matches, gaps, rewordings, dropped };
}

export function renderTailoring(t: Tailoring, meta: { today: string; model: string; resumePath: string }): string {
	const lines: string[] = [`_Written ${meta.today} by ${meta.model} from [[${meta.resumePath.replace(/\.md$/, "")}]]. Suggestions only; the resume was not changed._`, "", "### Matches", ""];
	if (t.matches.length === 0) lines.push("_No resume bullet was matched to a requirement._");
	for (const m of t.matches) lines.push(`- **${m.requirement}** — "${m.bullet}"`);
	lines.push("", "### Keyword gaps", "");
	if (t.gaps.length === 0) lines.push("_No gaps named._");
	for (const g of t.gaps) lines.push(`- ${g}`);
	lines.push("", "### Suggested rewordings", "", "_Suggestions, not edits. Keep only what is true._", "");
	if (t.rewordings.length === 0) lines.push("_None._");
	for (const r of t.rewordings) lines.push(`- Now: "${r.original}"`, `  - Suggestion: ${r.suggestion}`);
	if (t.dropped > 0) lines.push("", `_${t.dropped} quoted bullet${t.dropped === 1 ? " was" : "s were"} not found in the resume and ${t.dropped === 1 ? "was" : "were"} dropped._`);
	return lines.join("\n");
}
