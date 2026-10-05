export type Reference = { id: string; revision: number };
export type PromptBinding = Reference & {
	name: string;
	content: string;
	latest_revision: number;
};
export type ToolBinding = Reference & {
	name: string;
	server_id: string;
	server_name: string;
	latest_revision: number;
	enabled: boolean;
	available: boolean;
	server_enabled: boolean;
};
export type AgentConfig = {
	name: string;
	description: string;
	system_prompt: Reference | null;
	agent_prompt: Reference | null;
	model_settings: {
		provider: string;
		model: string;
		temperature: number | null;
	};
	tools: Reference[];
	limits: {
		max_turns: number;
		max_tool_calls: number;
		timeout_seconds: number;
		max_output_tokens: number;
	};
};
export type AgentSummary = {
	id: string;
	name: string;
	description: string;
	revision: number;
	enabled: boolean;
	tool_count: number;
	model_settings: AgentConfig['model_settings'];
	created_at: string;
};
export type Agent = Omit<AgentSummary, 'tool_count'> & {
	current_revision: number;
	system_prompt: PromptBinding | null;
	agent_prompt: PromptBinding | null;
	tools: ToolBinding[];
	limits: AgentConfig['limits'];
	configuration_issues: string[];
	configuration_ready: boolean;
	runtime_available: false;
};
export type AgentPage = { items: AgentSummary[]; next_offset: number | null };
export function configOf(agent: Agent): AgentConfig {
	const reference = (value: Reference | null) =>
		value ? { id: value.id, revision: value.revision } : null;
	return {
		name: agent.name,
		description: agent.description,
		system_prompt: reference(agent.system_prompt),
		agent_prompt: reference(agent.agent_prompt),
		model_settings: agent.model_settings,
		limits: agent.limits,
		tools: agent.tools
			.map((t) => ({ id: t.id, revision: t.revision }))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
}
export const newAgent: AgentConfig = {
	name: '',
	description: '',
	system_prompt: null,
	agent_prompt: null,
	model_settings: { provider: '', model: '', temperature: null },
	tools: [],
	limits: {
		max_turns: 8,
		max_tool_calls: 10,
		timeout_seconds: 60,
		max_output_tokens: 2048,
	},
};
