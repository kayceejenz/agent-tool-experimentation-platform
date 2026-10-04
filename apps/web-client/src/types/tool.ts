export type Schema = {
	type?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	description?: string;
	title?: string;
	default?: unknown;
	enum?: unknown[];
	[key: string]: unknown;
};
export type Tool = {
	id: string;
	server_id: string;
	server_name: string;
	server_enabled: boolean;
	name: string;
	revision: number;
	enabled: boolean;
	available: boolean;
	definition: {
		description?: string;
		input_schema: Schema;
		output_schema?: Schema;
		annotations?: { readOnlyHint?: boolean };
	};
};
export type ToolPage = { items: Tool[]; next_offset: number | null };
export type ToolExecution = {
	id: string;
	revision: number;
	status: 'running' | 'success' | 'tool_error' | 'unknown';
	inputs: unknown;
	result: unknown;
	error_code: string | null;
	duration_ms: number | null;
	created_at: string;
};
