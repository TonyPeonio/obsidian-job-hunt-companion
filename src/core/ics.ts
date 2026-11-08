/**
 * iCalendar export of posting deadlines as all-day events, so they show on a phone calendar
 * that imports or subscribes to the file. CRLF line ends, 75-octet folding, RFC 5545
 * escaping, and a UID derived from the note path so re-exports update rather than duplicate.
 */

import type { JobRecord } from "./board";

function escapeText(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: lines longer than 75 octets continue with a leading space. */
export function foldLine(line: string): string {
	const enc = new TextEncoder();
	const out: string[] = [];
	let current = "";
	for (const ch of line) {
		if (enc.encode(current + ch).length > 75) {
			out.push(current);
			current = " " + ch;
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out.join("\r\n");
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function icsUtc(d: Date): string {
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsDate(iso: string): string {
	return iso.replace(/-/g, "");
}

function nextDay(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function uidFor(path: string): string {
	const slug = path
		.replace(/\.md$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `job-hunt-${slug}@job-hunt-companion`;
}

/** One VEVENT per active posting with a deadline on or after `today`, sorted by deadline. */
export function renderIcs(jobs: JobRecord[], today: string, now: Date): string {
	const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Job Hunt Companion for Obsidian//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Job deadlines"];
	const stamp = icsUtc(now);
	const due = jobs.filter((j) => j.deadline && j.deadline >= today && j.active).sort((a, b) => a.deadline!.localeCompare(b.deadline!) || a.company.localeCompare(b.company));
	for (const j of due) {
		const deadline = j.deadline!;
		lines.push("BEGIN:VEVENT", `UID:${uidFor(j.path)}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(deadline)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(deadline))}`, `SUMMARY:${escapeText(`Apply: ${j.company} — ${j.role}`)}`);
		lines.push(`DESCRIPTION:${escapeText(`Status: ${j.status}. Note: ${j.path}`)}`);
		if (j.url) lines.push(`URL:${j.url}`);
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return lines.map(foldLine).join("\r\n") + "\r\n";
}
