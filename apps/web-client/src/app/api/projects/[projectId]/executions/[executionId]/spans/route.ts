import { traceRoute } from '@/lib/agents/execution-routes';
export async function GET(
	request: Request,
	context: {
		params: Promise<{ projectId: string; executionId: string }>;
	},
) {
	const params = await context.params;
	return traceRoute(
		request,
		params.projectId,
		params.executionId,
		'spans',
	);
}
