/** The application workflow and the note edits a status change makes. */

import { setFrontmatterValue } from "./frontmatter";
import { appendToSection } from "./sections";

export const STATUSES = ["wishlist", "applied", "phone screen", "interview", "offer", "rejected", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses the board treats as still in play. */
export const ACTIVE_STATUSES: readonly Status[] = ["wishlist", "applied", "phone screen", "interview", "offer"];

export function isStatus(s: string): s is Status {
	return (STATUSES as readonly string[]).includes(s);
}

/** The status after `current` in the workflow; wraps from withdrawn back to wishlist. */
export function nextStatus(current: Status): Status {
	const i = STATUSES.indexOf(current);
	return STATUSES[(i + 1) % STATUSES.length];
}

export function timelineLine(date: string, text: string): string {
	return `- ${date} — ${text}`;
}

/**
 * Sets `status` in the frontmatter and appends `- <today> — <status>` to the Timeline.
 * Moving to applied fills `applied_on` with today when it is empty. Returns the content
 * unchanged when the status is already `status`.
 */
export function applyStatus(content: string, currentStatus: Status, status: Status, today: string, currentAppliedOn = ""): string {
	if (currentStatus === status) return content;
	let out = setFrontmatterValue(content, "status", status);
	if (status === "applied" && !currentAppliedOn) out = setFrontmatterValue(out, "applied_on", today);
	return appendToSection(out, "Timeline", timelineLine(today, status));
}
