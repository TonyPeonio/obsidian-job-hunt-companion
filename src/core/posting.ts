/**
 * The structured posting: what the regex pass found, what the local model added, and the
 * merge (regex wins on conflict). The model's output is validated field by field; its dates
 * are re-read with the deterministic parser, never trusted as written.
 */

import { parseDateText } from "./dates";
import type { RegexExtraction, RemoteKind } from "./extract";
import { stripThinkTags } from "./ollama";

export interface PostingFields {
	company: string;
	role: string;
	location: string;
	remote: RemoteKind | "";
	deadline: string | null;
	salary: string;
	requirements: string[];
	niceToHave: string[];
	keywords: string[];
	emails: string[];
}

export interface ModelPosting {
	company: string | null;
	role: string | null;
	location: string | null;
	remote: RemoteKind | null;
	deadline: string | null;
	salary: string | null;
	requirements: string[];
	niceToHave: string[];
	keywords: string[];
}

export const LIMITS = { requirements: 8, niceToHave: 5, keywords: 12, itemChars: 160 } as const;

const REMOTE_KINDS: RemoteKind[] = ["remote", "hybrid", "on-site"];

export function extractionSystemPrompt(): string {
	return [
		"You extract structured facts from a job posting. Reply with one JSON object and nothing else: no prose, no markdown fences.",
		"Schema (every key required; use null when the posting does not say):",
		'{"company": string|null, "role": string|null, "location": string|null, "remote": "remote"|"hybrid"|"on-site"|null, "deadline": string|null, "salary": string|null, "requirements": string[], "nice_to_have": string[], "keywords": string[]}',
		"Rules:",
		"- company: the hiring organisation's name only, no legal suffix padding, no slogans.",
		"- role: the job title as posted, without the company name or location.",
		"- location: city and region or country as posted; null if only remote is stated.",
		"- deadline: copy the application deadline text exactly as written in the posting (for example \"November 30, 2026\"); null when there is none or it is vague (\"rolling\", \"until filled\").",
		"- salary: the pay range or figure exactly as written, including currency and period; null when not stated.",
		`- requirements: up to ${LIMITS.requirements} short phrases (under 12 words each) for the must-have qualifications, in the posting's own words.`,
		`- nice_to_have: up to ${LIMITS.niceToHave} short phrases for preferred or bonus qualifications.`,
		`- keywords: up to ${LIMITS.keywords} lowercase skills, tools, methods or domain terms from the posting, most specific first.`,
		"Never invent anything that is not in the posting.",
	].join("\n");
}

export function extractionUserMessage(postingText: string): string {
	return `Job posting:\n\n${postingText.trim()}\n\nReturn the JSON object now.`;
}

/** The first JSON object in a model reply (fences, prose and <think> blocks tolerated). Null when none parses. */
export function parseJsonReply(reply: string): Record<string, unknown> | null {
	const text = stripThinkTags(reply).replace(/```(?:json)?/gi, "");
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				try {
					const parsed: unknown = JSON.parse(text.slice(start, i + 1));
					return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

function str(v: unknown, max = 160): string | null {
	if (typeof v !== "string") return null;
	const t = v.replace(/\s+/g, " ").trim();
	return t ? t.slice(0, max) : null;
}

function strList(v: unknown, max: number): string[] {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of v) {
		const s = str(item, LIMITS.itemChars);
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
		if (out.length >= max) break;
	}
	return out;
}

/** Validates a parsed model reply against the schema; unknown or malformed fields become null/empty. */
export function validateModelPosting(json: Record<string, unknown> | null, todayIso: string): ModelPosting {
	const j = json ?? {};
	const remoteRaw = str(j.remote)?.toLowerCase().replace(/\s|_/g, "-").replace(/^onsite$/, "on-site") ?? null;
	return {
		company: str(j.company, 120),
		role: str(j.role, 120),
		location: str(j.location, 120),
		remote: REMOTE_KINDS.includes(remoteRaw as RemoteKind) ? (remoteRaw as RemoteKind) : null,
		deadline: parseDateText(str(j.deadline, 80), todayIso),
		salary: str(j.salary, 80),
		requirements: strList(j.requirements, LIMITS.requirements),
		niceToHave: strList(j.nice_to_have ?? j.niceToHave, LIMITS.niceToHave),
		keywords: strList(j.keywords, LIMITS.keywords).map((k) => k.toLowerCase()),
	};
}

export function emptyModelPosting(): ModelPosting {
	return { company: null, role: null, location: null, remote: null, deadline: null, salary: null, requirements: [], niceToHave: [], keywords: [] };
}

/** Regex facts win where they exist; the model fills the rest; the first-line title guess is the last resort for the role. */
export function mergePosting(regex: RegexExtraction, model: ModelPosting): PostingFields {
	return {
		company: regex.company ?? model.company ?? "Unknown company",
		role: model.role ?? regex.titleGuess ?? "Untitled role",
		location: regex.location ?? model.location ?? "",
		remote: regex.remote ?? model.remote ?? "",
		deadline: regex.deadline ?? model.deadline,
		salary: regex.salary ?? model.salary ?? "",
		requirements: model.requirements,
		niceToHave: model.niceToHave,
		keywords: model.keywords,
		emails: regex.emails,
	};
}
