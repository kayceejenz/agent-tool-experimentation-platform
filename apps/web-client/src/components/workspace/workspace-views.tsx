import Link from 'next/link';
import {
	ArrowRight,
	ArrowUpRight,
	FlaskConical,
	FolderKanban,
	Server,
	Workflow,
} from 'lucide-react';
import { projects, sections } from '@/lib/workspace';
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

function ProjectRows() {
	if (!projects.length)
		return (
			<div className='empty-state'>
				<span className='empty-icon'>
					<FolderKanban size={28} aria-hidden />
				</span>
				<h2>No projects yet</h2>
				<p>
					Your projects will appear here once
					project creation is available.
				</p>
			</div>
		);
	return (
		<div className='project-list'>
			{projects.map(project => (
				<Link
					href={`/projects/${project.id}`}
					key={project.id}>
					<span className='project-icon'>
						<FolderKanban
							size={21}
							aria-hidden
						/>
					</span>
					<div>
						<strong>{project.name}</strong>
						<p>{project.description}</p>
					</div>
					<ArrowUpRight size={18} aria-hidden />
				</Link>
			))}
		</div>
	);
}

export function ProjectList() {
	return (
		<>
			<PageHeader
				title='Projects'
				description='Keep connections, agents, and experiments together.'
			/>
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
			<div className='workflow-grid'>
				{[
					{
						title: 'Connect tools',
						description:
							'Discover what your systems can do.',
						Icon: Server,
					},
					{
						title: 'Configure agents',
						description:
							'Choose instructions, models, and tools.',
						Icon: Workflow,
					},
					{
						title: 'Run experiments',
						description:
							'Compare behavior against a benchmark.',
						Icon: FlaskConical,
					},
				].map(({ title, description, Icon }, i) => (
					<div
						className='workflow-card'
						key={title}>
						<div className='card-top'>
							<Icon
								size={22}
								aria-hidden
							/>
							<span>0{i + 1}</span>
						</div>
						<h3>{title}</h3>
						<p>{description}</p>
					</div>
				))}
			</div>
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
				description={project.description}></PageHeader>
			<ProjectTabs project={project} />
			<section className='panel empty-state'>
				<span className='empty-icon'>
					<Server size={28} />
				</span>
				<h2>Start with a connection</h2>
				<p>
					MCP connections and tool discovery will
					be available in a later milestone.
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
					<section className='panel'>
						<div className='panel-heading'>
							<h2>Project details</h2>
							<span className='badge'>
								Read-only
								preview
							</span>
						</div>
						<dl className='details-list'>
							<div>
								<dt>Name</dt>
								<dd>
									{
										project.name
									}
								</dd>
							</div>
							<div>
								<dt>
									Description
								</dt>
								<dd>
									{
										project.description
									}
								</dd>
							</div>
							<div>
								<dt>Access</dt>
								<dd>
									Project
									membership
									will be
									available
									with
									authentication.
								</dd>
							</div>
						</dl>
					</section>
				</>
			) : (
				<section className='panel empty-state'>
					<span className='empty-icon'>
						<FolderKanban size={28} />
					</span>
					<h2>{details.empty}</h2>
					<p>
						This is a layout preview.{' '}
						{details.title} will become
						available when this feature is
						implemented.
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
