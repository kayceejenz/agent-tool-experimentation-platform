import { toolRoute } from '@/lib/tools/routes';

export async function PATCH(
	request: Request,
	context: { params: Promise<{ projectId: string; toolId: string }> },
) {
	const { projectId, toolId } = await context.params;
	return toolRoute(request, projectId, toolId);
}

export async function GET(request: Request, context: { params: Promise<{ projectId: string; toolId: string }> }) {
    const { projectId, toolId } = await context.params;
    return toolRoute(request, projectId, toolId);
}
