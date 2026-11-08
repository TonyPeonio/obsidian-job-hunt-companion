import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type JobHuntCompanionPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

export class JobHuntSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: JobHuntCompanionPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl).setName("Notes").setHeading();

		new Setting(containerEl)
			.setName("Jobs folder")
			.setDesc("Posting notes and the board are written here.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.jobsFolder).setValue(s.jobsFolder).onChange(async (v) => {
					s.jobsFolder = normalizePath(v.trim() || DEFAULT_SETTINGS.jobsFolder);
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Resume note")
			.setDesc("Vault path of your resume or CV note. Tailor quotes its bullet lines and never edits it.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.resumePath).setValue(s.resumePath).onChange(async (v) => {
					let p = normalizePath(v.trim() || DEFAULT_SETTINGS.resumePath);
					if (!p.endsWith(".md")) p += ".md";
					s.resumePath = p;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Export deadlines as a calendar file")
			.setDesc("When the board is refreshed, also write an .ics of upcoming deadlines (all-day events) that a calendar app can import.")
			.addToggle((t) =>
				t.setValue(s.exportIcs).onChange(async (v) => {
					s.exportIcs = v;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (s.exportIcs) {
			new Setting(containerEl)
				.setName("Calendar file path")
				.addText((t) =>
					t.setPlaceholder(DEFAULT_SETTINGS.icsPath).setValue(s.icsPath).onChange(async (v) => {
						s.icsPath = normalizePath(v.trim() || DEFAULT_SETTINGS.icsPath);
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl).setName("Local model").setHeading();

		new Setting(containerEl)
			.setName("Ollama URL")
			.setDesc("Where Ollama is listening. Used for extraction, tailoring and interview prep; the board and the deterministic pass work without it.")
			.addText((t) =>
				t.setPlaceholder(DEFAULT_SETTINGS.ollamaUrl).setValue(s.ollamaUrl).onChange(async (v) => {
					s.ollamaUrl = v.trim() || DEFAULT_SETTINGS.ollamaUrl;
					await this.plugin.saveSettings();
				}),
			)
			.addButton((b) =>
				b.setButtonText("Test connection").onClick(async () => {
					try {
						const version = await this.plugin.client.version();
						const models = await this.plugin.client.listModels();
						const has = models.some((m) => m.name === s.model);
						new Notice(`Connected to Ollama ${version} (${models.length} models).${has ? "" : ` Model "${s.model}" is not installed: run \`ollama pull ${s.model}\`.`}`, 8000);
					} catch (err) {
						new Notice(`Connection failed: ${(err as Error).message}`, 8000);
					}
				}),
			);

		const modelSetting = new Setting(containerEl).setName("Chat model").setDesc("Any Ollama chat model. qwen3.5:9b fits a 12 GB GPU; qwen3.5:4b for smaller cards.");
		modelSetting.addDropdown(async (d) => {
			d.addOption(s.model, s.model);
			d.setValue(s.model);
			try {
				const models = await this.plugin.client.listModels();
				d.selectEl.empty();
				const names = models.filter((m) => !/embed/i.test(m.name)).map((m) => m.name);
				if (!names.includes(s.model)) names.unshift(s.model);
				for (const n of names) d.addOption(n, n);
				d.setValue(s.model);
			} catch {
				// Ollama unreachable: keep the single current value.
			}
			d.onChange(async (v) => {
				s.model = v;
				await this.plugin.saveSettings();
			});
		});
		modelSetting.addText((t) =>
			t.setPlaceholder("or type a model name").onChange(async (v) => {
				if (!v.trim()) return;
				s.model = v.trim();
				await this.plugin.saveSettings();
			}),
		);

		new Setting(containerEl)
			.setName("Context window (num_ctx)")
			.setDesc("Tokens the model can see. A posting plus a resume fits comfortably in 16384.")
			.addText((t) =>
				t.setValue(String(s.numCtx)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n >= 2048 && n <= 262144) {
						s.numCtx = n;
						await this.plugin.saveSettings();
					}
				}),
			);
	}
}
