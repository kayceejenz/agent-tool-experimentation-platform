import { McpServers } from '@/components/mcp-servers/mcp-servers';
import { ProjectRows } from '@/components/projects/project-list';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectSync } from '@/components/projects/project-provider';
import Link from 'next/link';
import { ArrowRight, Workflow } from 'lucide-react';
import { sections } from '@/lib/workspace';
import type { Project, Section } from '@/types/workspace';

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

export function Overview() {
	return (
		<>
			<PageHeader
				title='Workspace overview'
				description='Understand how your agents select tools and solve tasks.'>
				<Link
					className='button primary'
					href='/projects'>
					View projects <ArrowRight size={16} />
				</Link>
			</PageHeader>
			<section className='welcome-panel'>
				<span className='eyebrow'>
					Agent experimentation
				</span>
				<h2>
					From connected tools
					<br />
					to tested behavior.
				</h2>
				<p>
					Connect your systems, configure an
					agent, and inspect every step. Build
					confidence through repeatable
					experiments.
				</p>
				<Link className='text-link' href='/projects'>
					View projects <ArrowRight size={16} />
				</Link>
				<div className='welcome-mark' aria-hidden>
					<Workflow size={110} strokeWidth={1} />
				</div>
			</section>
			<div className='section-heading'>
				<h2>Your workflow</h2>
				<span>Build one step at a time</span>
			</div>
			<ol className='workflow-steps'>
				{[
					{
						title: 'Connect tools',
						description:
							'Discover what your systems can do.',
					},
					{
						title: 'Configure agents',
						description:
							'Choose instructions, models, and tools.',
					},
					{
						title: 'Run experiments',
						description:
							'Compare behavior against a benchmark.',
					},
				].map(({ title, description }, i) => (
					<li
						className='workflow-step'
						key={title}>
						<span className='workflow-step-number'>
							{i + 1}
						</span>
						<div>
							<h3>{title}</h3>
							<p>{description}</p>
						</div>
					</li>
				))}
			</ol>
			<section className='panel overview-projects'>
				<div className='panel-heading'>
					<h2>Projects</h2>
				</div>
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
export function SectionView({
	project,
	section,
}: {
	project: Project;
	section: Section;
}) {
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
