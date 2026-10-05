export type PromptType = 'system' | 'agent' | 'evaluation';

export type PromptSummary = {
	id: string;
	type: PromptType;
	revision: number;
	name: string;
	description: string;
	created_by: string;
	created_at: string;
};

export type Prompt = PromptSummary & { content: string };

export type PromptPage = { items: PromptSummary[]; next_offset: number | null };

export const promptTypes: Record<
	PromptType,
	{ label: string; description: string }
> = {
	system: {
		label: 'System',
		description: 'Shared instructions and behavioural rules.',
	},
	agent: {
		label: 'Agent',
		description: 'Instructions for an agent’s role and workflow.',
	},
	evaluation: {
		label: 'Evaluation',
		description:
			'Criteria for evaluating an agent’s execution and answer.',
	},
};
