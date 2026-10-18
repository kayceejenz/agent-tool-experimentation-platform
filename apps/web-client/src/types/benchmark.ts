export type Capture = {
	id: string;
	tool_name: string;
	server_name: string;
	arguments: Record<string, unknown>;
	result: unknown;
};
export type Benchmark = {
	id: string;
	input: string;
	tool_name: string;
	server_name: string;
	arguments: Record<string, unknown>;
	execution_id: string | null;
	agent_name: string | null;
	agent_revision: number | null;
	final_answer?: string | null;
	status: string | null;
	termination_reason: string | null;
	calls: { name: string; inputs: unknown; status: string }[];
	score: {
		actual_count: number;
		matched_count: number;
		arguments_correct: boolean | null;
	} | null;
};
export type BenchmarkPage = {
	items: Benchmark[];
	agent_revision: number | null;
	metrics: {
		scored: number;
		precision: number | null;
		recall: number | null;
		arguments: number | null;
	};
};
