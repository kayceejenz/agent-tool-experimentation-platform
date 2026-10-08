import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectSync } from '@/components/projects/project-provider';
import { PageHeader, ProjectTabs } from './workspace-views';
import { sections } from '@/lib/workspace';

import type { Project, Section } from '@/types/workspace';

const Agents = dynamic(
	() =>
		import('@/components/agents/agents').then(
			module => module.Agents,
		),
	{ loading: () => <p role='status'>Loading agents…</p> },
);

const Prompts = dynamic(
	() =>
		import('@/components/prompts/prompts').then(
			module => module.Prompts,
		),
	{ loading: () => <p role='status'>Loading prompts…</p> },
);
const Tools = dynamic(
	() => import('@/components/tools/tools').then(module => module.Tools),
	{ loading: () => <p role='status'>Loading tools…</p> },
);
const McpServers = dynamic(
	() =>
		import('@/components/mcp-servers/mcp-servers').then(
			module => module.McpServers,
		),
	{ loading: () => <p role='status'>Loading mcpservers…</p> },
);

export function SectionView({
	project,
	section,
}: {
	project: Project;
	section: Section;
}) {
	if (section === 'agents')
		return <Agents key={project.id} project={project} />;
	if (section === 'prompts')
		return <Prompts key={project.id} project={project} />;
	if (section === 'tools')
		return <Tools key={project.id} project={project} />;
	if (section === 'servers')
		return <McpServers key={project.id} project={project} />;
	const details = sections[section];
	return (
		<>
			<PageHeader
				title={details.title}
				description={details.description}>
				<span className='badge'>{project.name}</span>
			</PageHeader>
			{section === 'settings' ? (
				<>
					<ProjectTabs
						project={project}
						settings
					/>
					<ProjectSync project={project} />
					<section className='panel'>
						<ProjectForm
							key={project.id}
							project={project}
						/>
					</section>
				</>
			) : (
				<section className='panel empty-state'>
					<ProjectSync project={project} />
					<h2>{details.empty}</h2>
					<p>
						{details.title} is not available
						yet.
					</p>
					<Link
						className='button'
						href={`/projects/${project.id}`}>
						Back to project{' '}
						<ArrowRight size={16} />
					</Link>
				</section>
			)}
		</>
	);
}
