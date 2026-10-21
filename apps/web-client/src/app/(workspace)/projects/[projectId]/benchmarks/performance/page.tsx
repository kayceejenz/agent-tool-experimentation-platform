import { getProject } from '@/lib/projects/server';
import { ModelPerformance } from '@/components/benchmarks/agent-performance';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string }>;
}) {
	const { projectId } = await params;
	const project = await getProject(projectId, 'benchmarks/performance');
	return <ModelPerformance project={project} />;
}
