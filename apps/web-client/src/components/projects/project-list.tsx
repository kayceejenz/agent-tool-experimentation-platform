'use client';
import Link from 'next/link';
import { ArrowUpRight, FolderKanban } from 'lucide-react';
import { useProjects } from './project-provider';

export function ProjectRows() {
	const { projects, loading, error, more, load } = useProjects();
	return <div aria-busy={loading}>
		{error && <div className='project-feedback' role='alert'><p>{error}</p><button className='button' onClick={() => void load(projects.length > 0)}>Try again</button></div>}
		{!error && !loading && !projects.length && <div className='empty-state'><span className='empty-icon'><FolderKanban size={28} aria-hidden /></span><h2>No projects yet</h2><p>Create a project to organize your tools, agents, and experiments.</p><Link className='button primary' href='/projects/new'>Create project</Link></div>}
		<div className='project-list'>{projects.map(project => <Link href={`/projects/${project.id}`} key={project.id}><span className='project-icon'><FolderKanban size={21} aria-hidden /></span><div><strong>{project.name}</strong><p>{project.description || 'No description'}</p><span className='project-role'>{project.role}</span></div><ArrowUpRight size={18} aria-hidden /></Link>)}</div>
		{loading && <p className='project-feedback' role='status'>Loading projects…</p>}
		{more && !loading && !error && <div className='project-feedback'><button className='button' onClick={() => void load(true)}>Load more projects</button></div>}
	</div>;
}
