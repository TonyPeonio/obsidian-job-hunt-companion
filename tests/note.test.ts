import { describe, expect, it } from "vitest";
import { parseFrontmatter, setFrontmatterValue } from "../src/core/frontmatter";
import { lastUpdate, parsePostingNote, parseTimeline, postingFileName, renderPostingNote } from "../src/core/note";
import { appendToSection, findSections, sectionBody, splitLines, upsertSection } from "../src/core/sections";
import { applyStatus, nextStatus } from "../src/core/status";
import { SAMPLE_POSTING } from "./fakes";

const TODAY = "2026-11-07";

function sampleNote(): string {
	return renderPostingNote({
		company: "Acme Analytics",
		role: "Software Engineer, Data Platform",
		location: "Denver, CO",
		remote: "hybrid",
		deadline: "2026-11-30",
		salary: "$85k–$100k per year",
		requirements: ["2+ years writing production Python", "Apache Airflow or similar"],
		niceToHave: ["Go or Rust"],
		keywords: ["python", "airflow", "sql: advanced"],
		emails: ["hiring@acme-analytics.example"],
		url: "https://jobs.example/123",
		postingText: SAMPLE_POSTING,
		today: TODAY,
	});
}

describe("posting note rendering", () => {
	it("builds a safe file name", () => {
		expect(postingFileName("Acme/Analytics: Inc", "Eng <Data>")).toBe("AcmeAnalytics Inc - Eng Data.md");
		expect(postingFileName("", "")).toBe("Unknown company - Untitled role.md");
	});
	it("writes the frontmatter and every section, with the posting verbatim in a fence", () => {
		const note = sampleNote();
		expect(note.startsWith('---\ncompany: Acme Analytics\nrole: "Software Engineer, Data Platform"\nstatus: wishlist\napplied_on: ""\n')).toBe(true);
		expect(note).toContain("deadline: 2026-11-30\n");
		expect(note).toContain("salary: $85k–$100k per year\n");
		expect(note).toContain('url: "https://jobs.example/123"\n');
		expect(note).toContain("source: posting\n");
		expect(note).toContain("keywords:\n  - python\n  - airflow\n  - \"sql: advanced\"\n");
		for (const h of ["## Posting", "## Requirements", "## Nice to have", "## Fit", "## Notes", "## Timeline"]) expect(note).toContain(`\n${h}\n`);
		expect(note).toContain("```text\n" + SAMPLE_POSTING.trimEnd() + "\n```");
		expect(note).toContain("- [ ] 2+ years writing production Python");
		expect(note).toContain("- 2026-11-07 — added");
		expect(note).toContain("Contact: hiring@acme-analytics.example");
	});
	it("uses a longer fence when the posting contains backticks", () => {
		const note = renderPostingNote({ company: "A", role: "B", location: "", remote: "", deadline: null, salary: "", requirements: [], niceToHave: [], keywords: [], emails: [], url: "", postingText: "x\n```\ncode\n```\ny", today: TODAY });
		expect(note).toContain("````text\nx\n```\ncode\n```\ny\n````");
	});
	it("round-trips through the parser", () => {
		const parsed = parsePostingNote(sampleNote());
		expect(parsed).not.toBeNull();
		expect(parsed!.company).toBe("Acme Analytics");
		expect(parsed!.status).toBe("wishlist");
		expect(parsed!.deadline).toBe("2026-11-30");
		expect(parsed!.salary).toBe("$85k–$100k per year");
		expect(parsed!.keywords).toEqual(["python", "airflow", "sql: advanced"]);
		expect(parsed!.requirements).toEqual(["2+ years writing production Python", "Apache Airflow or similar"]);
		expect(parsed!.niceToHave).toEqual(["Go or Rust"]);
		expect(parsed!.timeline).toEqual([{ date: TODAY, text: "added" }]);
		expect(lastUpdate(parsed!)).toBe(TODAY);
	});
	it("does not treat '## ' lines inside the pasted posting as sections", () => {
		const note = renderPostingNote({ company: "A", role: "B", location: "", remote: "", deadline: null, salary: "", requirements: ["r1"], niceToHave: [], keywords: [], emails: [], url: "", postingText: "## Requirements\n- fake requirement from the posting", today: TODAY });
		expect(parsePostingNote(note)!.requirements).toEqual(["r1"]);
		expect(findSections(splitLines(note)).map((s) => s.heading)).toEqual(["Posting", "Requirements", "Nice to have", "Fit", "Notes", "Timeline"]);
	});
	it("rejects notes that are not postings", () => {
		expect(parsePostingNote("# Hello\n\nnot a posting")).toBeNull();
		expect(parsePostingNote("---\ntitle: x\n---\n")).toBeNull();
	});
});

