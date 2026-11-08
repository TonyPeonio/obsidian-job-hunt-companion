import { describe, expect, it } from "vitest";
import { extractPosting } from "../src/core/extract";
import { emptyModelPosting, extractionSystemPrompt, extractionUserMessage, mergePosting, parseJsonReply, validateModelPosting } from "../src/core/posting";
import { SAMPLE_POSTING } from "./fakes";

const TODAY = "2026-11-07";

describe("model JSON parsing", () => {
	it("finds the object inside fences, prose and think blocks", () => {
		const reply = '<think>hmm</think>Sure! ```json\n{"company": "Acme", "role": "Eng"}\n```\nDone.';
		expect(parseJsonReply(reply)).toEqual({ company: "Acme", role: "Eng" });
	});
	it("handles braces inside strings", () => {
		expect(parseJsonReply('{"role": "Lead {Platform} Eng", "x": "}"}')).toEqual({ role: "Lead {Platform} Eng", x: "}" });
	});
	it("returns null for non-JSON and arrays", () => {
		expect(parseJsonReply("no json here")).toBeNull();
		expect(parseJsonReply("[1,2]")).toBeNull();
		expect(parseJsonReply('{"a": ')).toBeNull();
	});
});

describe("model output validation", () => {
	it("coerces types, caps lists, dedupes and lowercases keywords", () => {
		const v = validateModelPosting(
			{
				company: "  Acme  Analytics ",
				role: 42,
				location: null,
				remote: "Hybrid",
				deadline: "November 30, 2026",
				salary: "$85k–$100k",
				requirements: Array.from({ length: 12 }, (_, i) => `req ${i}`),
				nice_to_have: ["Go", "go", "dbt", 7, ""],
				keywords: ["Python", "Airflow", "python"],
			},
			TODAY,
		);
		expect(v.company).toBe("Acme Analytics");
		expect(v.role).toBeNull();
		expect(v.remote).toBe("hybrid");
		expect(v.deadline).toBe("2026-11-30");
		expect(v.requirements).toHaveLength(8);
		expect(v.niceToHave).toEqual(["Go", "dbt"]);
		expect(v.keywords).toEqual(["python", "airflow"]);
	});
	it("never trusts a model date it cannot parse, and rejects unknown remote values", () => {
		const v = validateModelPosting({ deadline: "end of the quarter", remote: "sometimes" }, TODAY);
		expect(v.deadline).toBeNull();
		expect(v.remote).toBeNull();
	});
	it("tolerates a null reply", () => {
		expect(validateModelPosting(null, TODAY)).toEqual(emptyModelPosting());
	});
});

describe("merge", () => {
	it("lets regex facts win and the model fill the rest", () => {
		const regex = extractPosting(SAMPLE_POSTING, TODAY);
		const model = validateModelPosting({ company: "Acme Analytics", role: "Software Engineer, Data Platform", location: "Boulder, CO", remote: "remote", deadline: "2026-12-15", salary: "$90k", requirements: ["2+ years Python"], keywords: ["python"] }, TODAY);
		const merged = mergePosting(regex, model);
		expect(merged.company).toBe("Acme Analytics");
		expect(merged.deadline).toBe("2026-11-30");
		expect(merged.salary).toBe("$85k–$100k per year");
		expect(merged.location).toBe("Denver, CO");
		expect(merged.remote).toBe("hybrid");
		expect(merged.requirements).toEqual(["2+ years Python"]);
		expect(merged.emails).toEqual(["hiring@acme-analytics.example"]);
	});
	it("falls back to the title guess and placeholders without a model", () => {
		const merged = mergePosting(extractPosting(SAMPLE_POSTING, TODAY), emptyModelPosting());
		expect(merged.role).toBe("Software Engineer, Data Platform");
		expect(merged.company).toBe("Unknown company");
		expect(merged.requirements).toEqual([]);
	});
});

describe("extraction prompt", () => {
	it("asks for JSON only, names every schema key and carries the posting verbatim", () => {
		const sys = extractionSystemPrompt();
		for (const key of ["company", "role", "location", "remote", "deadline", "salary", "requirements", "nice_to_have", "keywords"]) expect(sys).toContain(`"${key}"`);
		expect(sys).toMatch(/JSON object and nothing else/);
		expect(sys).toMatch(/exactly as written/);
		expect(extractionUserMessage(SAMPLE_POSTING)).toContain("Applications close November 30, 2026.");
	});
});
