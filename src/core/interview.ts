/**
 * Interview prep: likely questions drawn from the posting's requirements and keywords, each
 * with a line on what the interviewer is checking. No answers are drafted; the plugin knows
 * nothing about the user that it could truthfully put in one.
 */

import { parseJsonReply } from "./posting";

export interface InterviewQuestion {
	kind: "behavioural" | "technical";
	question: string;
	checking: string;
}

export const QUESTION_COUNT = 8;

export function interviewSystemPrompt(count = QUESTION_COUNT): string {
	return [
		`You prepare a candidate for an interview. Reply with one JSON object and nothing else.`,
		"Schema:",
		`{"questions": [{"kind": "behavioural"|"technical", "question": string, "checking": string}]}`,
		"Rules:",
		`- Exactly ${count} questions: about half behavioural (situations, teamwork, ownership) and half technical (the skills and tools the posting names).`,
		"- Every question must come from a requirement or keyword in the posting; do not ask about things the posting does not mention.",
		"- checking: one short sentence on what the interviewer is assessing with that question.",
		"- Do not write answers and do not assume anything about the candidate.",
	].join("\n");
}

export function interviewUserMessage(input: { company: string; role: string; requirements: string[]; niceToHave: string[]; keywords: string[] }): string {
	const list = (items: string[]) => (items.length ? items.map((r) => `- ${r}`).join("\n") : "(none listed)");
	return [`Posting: ${input.role} at ${input.company}`, "", "Requirements:", list(input.requirements), "", "Nice to have:", list(input.niceToHave), "", `Keywords: ${input.keywords.join(", ") || "(none)"}`, "", "Return the JSON object now."].join("\n");
}

/** Parses and caps the model reply; null when it is not JSON. */
export function parseInterviewQuestions(reply: string, max = QUESTION_COUNT): InterviewQuestion[] | null {
	const json = parseJsonReply(reply);
	if (!json) return null;
	const out: InterviewQuestion[] = [];
	const seen = new Set<string>();
	if (Array.isArray(json.questions)) {
		for (const q of json.questions) {
			if (!q || typeof q !== "object") continue;
			const o = q as Record<string, unknown>;
			const question = typeof o.question === "string" ? o.question.replace(/\s+/g, " ").trim().slice(0, 300) : "";
			if (!question) continue;
			const key = question.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			const kindRaw = typeof o.kind === "string" ? o.kind.toLowerCase() : "";
			const kind: InterviewQuestion["kind"] = /tech/.test(kindRaw) ? "technical" : "behavioural";
			const checking = typeof o.checking === "string" ? o.checking.replace(/\s+/g, " ").trim().slice(0, 200) : "";
			out.push({ kind, question, checking });
			if (out.length >= max) break;
		}
	}
	return out;
}

export function renderInterviewPrep(questions: InterviewQuestion[], meta: { today: string; model: string }): string {
	const lines = [`_Drafted ${meta.today} by ${meta.model} from this note's requirements and keywords. Write your own answers under each question; none are suggested._`, ""];
	questions.forEach((q, i) => {
		lines.push(`${i + 1}. **${q.question}** _(${q.kind})_`);
		if (q.checking) lines.push(`    - What they are checking: ${q.checking}`);
		lines.push(`    - My answer:`, "");
	});
	return lines.join("\n").trimEnd();
}
