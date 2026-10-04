import { toolRoute } from '@/lib/tools/routes';

export async function GET(
	request: Request,
	context: { params: Promise<{ projectId: string; toolId: string }> },
) {
	const { projectId, toolId } = await context.params;
	return toolRoute(request, projectId, toolId, true);
}

export async function POST(
	request: Request,
	context: { params: Promise<{ projectId: string; toolId: string }> },
) {
	const { projectId, toolId } = await context.params;
	return toolRoute(request, projectId, toolId, true);
}
