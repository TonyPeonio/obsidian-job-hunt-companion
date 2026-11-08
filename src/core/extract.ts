/**
 * Deterministic first pass over a pasted job posting. Everything here is a regex over the
 * text; the local model only fills what this pass leaves empty (see `posting.ts`).
 */

import { findDates } from "./dates";

export type RemoteKind = "remote" | "hybrid" | "on-site";

export interface RegexExtraction {
	/** First non-empty line, trimmed: a guess at the role title used only when the model gives none. */
	titleGuess: string | null;
	/** From a `Company:` label line only. */
	company: string | null;
	/** `YYYY-MM-DD` from a line that talks about a deadline; null when none or only vague wording. */
	deadline: string | null;
	/** The salary text as written, e.g. `$85k–$100k`. */
	salary: string | null;
	/** From a `Location:` label or a `City, ST` pair. */
	location: string | null;
	remote: RemoteKind | null;
	emails: string[];
}

const DEADLINE_WORDS = /\b(deadline|apply by|applications? (?:close|closes|closing|due|must be (?:received|submitted))|closing date|closes? on|due by|due date|submit(?:ted)? by|open until|no later than|last day to apply|by)\b/i;
const STRICT_DEADLINE_WORDS = /\b(deadline|apply by|applications? (?:close|closes|closing|due|must be (?:received|submitted))|closing date|closes? on|due by|due date|submit(?:ted)? by|open until|no later than|last day to apply)\b/i;
const CURRENCY = "[$£€]";
const AMOUNT = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s?[kK]\\b|\\d{4,7}(?:\\.\\d+)?";
const RANGE_SEP = "\\s?(?:-|–|—|to)\\s?";
const PERIOD = "(?:\\s?(?:per|/|a|an)\\s?(?:year|yr|annum|hour|hr|month|mo|week|wk)\\b)?";
const SALARY_SYMBOL = new RegExp(`${CURRENCY}\\s?(?:${AMOUNT})(?:${RANGE_SEP}${CURRENCY}?\\s?(?:${AMOUNT}))?${PERIOD}`, "g");
const SALARY_CODE = new RegExp(`\\b(?:${AMOUNT})(?:${RANGE_SEP}(?:${AMOUNT}))?\\s?(?:USD|GBP|EUR|CAD|AUD|CHF)\\b${PERIOD}`, "g");

export function extractPosting(text: string, todayIso: string): RegexExtraction {
	const lines = text.split(/\r?\n/).map((l) => l.trim());
	const nonEmpty = lines.filter(Boolean);
	const titleGuess = nonEmpty.length && nonEmpty[0].length <= 120 ? stripMarkdown(nonEmpty[0]) : null;
	return {
		titleGuess,
		company: labelValue(lines, /^(?:company|employer|organi[sz]ation)\s*[:：]\s*(.+)$/i),
		deadline: extractDeadline(lines, todayIso),
		salary: extractSalary(text),
		location: extractLocation(lines, text),
		remote: extractRemote(text),
		emails: extractEmails(text),
	};
}

function stripMarkdown(s: string): string {
	return s.replace(/^#+\s*/, "").replace(/\*\*|__/g, "").trim();
}

function labelValue(lines: string[], re: RegExp): string | null {
	for (const l of lines) {
		const m = re.exec(l);
		if (m && m[1].trim()) return stripMarkdown(m[1].split(/\.\s|\.$|;|\s[–—|]\s/)[0]).slice(0, 120) || null;
	}
	return null;
}

/**
 * A date on a line that talks about a deadline. Lines with strong wording ("deadline",
 * "apply by", "applications close") win; a bare "by <date>" counts only when nothing stronger
 * exists. Lines about the start date or the posting date are skipped. Returns null for
 * "end of month", "rolling", "ASAP" and other wording with no readable date.
 */
export function extractDeadline(lines: string[], todayIso: string): string | null {
	const candidates: { strict: boolean; iso: string }[] = [];
	for (const line of lines) {
		if (/\b(start(?:ing|s)? (?:date|on)|posted|published|updated)\b/i.test(line) && !STRICT_DEADLINE_WORDS.test(line)) continue;
		const kw = DEADLINE_WORDS.exec(line);
		if (!kw) continue;
		const dates = findDates(line, todayIso);
		if (dates.length === 0) continue;
		const after = dates.find((d) => d.index >= (kw.index ?? 0)) ?? dates[0];
		candidates.push({ strict: STRICT_DEADLINE_WORDS.test(line), iso: after.iso });
	}
	return candidates.find((c) => c.strict)?.iso ?? candidates[0]?.iso ?? null;
}

/** The first salary-looking amount or range with a currency; small amounts (fees, bonuses under 1,000) are ignored. */
export function extractSalary(text: string): string | null {
	for (const re of [SALARY_SYMBOL, SALARY_CODE]) {
		re.lastIndex = 0;
		for (const m of text.matchAll(re)) {
			if (amountValue(m[0]) >= 1000) return m[0].trim().replace(/\s+/g, " ");
		}
	}
	return null;
}

function amountValue(s: string): number {
	const m = /(\d[\d,]*(?:\.\d+)?)\s?([kK])?/.exec(s);
	if (!m) return 0;
	const n = Number(m[1].replace(/,/g, ""));
	return m[2] ? n * 1000 : n;
}

export function extractLocation(lines: string[], text: string): string | null {
	const labelled = labelValue(lines, /^(?:location|based in|office)\s*[:：]\s*(.+)$/i);
	if (labelled) return labelled;
	const cityState = /\b([A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+){0,3}),\s([A-Z]{2})\b(?!\s?\d)/.exec(text);
	if (cityState && !/^(Inc|LLC|Ltd|Corp|Co)$/.test(cityState[1])) return `${cityState[1]}, ${cityState[2]}`;
	return null;
}

export function extractRemote(text: string): RemoteKind | null {
	if (/\bhybrid\b/i.test(text)) return "hybrid";
	if (/\b(?:not|no|non)(?:\s+an?)?[- ]remote\b|\bremote(?: work(?:ing)?)? is not\b|\bin[- ]person only\b|\bon[- ]?site only\b/i.test(text)) return "on-site";
	if (/\bremote\b/i.test(text)) return "remote";
	if (/\bon[- ]?site\b|\bin[- ]office\b|\bin[- ]person\b/i.test(text)) return "on-site";
	return null;
}

export function extractEmails(text: string): string[] {
	const seen = new Set<string>();
	for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) seen.add(m[0].toLowerCase());
	return Array.from(seen);
}
