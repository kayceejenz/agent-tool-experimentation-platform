import { promptRoute } from '@/lib/prompts/routes';

export async function GET(
	request: Request,
	context: {
		params: Promise<{
			projectId: string;
			promptId: string;
			revision: string;
		}>;
	},
) {
	const { projectId, promptId, revision } = await context.params;
	return promptRoute(request, projectId, promptId, true, revision);
}
