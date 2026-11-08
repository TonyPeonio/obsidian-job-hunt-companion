import { Notice, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { BOARD_FILE, loadJobs, renderBoard } from "./core/board";
import { today } from "./core/dates";
import { extractPosting } from "./core/extract";
import { renderIcs } from "./core/ics";
import { interviewSystemPrompt, interviewUserMessage, parseInterviewQuestions, renderInterviewPrep } from "./core/interview";
import { parsePostingNote, postingFileName, renderPostingNote, type PostingNote } from "./core/note";
import { OllamaClient, explainOllamaError } from "./core/ollama";
import { emptyModelPosting, extractionSystemPrompt, extractionUserMessage, mergePosting, parseJsonReply, validateModelPosting, type ModelPosting } from "./core/posting";
import { appendToSection, upsertSection } from "./core/sections";
import { applyStatus, timelineLine } from "./core/status";
import { parseTailoring, renderTailoring, resumeBullets, tailorSystemPrompt, tailorUserMessage } from "./core/tailor";
import { writeNote } from "./core/vault";
import { ObsidianVault } from "./obsidian-vault";
import { PostingModal } from "./posting-modal";
import { DEFAULT_SETTINGS, type JobHuntSettings } from "./settings";
import { JobHuntSettingTab } from "./settings-tab";
import { StatusModal } from "./status-modal";

export default class JobHuntCompanionPlugin extends Plugin {
	settings: JobHuntSettings = { ...DEFAULT_SETTINGS };
	client!: OllamaClient;
	vault!: ObsidianVault;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.vault = new ObsidianVault(this.app);
		this.client = new OllamaClient(
			() => this.settings.ollamaUrl,
			(...args) => fetch(...args),
			async (url, body, method) => {
				const res = await requestUrl(method === "GET" ? { url, method, throw: false } : { url, method, contentType: "application/json", body, throw: false });
				return { status: res.status, text: res.text };
			},
		);
		this.addSettingTab(new JobHuntSettingTab(this.app, this));

		this.addRibbonIcon("briefcase", "Add a posting", () => void this.addPosting());
		this.addCommand({ id: "add-posting", name: "Add a posting", callback: () => void this.addPosting() });
		this.addCommand({ id: "open-board", name: "Open the board", callback: () => void this.openBoard() });
		this.addCommand({
			id: "change-status",
			name: "Change status",
			checkCallback: (checking) => {
				const file = this.activePostingFile();
				if (!file) return false;
				if (!checking) void this.changeStatus(file);
				return true;
			},
		});
		this.addCommand({
			id: "tailor",
			name: "Tailor resume to this posting",
			checkCallback: (checking) => {
				const file = this.activePostingFile();
				if (!file) return false;
				if (!checking) void this.tailor(file);
				return true;
			},
		});
		this.addCommand({
			id: "interview-prep",
			name: "Draft interview prep",
			checkCallback: (checking) => {
				const file = this.activePostingFile();
				if (!file) return false;
				if (!checking) void this.interviewPrep(file);
				return true;
			},
		});
	}

	// ---------------------------------------------------------------- commands

	async addPosting(): Promise<void> {
		const modelAvailable = await this.modelReachable();
		const modal = new PostingModal(this.app, modelAvailable);
		modal.open();
		const input = await modal.result;
		if (!input) return;
		const date = today();
		const regex = extractPosting(input.text, date);
		let model: ModelPosting = emptyModelPosting();
		let modelNote = "";
		if (modelAvailable) {
			const notice = new Notice(`Reading the posting with ${this.settings.model}…`, 0);
			try {
				const reply = await this.client.chat({
					model: this.settings.model,
					messages: [
						{ role: "system", content: extractionSystemPrompt() },
						{ role: "user", content: extractionUserMessage(input.text) },
					],
					options: { num_ctx: this.settings.numCtx, temperature: 0.1, top_p: 0.9, top_k: 20 },
					keep_alive: "10m",
					think: false,
					format: "json",
				});
				const json = parseJsonReply(reply);
				if (!json) modelNote = " The model's reply was not JSON, so only the deterministic pass was used.";
				model = validateModelPosting(json, date);
			} catch (err) {
				modelNote = ` ${explainOllamaError(err, this.settings.model, this.settings.ollamaUrl)} Only the deterministic pass was used.`;
			} finally {
				notice.hide();
			}
		} else {
			modelNote = " Ollama was not reachable, so only the deterministic pass was used.";
		}
		const fields = mergePosting(regex, model);
		const content = renderPostingNote({ ...fields, url: input.url, postingText: input.text, today: date });
		const path = this.freePath(normalizePath(`${this.settings.jobsFolder}/${postingFileName(fields.company, fields.role)}`));
		await writeNote(this.vault, path, content);
		await this.app.workspace.openLinkText(path, "", false);
		const found = [fields.deadline ? `deadline ${fields.deadline}` : "no deadline found", fields.salary ? `salary ${fields.salary}` : null, `${fields.requirements.length} requirements`].filter(Boolean).join(", ");
		new Notice(`Added ${fields.company} — ${fields.role} (${found}).${modelNote}`, modelNote ? 10000 : 6000);
	}

	async changeStatus(file: TFile): Promise<void> {
		const note = parsePostingNote(await this.app.vault.read(file));
		if (!note) {
			new Notice("This note is not a posting note (it needs company, role and status in its properties).");
			return;
		}
		const modal = new StatusModal(this.app, note.status);
		modal.open();
		const status = await modal.result;
		if (!status || status === note.status) return;
		const date = today();
		await this.app.vault.process(file, (content) => applyStatus(content, note.status, status, date, note.appliedOn));
		new Notice(`${note.company} — ${note.role}: ${note.status} → ${status}.`);
	}

	async openBoard(): Promise<void> {
		const date = today();
		const jobs = await loadJobs(this.vault, this.settings.jobsFolder);
		const path = normalizePath(`${this.settings.jobsFolder}/${BOARD_FILE}`);
		await writeNote(this.vault, path, renderBoard(jobs, date));
		let extra = "";
		if (this.settings.exportIcs) {
			const icsPath = normalizePath(this.settings.icsPath);
			await writeNote(this.vault, icsPath, renderIcs(jobs, date, new Date()));
			extra = ` Deadlines exported to ${icsPath}.`;
		}
		await this.app.workspace.openLinkText(path, "", false);
		new Notice(`Board refreshed from ${jobs.length} posting${jobs.length === 1 ? "" : "s"}.${extra}`);
	}

	async tailor(file: TFile): Promise<void> {
		const note = await this.readPosting(file);
		if (!note) return;
		const resumePath = normalizePath(this.settings.resumePath);
		if (!this.vault.exists(resumePath)) {
			new Notice(`Resume note not found at ${resumePath}. Set its path in settings.`, 8000);
			return;
		}
		const resumeText = await this.vault.read(resumePath);
		if (resumeBullets(resumeText).length === 0) {
			new Notice(`${resumePath} has no bullet lines. Tailor quotes "- " bullets from the resume, so write your experience as bullets.`, 8000);
			return;
		}
		if (note.requirements.length === 0) {
			new Notice("This posting has no requirements listed. Add some under ## Requirements first.", 8000);
			return;
		}
		const input = { company: note.company, role: note.role, requirements: note.requirements, keywords: note.keywords, resumeText };
		const notice = new Notice(`Comparing the resume with the posting using ${this.settings.model}…`, 0);
		try {
			const reply = await this.client.chat({
				model: this.settings.model,
				messages: [
					{ role: "system", content: tailorSystemPrompt() },
					{ role: "user", content: tailorUserMessage(input) },
				],
				options: { num_ctx: this.settings.numCtx, temperature: 0.3, top_p: 0.9, top_k: 20 },
				keep_alive: "10m",
				think: false,
				format: "json",
			});
			const tailoring = parseTailoring(reply, input);
			if (!tailoring) throw new Error("The model's reply was not JSON. Try again or pick a larger model.");
			const date = today();
			const section = renderTailoring(tailoring, { today: date, model: this.settings.model, resumePath });
			await this.app.vault.process(file, (content) => appendToSection(upsertSection(content, "Tailoring", section), "Timeline", timelineLine(date, "tailoring written")));
			notice.hide();
			new Notice(`Tailoring written: ${tailoring.matches.length} matches, ${tailoring.gaps.length} gaps, ${tailoring.rewordings.length} rewordings${tailoring.dropped ? `; ${tailoring.dropped} ungrounded quotes dropped` : ""}.`, 8000);
		} catch (err) {
			notice.hide();
			new Notice(explainOllamaError(err, this.settings.model, this.settings.ollamaUrl), 10000);
		}
	}

	async interviewPrep(file: TFile): Promise<void> {
		const note = await this.readPosting(file);
		if (!note) return;
		if (note.requirements.length === 0 && note.keywords.length === 0) {
			new Notice("This posting has no requirements or keywords to draw questions from. Add some under ## Requirements first.", 8000);
			return;
		}
		const notice = new Notice(`Drafting interview questions with ${this.settings.model}…`, 0);
		try {
			const reply = await this.client.chat({
				model: this.settings.model,
				messages: [
					{ role: "system", content: interviewSystemPrompt() },
					{ role: "user", content: interviewUserMessage(note) },
				],
				options: { num_ctx: this.settings.numCtx, temperature: 0.3, top_p: 0.9, top_k: 20 },
				keep_alive: "10m",
				think: false,
				format: "json",
			});
			const questions = parseInterviewQuestions(reply);
			if (!questions) throw new Error("The model's reply was not JSON. Try again or pick a larger model.");
			if (questions.length === 0) throw new Error("The model returned no questions. Try again.");
			const date = today();
			const section = renderInterviewPrep(questions, { today: date, model: this.settings.model });
			await this.app.vault.process(file, (content) => appendToSection(upsertSection(content, "Interview prep", section), "Timeline", timelineLine(date, "interview prep drafted")));
			notice.hide();
			new Notice(`${questions.length} interview questions written under "Interview prep".`);
		} catch (err) {
			notice.hide();
			new Notice(explainOllamaError(err, this.settings.model, this.settings.ollamaUrl), 10000);
		}
	}

	// ---------------------------------------------------------------- helpers

	private async readPosting(file: TFile): Promise<PostingNote | null> {
		const note = parsePostingNote(await this.app.vault.read(file));
		if (!note) new Notice("This note is not a posting note (it needs company, role and status in its properties).");
		return note;
	}

	/** The open note when it is a posting note. */
	private activePostingFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return fm && typeof fm.company === "string" && typeof fm.role === "string" && typeof fm.status === "string" ? file : null;
	}

	/** `path`, or `path (2)`, `path (3)`… when a note is already there. */
	private freePath(path: string): string {
		if (!this.vault.exists(path)) return path;
		const base = path.replace(/\.md$/, "");
		for (let i = 2; ; i++) {
			const candidate = `${base} (${i}).md`;
			if (!this.vault.exists(candidate)) return candidate;
		}
	}

	private async modelReachable(): Promise<boolean> {
		try {
			await Promise.race([this.client.version(), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 2500))]);
			return true;
		} catch {
			return false;
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<JobHuntSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
