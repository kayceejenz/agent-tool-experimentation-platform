export type Project = {
	id: string;
	name: string;
	description: string | null;
	role: 'owner' | 'editor' | 'viewer';
	hidden_sections?: string[];
	created_by: string;
	created_at: string;
	updated_at: string;
};

export type Section =
	| 'datasets'
	| 'servers'
	| 'tools'
	| 'experiments'
	| 'benchmarks'
	| 'prompts'
	| 'agents'
	| 'assistants'
	| 'runs'
	| 'settings';
