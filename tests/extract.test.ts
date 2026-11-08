import { describe, expect, it } from "vitest";
import { findDates, parseDateText } from "../src/core/dates";
import { extractDeadline, extractEmails, extractPosting, extractRemote, extractSalary } from "../src/core/extract";
import { SAMPLE_POSTING } from "./fakes";

const TODAY = "2026-11-07";

describe("dates in six formats", () => {
	it("reads ISO", () => {
		expect(parseDateText("2026-11-30", TODAY)).toBe("2026-11-30");
	});
	it("reads US numeric month/day/year", () => {
		expect(parseDateText("Apply by 11/30/2026", TODAY)).toBe("2026-11-30");
	});
	it("reads day-first numeric when the first number cannot be a month", () => {
		expect(parseDateText("30/11/2026", TODAY)).toBe("2026-11-30");
	});
	it("reads 'Nov 30' with the year inferred as the next occurrence", () => {
		expect(parseDateText("Nov 30", TODAY)).toBe("2026-11-30");
		expect(parseDateText("Jan 15", TODAY)).toBe("2027-01-15");
		expect(findDates("Nov 30", TODAY)[0].yearAssumed).toBe(true);
	});
	it("reads 'November 30, 2026' and '30 November 2026' and '30th Nov'", () => {
		expect(parseDateText("November 30, 2026", TODAY)).toBe("2026-11-30");
		expect(parseDateText("30 November 2026", TODAY)).toBe("2026-11-30");
		expect(parseDateText("30th Nov", TODAY)).toBe("2026-11-30");
	});
	it("returns null for vague wording and impossible dates", () => {
		expect(parseDateText("end of month", TODAY)).toBeNull();
		expect(parseDateText("rolling basis", TODAY)).toBeNull();
		expect(parseDateText("February 30, 2026", TODAY)).toBeNull();
		expect(parseDateText("", TODAY)).toBeNull();
		expect(parseDateText(null, TODAY)).toBeNull();
	});
	it("does not read 'may' the verb or bare numbers as dates", () => {
		expect(findDates("You may apply with 3 references and 5 years of experience.", TODAY)).toEqual([]);
	});
	it("keeps the longest match when formats overlap", () => {
		const found = findDates("Deadline: November 30, 2026.", TODAY);
		expect(found).toHaveLength(1);
		expect(found[0].raw).toBe("November 30, 2026");
	});
});

describe("deadline extraction", () => {
	it("takes the date on the line with deadline wording", () => {
		expect(extractDeadline(["Posted on October 1, 2026", "Deadline: Nov 30", "Start date: January 5, 2027"], TODAY)).toBe("2026-11-30");
	});
	it("prefers strong wording over a bare 'by'", () => {
		expect(extractDeadline(["Please reply by 11/10/2026 if interested.", "Applications close 30 November 2026."], TODAY)).toBe("2026-11-30");
	});
	it("returns null for 'end of month' and for postings with no deadline", () => {
		expect(extractDeadline(["Apply by end of month"], TODAY)).toBeNull();
		expect(extractDeadline(["Great job", "Posted 2026-10-01"], TODAY)).toBeNull();
	});
});

describe("salary extraction", () => {
	it("reads ranges with k suffixes and an en dash", () => {
		expect(extractSalary("Compensation: $85k–$100k per year")).toBe("$85k–$100k per year");
		expect(extractSalary("Pay: $85k–$100k.")).toBe("$85k–$100k");
	});
	it("reads a single pound figure and currency codes", () => {
		expect(extractSalary("Salary £40,000 pro rata")).toBe("£40,000");
		expect(extractSalary("85,000 - 100,000 USD annually")).toBe("85,000 - 100,000 USD");
	});
	it("ignores small amounts", () => {
		expect(extractSalary("We cover a $25 lunch and a $500 learning budget.")).toBeNull();
	});
});

describe("whole posting", () => {
	const r = extractPosting(SAMPLE_POSTING, TODAY);
	it("guesses the title from the first line", () => {
		expect(r.titleGuess).toBe("Software Engineer, Data Platform");
	});
	it("finds deadline, salary, location, remote kind and emails", () => {
		expect(r.deadline).toBe("2026-11-30");
		expect(r.salary).toBe("$85k–$100k per year");
		expect(r.location).toBe("Denver, CO");
		expect(r.remote).toBe("hybrid");
		expect(r.emails).toEqual(["hiring@acme-analytics.example"]);
	});
	it("reads a Company: label and Location: label when present", () => {
		const text = "Research Assistant\nCompany: Mines Robotics Lab\nLocation: Golden, Colorado\nFully remote is not possible; on-site only.";
		const x = extractPosting(text, TODAY);
		expect(x.company).toBe("Mines Robotics Lab");
		expect(x.location).toBe("Golden, Colorado");
		expect(x.remote).toBe("on-site");
	});
	it("classifies remote wording", () => {
		expect(extractRemote("Remote (US time zones)")).toBe("remote");
		expect(extractRemote("This is not a remote position.")).toBe("on-site");
		expect(extractRemote("Hybrid: 3 days on-site")).toBe("hybrid");
		expect(extractRemote("A job")).toBeNull();
	});
	it("dedupes emails case-insensitively", () => {
		expect(extractEmails("Write to Jobs@X.org or jobs@x.org")).toEqual(["jobs@x.org"]);
	});
});
