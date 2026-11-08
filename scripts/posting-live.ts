// Live check of the extraction path against a real Ollama model: two realistic postings go
// through the plugin's own regex pass, prompt, client, JSON validation and merge, and the
// result is checked against what the postings actually say (dates above all).
//
//   npm run posting:live                  # 2 model calls
//   MODEL=qwen3.5:4b npm run posting:live
//
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { today } from "../src/core/dates";
import { extractPosting } from "../src/core/extract";
import { OllamaClient } from "../src/core/ollama";
import { extractionSystemPrompt, extractionUserMessage, mergePosting, parseJsonReply, validateModelPosting, type PostingFields } from "../src/core/posting";

const MODEL = process.env.MODEL ?? "qwen3.5:9b";
const URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const NUM_CTX = 16384;
// The bundle lives in .e2e/, so prompts and replies land in .e2e/posting-live-out/ (git-ignored).
const OUT_DIR = path.join(__dirname, "posting-live-out");

interface Sample {
	name: string;
	text: string;
	expect: Partial<Record<keyof PostingFields, unknown>> & { requirementsAtLeast: number; keywordsInclude: string[] };
}

const samples: Sample[] = [
	{
		name: "data platform engineer (US, hybrid, dated deadline)",
		text: `Software Engineer, Data Platform
Acme Analytics — Denver, CO (hybrid, 2 days in office)

About the role
We build the pipelines behind Acme's reporting products. You will own ingestion services written in Python and Go, and work with analysts to ship reliable datasets. You will join a team of six engineers reporting to the Head of Data Platform.

What you will need
- 2+ years writing production Python
- Experience with Apache Airflow or a similar orchestrator
- SQL and data modelling on a cloud warehouse (BigQuery or Snowflake)
- Comfortable with Docker and CI pipelines
- Clear written communication; you will write design docs

Nice to have
- Go or Rust
- dbt
- Experience with streaming (Kafka, Pub/Sub)

Compensation: $85k–$100k per year plus equity and a $1,500 learning budget.
Applications close November 30, 2026. Interviews start the week of December 7.
Questions to hiring@acme-analytics.example.`,
		expect: { company: "Acme Analytics", deadline: "2026-11-30", salary: "$85k–$100k per year", location: "Denver, CO", remote: "hybrid", requirementsAtLeast: 4, keywordsInclude: ["python", "airflow"] },
	},
	{
		name: "UK research assistant (on-site, numeric deadline, GBP)",
		text: `Research Assistant in Computational Materials Science
University of Northbridge, Department of Physics
Location: Northbridge, UK. This post is based on campus; remote working is not available.

The Carr group is hiring a Research Assistant to run and analyse density functional theory calculations of battery cathode materials. The post is fixed-term for 24 months in the first instance.

Essential criteria
- MSc (or equivalent experience) in physics, chemistry or materials science
- Experience with DFT codes such as VASP or Quantum ESPRESSO
- Scripting in Python for data analysis
- Experience using an HPC cluster with a job scheduler (Slurm)

Desirable
- Machine-learned interatomic potentials
- Publication record in a peer-reviewed journal

Salary: £36,000 to £40,000 per annum, grade 6.
Closing date: 15/12/2026 at 23:59 GMT. Informal enquiries to Dr A. Carr (a.carr@northbridge.ac.example).`,
		expect: { deadline: "2026-12-15", location: "Northbridge, UK", remote: "on-site", salary: "£36,000 to £40,000 per annum", requirementsAtLeast: 3, keywordsInclude: ["python"] },
	},
];

function fail(msg: string): never {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const client = new OllamaClient(() => URL);
	console.log(`Ollama ${await client.version()} at ${URL}, model ${MODEL}, today ${today()}\n`);
	let problems = 0;
	for (const sample of samples) {
		const date = today();
		const regex = extractPosting(sample.text, date);
		const t0 = Date.now();
		const reply = await client.chat({
			model: MODEL,
			messages: [
				{ role: "system", content: extractionSystemPrompt() },
				{ role: "user", content: extractionUserMessage(sample.text) },
			],
			options: { num_ctx: NUM_CTX, temperature: 0.1, top_p: 0.9, top_k: 20 },
			keep_alive: "10m",
			think: false,
			format: "json",
		});
		const secs = ((Date.now() - t0) / 1000).toFixed(1);
		writeFileSync(path.join(OUT_DIR, `${sample.name.replace(/[^a-z0-9]+/gi, "-")}.txt`), `--- system ---\n${extractionSystemPrompt()}\n\n--- user ---\n${extractionUserMessage(sample.text)}\n\n--- reply ---\n${reply}\n`);
		const json = parseJsonReply(reply);
		console.log(`== ${sample.name} · ${secs}s · ${reply.length} chars · JSON ${json ? "parsed" : "NOT PARSED"}`);
		if (!json) {
			problems++;
			console.log(reply.slice(0, 500));
			continue;
		}
		const model = validateModelPosting(json, date);
		console.log("regex :", JSON.stringify(regex));
		console.log("model :", JSON.stringify(model));
		const merged = mergePosting(regex, model);
		console.log("merged:", JSON.stringify(merged, null, 1));
		const checks: [string, boolean, string][] = [
			["model deadline parses to the right day", model.deadline === sample.expect.deadline, `model ${model.deadline} vs ${sample.expect.deadline}`],
			["merged deadline", merged.deadline === sample.expect.deadline, `${merged.deadline}`],
			["merged salary", merged.salary === sample.expect.salary, merged.salary],
			["merged location", merged.location === sample.expect.location, merged.location],
			["merged remote", merged.remote === sample.expect.remote, merged.remote],
			["company non-empty and not the placeholder", merged.company !== "Unknown company", merged.company],
			["role non-empty and not the placeholder", merged.role !== "Untitled role" && !/acme|northbridge/i.test(merged.role), merged.role],
			[`at least ${sample.expect.requirementsAtLeast} requirements`, merged.requirements.length >= sample.expect.requirementsAtLeast, String(merged.requirements.length)],
			["keywords include the obvious ones", sample.expect.keywordsInclude.every((k) => merged.keywords.some((x) => x.includes(k))), merged.keywords.join(", ")],
		];
		if (sample.expect.company) checks.push(["company matches", merged.company === sample.expect.company, merged.company]);
		for (const [name, ok, detail] of checks) {
			if (!ok) problems++;
			console.log(`  ${ok ? "ok  " : "FAIL"} ${name} — ${detail}`);
		}
		console.log();
	}
	console.log(problems === 0 ? "All checks passed." : `${problems} check(s) failed.`);
	process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
