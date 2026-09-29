'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { Project } from '@/types/workspace';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';
import { useProjects } from './project-provider';

export function ProjectForm({ project }: { project?: Project }) {
	const router = useRouter();
	const { upsert } = useProjects();
	const [name, setName] = useState(project?.name ?? '');
	const [description, setDescription] = useState(project?.description ?? '');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
	const [denied, setDenied] = useState(false);
	const readOnly = project?.role === 'viewer' || denied;
	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || readOnly) return;
		if (!name.trim()) { setError('Enter a project name.'); return; }
		setBusy(true); setError(''); setSaved(false);
		try {
			const result = await projectRequest<Project>(project ? `/${project.id}` : '', {
				method: project ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
			});
			upsert(result); setName(result.name); setDescription(result.description ?? '');
			if (project) { setSaved(true); router.refresh(); }
			else { router.push(`/projects/${result.id}`); router.refresh(); }
		} catch (error) {
			setError(error instanceof Error ? error.message : 'Unable to save this project.');
			if (error instanceof ProjectRequestError && (error.status === 403 || error.status === 404)) setDenied(true);
		} finally { setBusy(false); }
	}
	return <form className='project-form' onSubmit={submit} aria-busy={busy}>
		{readOnly && <p className='project-feedback'>You have read-only access to these details.</p>}
		{error && <p className='project-error' role='alert'>{error}</p>}
		{saved && <p role='status'>Project saved.</p>}
		<label htmlFor='project-name'>Project name</label>
		<input id='project-name' name='name' value={name} onChange={event => { setName(event.target.value); setSaved(false); }} required maxLength={160} disabled={busy || readOnly} autoComplete='off' />
		<label htmlFor='project-description'>Description <span className='project-optional'>(optional)</span></label>
		<textarea id='project-description' name='description' value={description} onChange={event => { setDescription(event.target.value); setSaved(false); }} rows={4} maxLength={2000} disabled={busy || readOnly} aria-describedby='description-hint' />
		<small id='description-hint'>Describe what this project is for. Up to 2,000 characters.</small>
		<div className='project-form-actions'>
			{!readOnly && <button className='button primary' disabled={busy} type='submit'>{busy ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>}
			<Link className='button' href={project ? `/projects/${project.id}` : '/projects'}>{readOnly ? 'Back to project' : 'Cancel'}</Link>
		</div>
	</form>;
}
