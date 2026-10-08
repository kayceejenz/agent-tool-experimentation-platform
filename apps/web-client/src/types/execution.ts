export type ExecutionSpan = {
	id: string;
	sequence: number;
	parent_id: string | null;
	kind: 'model' | 'tool';
	name: string;
	status: string;
	call_id: string | null;
	tool_id: string | null;
	tool_revision: number | null;
	tool_execution_id: string | null;
	context_span_ids: string[];
	inputs: unknown;
	outputs: unknown;
	error_code: string | null;
	duration_ms: number | null;
};

export type ExecutionSummary = {
	id: string;
	agent_revision: number;
	input: string;
	status: string;
	termination_reason: string | null;
	created_at: string;
	finished_at: string | null;
};

export type Execution = ExecutionSummary & {
	final_answer: string | null;
	snapshot: unknown;
	spans: ExecutionSpan[];
};

export type ExecutionStatus = Pick<
	ExecutionSummary,
	'id' | 'status' | 'termination_reason' | 'finished_at'
> & {
	final_answer: string | null;
	model_turns: number;
	tool_calls: number;
	failure_hint: string | null;
};

export type ExecutionOverview = ExecutionSummary & ExecutionStatus;

export type SpanSummary = Omit<ExecutionSpan, 'inputs' | 'outputs'>;
