/**
 * The posting note: frontmatter + fixed sections. Rendering is deterministic; parsing reads
 * back what the plugin (or the user, within reason) wrote.
 */

import { parseFrontmatter, renderFrontmatter, type FrontmatterValue } from "./frontmatter";
import type { PostingFields } from "./posting";
import { listItems, sectionBody } from "./sections";
import { STATUSES, type Status } from "./status";

export interface PostingNoteInput extends PostingFields {
	url: string;
	postingText: string;
	/** `YYYY-MM-DD` the note is created. */
	today: string;
}

export interface PostingNote {
	company: string;
	role: string;
	status: Status;
	appliedOn: string;
	deadline: string | null;
	location: string;
	remote: string;
	salary: string;
	url: string;
	keywords: string[];
	requirements: string[];
	niceToHave: string[];
	/** `YYYY-MM-DD` of every dated Timeline line, in note order. */
	timeline: { date: string; text: string }[];
}

/** `Company - Role` with characters Obsidian cannot put in a file name removed. */
export function postingFileName(company: string, role: string): string {
	const clean = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
	return `${clean(company) || "Unknown company"} - ${clean(role) || "Untitled role"}.md`;
}

/** A fence long enough that the pasted text cannot close it early. */
function fenceFor(text: string): string {
	let longest = 2;
	for (const m of text.matchAll(/`{3,}/g)) longest = Math.max(longest, m[0].length);
	return "`".repeat(longest + 1);
}

export function renderPostingNote(p: PostingNoteInput): string {
	const fm: Record<string, FrontmatterValue> = {
		company: p.company,
		role: p.role,
		status: "wishlist",
		applied_on: "",
		deadline: p.deadline ?? "",
		location: p.location,
		remote: p.remote,
		salary: p.salary,
		url: p.url,
		source: "posting",
		keywords: p.keywords,
	};
	const fence = fenceFor(p.postingText);
	const bullets = (items: string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `_${empty}_`);
	const contact = p.emails.length ? `\nContact: ${p.emails.join(", ")}\n` : "";
	return [
		renderFrontmatter(fm),
		`# ${p.company} — ${p.role}`,
		"",
		"## Posting",
		"",
		`${fence}text`,
		p.postingText.replace(/\s+$/, ""),
		fence,
		contact,
		"## Requirements",
		"",
		bullets(p.requirements, "None extracted. Add the must-haves here; Tailor and Interview prep read this list."),
		"",
		"## Nice to have",
		"",
		bullets(p.niceToHave, "None extracted."),
		"",
		"## Fit",
		"",
		p.requirements.length ? p.requirements.map((r) => `- ${r}`).join("\n") : "_Note how you meet each requirement once the list above is filled in._",
		"",
		"## Notes",
		"",
		"",
		"## Timeline",
		"",
		`- ${p.today} — added`,
		"",
	]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function scalar(v: FrontmatterValue | undefined): string {
	return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

/** True when a note's frontmatter marks it as one of ours. */
export function isPostingNote(data: Record<string, FrontmatterValue>): boolean {
	return typeof data.company === "string" && typeof data.role === "string" && typeof data.status === "string";
}

export function parsePostingNote(content: string): PostingNote | null {
	const fm = parseFrontmatter(content);
	if (!fm.present || !isPostingNote(fm.data)) return null;
	const d = fm.data;
	const statusRaw = scalar(d.status).toLowerCase();
	const deadline = scalar(d.deadline);
	return {
		company: scalar(d.company),
		role: scalar(d.role),
		status: (STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as Status) : "wishlist",
		appliedOn: scalar(d.applied_on),
		deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
		location: scalar(d.location),
		remote: scalar(d.remote),
		salary: scalar(d.salary),
		url: scalar(d.url),
		keywords: Array.isArray(d.keywords) ? d.keywords : scalar(d.keywords) ? [scalar(d.keywords)] : [],
		requirements: listItems(sectionBody(content, "Requirements")),
		niceToHave: listItems(sectionBody(content, "Nice to have")),
		timeline: parseTimeline(content),
	};
}

export function parseTimeline(content: string): { date: string; text: string }[] {
	const out: { date: string; text: string }[] = [];
	for (const item of listItems(sectionBody(content, "Timeline"))) {
		const m = /^(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.*)$/.exec(item);
		if (m) out.push({ date: m[1], text: m[2] });
	}
	return out;
}

/** The latest Timeline date, or null when the note has no dated line. */
export function lastUpdate(note: PostingNote): string | null {
	let last: string | null = null;
	for (const t of note.timeline) if (!last || t.date > last) last = t.date;
	return last;
}
