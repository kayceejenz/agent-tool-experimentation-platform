import { agentRoute } from '@/lib/agents/routes';
export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	const { projectId } = await context.params;
	return agentRoute(request, projectId);
}
export async function POST(
	request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	const { projectId } = await context.params;
	return agentRoute(request, projectId);
}
