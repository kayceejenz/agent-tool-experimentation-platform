import { artifactRoute } from '@/lib/agents/artifact-routes';

export async function GET(
	request: Request,
	context: {
		params: Promise<{
			projectId: string;
			executionId: string;
			segments?: string[];
		}>;
	},
) {
	const { projectId, executionId, segments } = await context.params;
	return artifactRoute(request, projectId, executionId, segments);
}
