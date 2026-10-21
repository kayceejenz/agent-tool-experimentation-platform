import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects/server';
import { BenchmarkComparison } from '@/components/benchmarks/comparison';

export default async function Page({
	params,
}: {
	params: Promise<{ projectId: string; benchmarkId: string }>;
}) {
	const { projectId, benchmarkId } = await params;
	if (!/^[0-9a-f-]{36}$/i.test(benchmarkId)) notFound();
	const project = await getProject(
		projectId,
		`benchmarks/${benchmarkId}`,
	);
	return (
		<BenchmarkComparison
			project={project}
			benchmarkId={benchmarkId}
		/>
	);
}
