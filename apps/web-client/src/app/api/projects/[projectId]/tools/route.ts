import { toolRoute } from '@/lib/tools/routes';

export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string }> },
) {
	const { projectId } = await context.params;
	return toolRoute(request, projectId);
}
