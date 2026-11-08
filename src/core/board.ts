/**
 * The board: one managed note summarising every posting note by status, with what is due
 * soon and what has gone quiet at the top. Pure function of the records and `today`.
 */

import { daysBetween } from "./dates";
import { lastUpdate, parsePostingNote } from "./note";
import { ACTIVE_STATUSES, STATUSES, type Status } from "./status";
import { notesInFolder, type VaultAccess } from "./vault";

export interface JobRecord {
	/** Vault path of the note, with `.md`. */
	path: string;
	company: string;
	role: string;
	status: Status;
	deadline: string | null;
	/** `YYYY-MM-DD` of the last Timeline line (or the file's mtime when the Timeline has none). */
	lastUpdate: string;
	url: string;
	active: boolean;
}

export const DUE_WINDOW_DAYS = 14;
export const STALE_AFTER_DAYS = 21;
export const BOARD_FILE = "Board.md";

/** Reads every posting note under `folder` (Board.md and foreign notes are skipped). */
export async function loadJobs(vault: VaultAccess, folder: string): Promise<JobRecord[]> {
	const out: JobRecord[] = [];
	for (const n of notesInFolder(vault, folder)) {
		if (n.basename === BOARD_FILE.replace(/\.md$/, "")) continue;
		const note = parsePostingNote(await vault.read(n.path));
		if (!note) continue;
		out.push({
			path: n.path,
			company: note.company,
			role: note.role,
			status: note.status,
			deadline: note.deadline,
			lastUpdate: lastUpdate(note) ?? new Date(n.mtime).toISOString().slice(0, 10),
			url: note.url,
			active: ACTIVE_STATUSES.includes(note.status),
		});
	}
	return out;
}

function cell(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function link(j: JobRecord, text: string, inTable: boolean): string {
	const target = j.path.replace(/\.md$/, "");
	return inTable ? `[[${target}\\|${cell(text)}]]` : `[[${target}|${text}]]`;
}

function daysLeftText(j: JobRecord, today: string): string {
	if (!j.deadline) return "";
	const n = daysBetween(today, j.deadline);
	if (n < 0) return `overdue (${-n}d)`;
	if (n === 0) return "today";
	return String(n);
}

function byDeadline(a: JobRecord, b: JobRecord): number {
	if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
	if (a.deadline && !b.deadline) return -1;
	if (!a.deadline && b.deadline) return 1;
	return a.company.localeCompare(b.company) || a.role.localeCompare(b.role);
}

export function dueSoon(jobs: JobRecord[], today: string): JobRecord[] {
	return jobs.filter((j) => j.active && j.deadline && j.deadline >= today && daysBetween(today, j.deadline) <= DUE_WINDOW_DAYS).sort(byDeadline);
}

export function stale(jobs: JobRecord[], today: string): JobRecord[] {
	return jobs.filter((j) => j.active && daysBetween(j.lastUpdate, today) > STALE_AFTER_DAYS).sort((a, b) => a.lastUpdate.localeCompare(b.lastUpdate) || a.company.localeCompare(b.company));
}

function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderBoard(jobs: JobRecord[], today: string): string {
	const lines: string[] = [
		"---",
		"source: board",
		"---",
		"# Board",
		"",
		`_Refreshed ${today} by Job Hunt Companion from ${jobs.length} posting note${jobs.length === 1 ? "" : "s"}. Run "Open the board" to refresh; edits here are overwritten._`,
		"",
		`## Due in the next ${DUE_WINDOW_DAYS} days`,
		"",
	];
	const due = dueSoon(jobs, today);
	if (due.length === 0) lines.push("_Nothing due._");
	for (const j of due) lines.push(`- ${j.deadline} (${daysLeftText(j, today)}) — ${link(j, `${j.company} — ${j.role}`, false)} · ${j.status}`);
	lines.push("", `## Stale (no update in ${STALE_AFTER_DAYS} days)`, "");
	const quiet = stale(jobs, today);
	if (quiet.length === 0) lines.push("_Nothing stale._");
	for (const j of quiet) lines.push(`- ${link(j, `${j.company} — ${j.role}`, false)} — last update ${j.lastUpdate} (${daysBetween(j.lastUpdate, today)} days ago) · ${j.status}`);
	for (const status of STATUSES) {
		const rows = jobs.filter((j) => j.status === status).sort(byDeadline);
		lines.push("", `## ${titleCase(status)} (${rows.length})`, "");
		if (rows.length === 0) {
			lines.push("_None._");
			continue;
		}
		lines.push("| Company | Role | Deadline | Days left | Last update | Note |", "|---|---|---|---|---|---|");
		for (const j of rows) lines.push(`| ${cell(j.company)} | ${cell(j.role)} | ${j.deadline ?? ""} | ${daysLeftText(j, today)} | ${j.lastUpdate} | ${link(j, "open", true)} |`);
	}
	lines.push("");
	return lines.join("\n");
}
