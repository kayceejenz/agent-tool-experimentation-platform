import type { Section } from '@/types/workspace';

export const sections: Record<
	Section,
	{ title: string; description: string; empty: string }
> = {
	servers: {
		title: 'MCP Servers',
		description: 'Connect the systems your agents can work with.',
		empty: 'No servers connected',
	},
	tools: {
		title: 'Tools',
		description:
			'Inspect and control the tools available to this project.',
		empty: 'No tools discovered',
	},
	experiments: {
		title: 'Experiments',
		description:
			'Compare agent configurations against the same questions.',
		empty: 'No experiments yet',
	},
	benchmarks: {
		title: 'Benchmarks',
		description:
			'Define the questions and expectations that measure agent behavior.',
		empty: 'No benchmarks yet',
	},
	prompts: {
		title: 'Prompts',
		description: 'Manage the instructions that guide your agents.',
		empty: 'No prompts yet',
	},
	agents: {
		title: 'Agents',
		description:
			'Bring prompts, models, and selected tools together.',
		empty: 'No agents configured',
	},
	assistants: {
		title: 'Assistants',
		description:
			'Use agent configurations backed by experiment results.',
		empty: 'No assistants yet',
	},
	runs: {
		title: 'Runs',
		description:
			'Inspect execution traces, tool calls, and outcomes.',
		empty: 'No runs recorded',
	},
	settings: {
		title: 'Project settings',
		description: 'Project details and access.',
		empty: '',
	},
};
export function isSection(value: string): value is Section {
	return Object.hasOwn(sections, value);
}
