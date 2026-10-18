import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects/server';
import { BenchmarkRunPage } from '@/components/benchmarks/run-details';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string; executionId: string }>;
}) {
	const { projectId, executionId } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(executionId)) notFound();
	const project = await getProject(
		projectId,
		`benchmarks/runs/${executionId}`,
	);
	return (
		<BenchmarkRunPage
			key={executionId}
			project={project}
			executionId={executionId}
		/>
	);
}
