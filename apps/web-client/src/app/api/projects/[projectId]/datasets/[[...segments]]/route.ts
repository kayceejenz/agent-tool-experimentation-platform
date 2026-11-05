import { datasetRoute } from '@/lib/datasets/routes';

type Context = { params: Promise<{ projectId: string; segments?: string[] }> };

export async function GET(request: Request, context: Context) {
	const { projectId, segments } = await context.params;
	return datasetRoute(request, projectId, segments);
}

export async function POST(request: Request, context: Context) {
	const { projectId, segments } = await context.params;
	return datasetRoute(request, projectId, segments);
}

export async function DELETE(request: Request, context: Context) {
	const { projectId, segments } = await context.params;
	return datasetRoute(request, projectId, segments);
}
