import { ProjectRows } from '@/components/projects/project-list';
import { ProjectSync } from '@/components/projects/project-provider';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Project } from '@/types/workspace';

export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children?: React.ReactNode;
}) {
	return (
		<header className='workspace-header'>
			<div>
				<h1>{title}</h1>
				<p>{description}</p>
			</div>
			{children}
		</header>
	);
}

export function ProjectList() {
	return (
		<>
			<PageHeader
				title='Projects'
				description='Keep connections, agents, and experiments together.'>
				<Link
					className='button primary'
					href='/projects/new'>
					Create project
				</Link>
			</PageHeader>
			<section className='panel'>
				<ProjectRows />
			</section>
		</>
	);
}

export function ProjectTabs({
	project,
	settings = false,
}: {
	project: Project;
	settings?: boolean;
}) {
	const base = `/projects/${project.id}`;
	return (
		<nav className='workspace-tabs' aria-label='Project pages'>
			<Link
				href={base}
				aria-current={!settings ? 'page' : undefined}>
				Overview
			</Link>
			<Link
				href={`${base}/settings`}
				aria-current={settings ? 'page' : undefined}>
				Settings
			</Link>
		</nav>
	);
}

export function ProjectOverview({ project }: { project: Project }) {
	const base = `/projects/${project.id}`;
	return (
		<>
			<PageHeader
				title={project.name}
				description={
					project.description ?? 'No description'
				}></PageHeader>
			<ProjectSync project={project} />
			<ProjectTabs project={project} />
			<section className='panel empty-state'>
				<h2>Start with a connection</h2>
				<p>
					Add an MCP server to configure the tools
					this project can connect to.
				</p>
				<Link
					className='button primary'
					href={`${base}/servers`}>
					View MCP Servers{' '}
					<ArrowRight size={16} />
				</Link>
			</section>
		</>
	);
}
