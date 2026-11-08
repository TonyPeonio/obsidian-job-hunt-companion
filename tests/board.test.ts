import { describe, expect, it } from "vitest";
import { dueSoon, loadJobs, renderBoard, stale, type JobRecord } from "../src/core/board";
import { foldLine, renderIcs, uidFor } from "../src/core/ics";
import { renderPostingNote } from "../src/core/note";
import { applyStatus } from "../src/core/status";
import { FakeVault } from "./fakes";

const TODAY = "2026-11-07";

function note(company: string, role: string, deadline: string | null, added: string, url = ""): string {
	return renderPostingNote({ company, role, location: "", remote: "", deadline, salary: "", requirements: [], niceToHave: [], keywords: [], emails: [], url, postingText: "posting text long enough", today: added });
}

function vault(): FakeVault {
	return new FakeVault({
		"Jobs/Acme - Engineer.md": note("Acme", "Engineer", "2026-11-15", "2026-11-01", "https://acme.example/jobs/1"),
		"Jobs/Beta - Analyst.md": applyStatus(note("Beta", "Analyst", "2026-12-20", "2026-10-01"), "wishlist", "applied", "2026-10-10"),
		"Jobs/Gamma - Intern.md": applyStatus(note("Gamma", "Intern", "2026-11-05", "2026-10-01"), "wishlist", "rejected", "2026-10-12"),
		"Jobs/Delta - Researcher.md": note("Delta", "Researcher", null, "2026-11-06"),
		"Jobs/Board.md": "---\nsource: board\n---\n# Board\n",
		"Jobs/Scratch.md": "# Not a posting\n",
		"Other/Acme - Engineer.md": note("Elsewhere", "Ignored", "2026-11-10", "2026-11-01"),
	});
}

describe("board", () => {
	it("loads posting notes from the folder only, skipping the board and foreign notes", async () => {
		const jobs = await loadJobs(vault(), "Jobs");
		expect(jobs.map((j) => j.company).sort()).toEqual(["Acme", "Beta", "Delta", "Gamma"]);
		const beta = jobs.find((j) => j.company === "Beta")!;
		expect(beta.status).toBe("applied");
		expect(beta.lastUpdate).toBe("2026-10-10");
		expect(beta.active).toBe(true);
		expect(jobs.find((j) => j.company === "Gamma")!.active).toBe(false);
	});
	it("lists what is due in 14 days and what is stale, excluding closed applications", async () => {
		const jobs = await loadJobs(vault(), "Jobs");
		expect(dueSoon(jobs, TODAY).map((j) => j.company)).toEqual(["Acme"]);
		expect(stale(jobs, TODAY).map((j) => j.company)).toEqual(["Beta"]);
	});
	it("renders a table per status with days left and escaped links, deterministically", async () => {
		const jobs = await loadJobs(vault(), "Jobs");
		const board = renderBoard(jobs, TODAY);
		expect(board).toContain("## Due in the next 14 days\n\n- 2026-11-15 (8) — [[Jobs/Acme - Engineer|Acme — Engineer]] · wishlist");
		expect(board).toContain("## Stale (no update in 21 days)\n\n- [[Jobs/Beta - Analyst|Beta — Analyst]] — last update 2026-10-10 (28 days ago) · applied");
		expect(board).toContain("## Wishlist (2)\n\n| Company | Role | Deadline | Days left | Last update | Note |\n|---|---|---|---|---|---|\n| Acme | Engineer | 2026-11-15 | 8 | 2026-11-01 | [[Jobs/Acme - Engineer\\|open]] |\n| Delta | Researcher |  |  | 2026-11-06 | [[Jobs/Delta - Researcher\\|open]] |");
		expect(board).toContain("## Rejected (1)\n\n| Company | Role | Deadline | Days left | Last update | Note |\n|---|---|---|---|---|---|\n| Gamma | Intern | 2026-11-05 | overdue (2d) |");
		expect(board).toContain("## Offer (0)\n\n_None._");
		expect(renderBoard(jobs, TODAY)).toBe(board);
	});
	it("escapes pipes in company names inside tables", () => {
		const jobs: JobRecord[] = [{ path: "Jobs/x.md", company: "A | B", role: "R", status: "wishlist", deadline: null, lastUpdate: TODAY, url: "", active: true }];
		expect(renderBoard(jobs, TODAY)).toContain("| A \\| B | R |");
	});
});

describe("ics export", () => {
	it("folds long lines at 75 octets with CRLF continuation", () => {
		const folded = foldLine("SUMMARY:" + "é".repeat(60));
		const parts = folded.split("\r\n");
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
		expect(parts[1].startsWith(" ")).toBe(true);
		expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "é".repeat(60));
	});
	it("writes one all-day event per upcoming active deadline with stable UIDs and escaping", async () => {
		const jobs = await loadJobs(vault(), "Jobs");
		const ics = renderIcs(jobs, TODAY, new Date("2026-11-07T15:04:05Z"));
		expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Job Hunt Companion for Obsidian//EN\r\n")).toBe(true);
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(ics.indexOf("Acme")).toBeLessThan(ics.indexOf("Beta"));
		expect(ics).toContain("UID:job-hunt-jobs-acme-engineer@job-hunt-companion\r\n");
		expect(ics).toContain("DTSTAMP:20261107T150405Z\r\n");
		expect(ics).toContain("DTSTART;VALUE=DATE:20261115\r\nDTEND;VALUE=DATE:20261116\r\n");
		expect(ics).toContain("SUMMARY:Apply: Acme — Engineer\r\n");
		expect(ics).toContain("URL:https://acme.example/jobs/1\r\n");
		expect(ics).not.toContain("Gamma");
		expect(uidFor("Jobs/Acme - Engineer.md")).toBe(uidFor("Jobs/Acme - Engineer.md"));
	});
	it("escapes commas and semicolons in text fields", () => {
		const jobs: JobRecord[] = [{ path: "Jobs/x.md", company: "A, B; C", role: "R", status: "wishlist", deadline: "2026-12-01", lastUpdate: TODAY, url: "", active: true }];
		expect(renderIcs(jobs, TODAY, new Date(0))).toContain("SUMMARY:Apply: A\\, B\\; C — R");
	});
});
