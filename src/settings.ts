export interface JobHuntSettings {
	ollamaUrl: string;
	model: string;
	numCtx: number;
	/** Folder for posting notes and the board. */
	jobsFolder: string;
	/** Vault path of the resume/CV note Tailor reads. */
	resumePath: string;
	/** Also write an .ics of upcoming deadlines when the board is refreshed. */
	exportIcs: boolean;
	icsPath: string;
}

export const DEFAULT_SETTINGS: JobHuntSettings = {
	ollamaUrl: "http://localhost:11434",
	model: "qwen3.5:9b",
	numCtx: 16384,
	jobsFolder: "Jobs",
	resumePath: "Resume.md",
	exportIcs: false,
	icsPath: "Jobs/deadlines.ics",
};
