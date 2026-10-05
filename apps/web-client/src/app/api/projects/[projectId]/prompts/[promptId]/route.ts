import { promptRoute } from '@/lib/prompts/routes';

export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string; promptId: string }> },
) {
	const { projectId, promptId } = await context.params;
	return promptRoute(request, projectId, promptId);
}
