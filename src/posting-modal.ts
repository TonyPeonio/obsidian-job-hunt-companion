import { App, Modal, Setting } from "obsidian";

export interface PostingInput {
	text: string;
	url: string;
}

/** Asks for the pasted posting text and, optionally, its URL. Resolves null when cancelled. */
export class PostingModal extends Modal {
	private resolve!: (r: PostingInput | null) => void;
	readonly result: Promise<PostingInput | null>;
	private done = false;
	private input: PostingInput = { text: "", url: "" };
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private modelAvailable: boolean,
	) {
		super(app);
		this.result = new Promise((res) => (this.resolve = res));
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("jhc-modal");
		titleEl.setText("Add a posting");
		contentEl.createEl("p", {
			cls: "jhc-modal-help",
			text: this.modelAvailable
				? "Paste the posting text. Dates, salary, location and contact emails are read deterministically; the local model fills in company, role, requirements and keywords. The posting is kept verbatim in the note."
				: "Paste the posting text. Ollama is not reachable, so only the deterministic pass runs: dates, salary, location and emails. Requirements and keywords can be added to the note by hand.",
		});

		new Setting(contentEl)
			.setName("Posting URL")
			.setDesc("Optional.")
			.addText((t) => {
				t.setPlaceholder("https://…").onChange((v) => (this.input.url = v.trim()));
				t.inputEl.addClass("jhc-modal-wide");
			});

		const textarea = contentEl.createEl("textarea", { cls: "jhc-modal-textarea", attr: { rows: "16", placeholder: "Paste the job posting here…" } });
		textarea.addEventListener("input", () => (this.input.text = textarea.value));

		this.errorEl = contentEl.createEl("p", { cls: "jhc-modal-error" });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((b) =>
				b
					.setButtonText("Add posting")
					.setCta()
					.onClick(() => {
						if (this.input.text.trim().length < 40) {
							this.errorEl?.setText("Paste the posting text first (at least a few lines).");
							return;
						}
						if (this.input.url && !/^https?:\/\//i.test(this.input.url)) {
							this.errorEl?.setText("The URL should start with http:// or https://.");
							return;
						}
						this.finish(this.input);
					}),
			);
		textarea.focus();
	}

	private finish(r: PostingInput | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(r);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}
