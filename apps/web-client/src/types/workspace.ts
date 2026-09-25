export type Project = { id: string; name: string; description: string };
export type Section =
	| 'servers'
	| 'tools'
	| 'experiments'
	| 'benchmarks'
	| 'prompts'
	| 'agents'
	| 'assistants'
	| 'runs'
	| 'settings';