describe("frontmatter edits in place", () => {
	it("changes one key and keeps the rest, including user-added keys and lists", () => {
		const content = "---\ncompany: A\nstatus: wishlist\ntags:\n  - job\nmine: keep\n---\n# A\n";
		const out = setFrontmatterValue(content, "status", "applied");
		expect(out).toBe("---\ncompany: A\nstatus: applied\ntags:\n  - job\nmine: keep\n---\n# A\n");
		expect(parseFrontmatter(out).data.tags).toEqual(["job"]);
	});
	it("adds a missing key and creates frontmatter when there is none", () => {
		expect(setFrontmatterValue("---\na: 1\n---\nbody", "applied_on", "2026-11-08")).toBe("---\na: 1\napplied_on: 2026-11-08\n---\nbody");
		expect(setFrontmatterValue("body", "status", "applied")).toBe("---\nstatus: applied\n---\nbody");
	});
});

describe("sections", () => {
	it("appends to a section's list and creates the section when missing", () => {
		const content = "## Notes\n\n## Timeline\n\n- 2026-11-07 — added\n";
		expect(appendToSection(content, "Timeline", "- 2026-11-08 — applied")).toBe("## Notes\n\n## Timeline\n\n- 2026-11-07 — added\n- 2026-11-08 — applied\n");
		expect(appendToSection("# T\n", "Timeline", "- x")).toBe("# T\n\n## Timeline\n\n- x\n");
	});
	it("replaces an existing section body without touching neighbours", () => {
		const content = "## A\n\nold a\n\n## Tailoring\n\nold\nmore old\n\n## Timeline\n\n- 2026-11-07 — added\n";
		const out = upsertSection(content, "Tailoring", "new body");
		expect(out).toBe("## A\n\nold a\n\n## Tailoring\n\nnew body\n\n## Timeline\n\n- 2026-11-07 — added\n");
		expect(sectionBody(out, "Tailoring")).toBe("new body");
		expect(upsertSection("## A\n\na\n", "Tailoring", "t")).toBe("## A\n\na\n\n## Tailoring\n\nt\n");
	});
});

describe("status workflow", () => {
	it("cycles through the workflow and wraps", () => {
		expect(nextStatus("wishlist")).toBe("applied");
		expect(nextStatus("offer")).toBe("rejected");
		expect(nextStatus("withdrawn")).toBe("wishlist");
	});
	it("sets status, applied_on and a timeline line", () => {
		const applied = applyStatus(sampleNote(), "wishlist", "applied", "2026-11-08");
		const parsed = parsePostingNote(applied)!;
		expect(parsed.status).toBe("applied");
		expect(parsed.appliedOn).toBe("2026-11-08");
		expect(parsed.timeline).toEqual([
			{ date: TODAY, text: "added" },
			{ date: "2026-11-08", text: "applied" },
		]);
		const interview = applyStatus(applied, "applied", "interview", "2026-11-20", parsed.appliedOn);
		const p2 = parsePostingNote(interview)!;
		expect(p2.appliedOn).toBe("2026-11-08");
		expect(p2.status).toBe("interview");
		expect(parseTimeline(interview).map((t) => t.text)).toEqual(["added", "applied", "interview"]);
		expect(lastUpdate(p2)).toBe("2026-11-20");
	});
	it("is a no-op for the same status", () => {
		const note = sampleNote();
		expect(applyStatus(note, "wishlist", "wishlist", "2026-11-08")).toBe(note);
	});
});
