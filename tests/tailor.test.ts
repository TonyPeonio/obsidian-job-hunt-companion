import { describe, expect, it } from "vitest";
import { interviewSystemPrompt, interviewUserMessage, parseInterviewQuestions, renderInterviewPrep } from "../src/core/interview";
import { bulletInResume, parseTailoring, renderTailoring, resumeBullets, tailorSystemPrompt, tailorUserMessage, type TailorInput } from "../src/core/tailor";

const RESUME = `# Tony Example

## Experience

**Data Engineering Intern, Widgets Co** (2025)
- Built an Airflow DAG that loads 40 GB/day of sensor data into BigQuery
- Wrote Python ingestion services with pytest coverage above 90%
- Containerised the pipeline with Docker and GitHub Actions

## Projects
1. Rust CLI for parsing lab notebooks
- a b
`;

const input: TailorInput = {
	company: "Acme Analytics",
	role: "Software Engineer, Data Platform",
	requirements: ["2+ years writing production Python", "Experience with Apache Airflow or a similar orchestrator", "SQL and data modelling on a cloud warehouse"],
	keywords: ["python", "airflow", "bigquery", "dbt", "go"],
	resumeText: RESUME,
};

describe("tailoring", () => {
	it("extracts bullet lines from the resume (three words or more)", () => {
		expect(resumeBullets(RESUME)).toEqual(["Built an Airflow DAG that loads 40 GB/day of sensor data into BigQuery", "Wrote Python ingestion services with pytest coverage above 90%", "Containerised the pipeline with Docker and GitHub Actions", "Rust CLI for parsing lab notebooks"]);
	});
	it("grounds quotes loosely on punctuation and case but not on content", () => {
		expect(bulletInResume("built an **Airflow** DAG that loads 40 GB/day of sensor data into BigQuery.", RESUME)).toBe(true);
		expect(bulletInResume("- Wrote Python ingestion services", RESUME)).toBe(true);
		expect(bulletInResume("Led a team of five engineers", RESUME)).toBe(false);
		expect(bulletInResume("Python", RESUME)).toBe(false);
	});
	it("drops quoted bullets that are not in the resume and counts them", () => {
		const reply = JSON.stringify({
			matches: [
				{ requirement: "2+ years writing production Python", bullet: "Wrote Python ingestion services with pytest coverage above 90%" },
				{ requirement: "Experience with Apache Airflow or a similar orchestrator", bullet: "Built an Airflow DAG that loads 40 GB/day of sensor data into BigQuery" },
				{ requirement: "SQL and data modelling on a cloud warehouse", bullet: "Designed a star schema in Snowflake for finance reporting" },
				{ requirement: "2+ years writing production Python", bullet: "Wrote Python ingestion services with pytest coverage above 90%" },
			],
			gaps: ["dbt", "Go", "dbt", "SQL data modelling", "x", "y", "z"],
			rewordings: [
				{ original: "Wrote Python ingestion services with pytest coverage above 90%", suggestion: "Wrote production Python ingestion services (pytest coverage above 90%)" },
				{ original: "Shipped a dbt project", suggestion: "Shipped a dbt project for analysts" },
			],
		});
		const t = parseTailoring(reply, input)!;
		expect(t.matches).toHaveLength(2);
		expect(t.matches.map((m) => m.requirement)).toEqual(["2+ years writing production Python", "Experience with Apache Airflow or a similar orchestrator"]);
		expect(t.gaps).toEqual(["dbt", "Go", "SQL data modelling", "x", "y"]);
		expect(t.rewordings).toHaveLength(1);
		expect(t.dropped).toBe(2);
	});
	it("returns null for a non-JSON reply and empty sets for an empty object", () => {
		expect(parseTailoring("I cannot do that.", input)).toBeNull();
		expect(parseTailoring("{}", input)).toEqual({ matches: [], gaps: [], rewordings: [], dropped: 0 });
	});
	it("renders the section with the dropped count and the suggestion marking", () => {
		const text = renderTailoring({ matches: [{ requirement: "R", bullet: "B" }], gaps: ["g"], rewordings: [{ original: "o", suggestion: "s" }], dropped: 1 }, { today: "2026-11-07", model: "qwen3.5:9b", resumePath: "Resume.md" });
		expect(text).toContain("[[Resume]]");
		expect(text).toContain("the resume was not changed");
		expect(text).toContain('- **R** — "B"');
		expect(text).toContain("### Keyword gaps\n\n- g");
		expect(text).toContain("_Suggestions, not edits.");
		expect(text).toContain('- Now: "o"\n  - Suggestion: s');
		expect(text).toContain("_1 quoted bullet was not found in the resume and was dropped._");
	});
	it("builds prompts with the grounding rule, the requirement list and the resume", () => {
		const sys = tailorSystemPrompt();
		expect(sys).toMatch(/VERBATIM/);
		expect(sys).toMatch(/Only text that appears in the resume may be quoted/);
		expect(sys).toContain('"rewordings"');
		const user = tailorUserMessage(input);
		expect(user).toContain("1. 2+ years writing production Python");
		expect(user).toContain("Keywords: python, airflow, bigquery, dbt, go");
		expect(user).toContain("Built an Airflow DAG");
	});
});

describe("interview prep", () => {
	it("caps at eight, dedupes, normalises kinds", () => {
		const questions = Array.from({ length: 11 }, (_, i) => ({ kind: i % 2 ? "Technical" : "behavioral", question: `Question ${i % 10}?`, checking: `check ${i}` }));
		const parsed = parseInterviewQuestions(JSON.stringify({ questions }))!;
		expect(parsed).toHaveLength(8);
		expect(parsed[0]).toEqual({ kind: "behavioural", question: "Question 0?", checking: "check 0" });
		expect(parsed[1].kind).toBe("technical");
		expect(parseInterviewQuestions("nope")).toBeNull();
		expect(parseInterviewQuestions('{"questions": "x"}')).toEqual([]);
	});
	it("renders numbered questions with the check line and an empty answer slot, no answers", () => {
		const text = renderInterviewPrep([{ kind: "technical", question: "How would you backfill a failed Airflow run?", checking: "Operational judgement." }], { today: "2026-11-07", model: "m" });
		expect(text).toContain("1. **How would you backfill a failed Airflow run?** _(technical)_\n    - What they are checking: Operational judgement.\n    - My answer:");
		expect(text).toContain("none are suggested");
	});
	it("builds prompts that ask for exactly eight grounded questions", () => {
		expect(interviewSystemPrompt()).toContain("Exactly 8 questions");
		expect(interviewSystemPrompt()).toMatch(/do not assume anything about the candidate/);
		const user = interviewUserMessage({ company: "Acme", role: "Eng", requirements: ["Python"], niceToHave: [], keywords: ["airflow"] });
		expect(user).toContain("Requirements:\n- Python");
		expect(user).toContain("Nice to have:\n(none listed)");
		expect(user).toContain("Keywords: airflow");
	});
});
