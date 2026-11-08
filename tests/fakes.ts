import type { NoteInfo, VaultAccess } from "../src/core/vault";

/** In-memory vault for tests. */
export class FakeVault implements VaultAccess {
	private files = new Map<string, string>();
	private mtimes = new Map<string, number>();

	constructor(initial: Record<string, string> = {}, mtimeIso = "2026-11-01") {
		for (const [p, c] of Object.entries(initial)) {
			this.files.set(p, c);
			this.mtimes.set(p, Date.parse(`${mtimeIso}T12:00:00Z`));
		}
	}

	listNotes(): NoteInfo[] {
		return Array.from(this.files.keys())
			.filter((p) => p.endsWith(".md"))
			.map((path) => ({
				path,
				basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
				folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
				mtime: this.mtimes.get(path) ?? 0,
			}));
	}

	listFolders(): string[] {
		const out = new Set<string>();
		for (const path of this.files.keys()) {
			const parts = path.split("/");
			for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/"));
		}
		return Array.from(out).sort();
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const c = this.files.get(path);
		if (c === undefined) throw new Error(`Note not found: ${path}`);
		return c;
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`Already exists: ${path}`);
		this.files.set(path, content);
		this.mtimes.set(path, Date.now());
	}

	async modify(path: string, content: string): Promise<void> {
		if (!this.files.has(path)) throw new Error(`Note not found: ${path}`);
		this.files.set(path, content);
	}
}

export const SAMPLE_POSTING = `Software Engineer, Data Platform
Acme Analytics — Denver, CO (hybrid, 2 days in office)

About the role
We build the pipelines behind Acme's reporting products. You will own ingestion services written in Python and Go, and work with analysts to ship reliable datasets.

What you will need
- 2+ years writing production Python
- Experience with Apache Airflow or a similar orchestrator
- SQL and data modelling on a cloud warehouse (BigQuery or Snowflake)
- Comfortable with Docker and CI pipelines

Nice to have
- Go or Rust
- dbt

Compensation: $85k–$100k per year plus equity.
Applications close November 30, 2026. Questions to hiring@acme-analytics.example.
`;
