import { promptRoute } from '@/lib/prompts/routes';

export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	const { projectId } = await context.params;
	return promptRoute(request, projectId);
}

export async function POST(
	request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	const { projectId } = await context.params;
	return promptRoute(request, projectId);
}
