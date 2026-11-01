'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/workspace/workspace-views';
import { ProjectSync } from '@/components/projects/project-provider';
import styles from './datasets.module.css';
import type { Project } from '@/types/workspace';

type Dataset = { id: string; name: string; created_at: string };
type DatasetFile = {
	id: string;
	name: string;
	size_bytes: number;
	sha256: string;
};
type Detail = Dataset & { files: DatasetFile[] };
type Preview = { headers: string[]; rows: string[][]; truncated: boolean };

async function read<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, cache: 'no-store' });
	const value = await response.json();
	if (!response.ok) throw new Error(value.error ?? 'Dataset request failed.');
	return value;
}

export function Datasets({ project }: { project: Project }) {
	const base = `/api/projects/${project.id}/datasets`;
	const [items, setItems] = useState<Dataset[]>([]);
	const [detail, setDetail] = useState<Detail | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [selectedFile, setSelectedFile] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [more, setMore] = useState(false);
	const previewRequest = useRef(0);
	const detailRequest = useRef(0);
	const load = useCallback(async () => {
		const page = await read<{ items: Dataset[] }>(base);
		setItems(page.items);
		setMore(page.items.length === 50);
	}, [base]);
	useEffect(() => {
		let active = true;
		read<{ items: Dataset[] }>(base)
			.then((page) => {
				if (active) {
					setItems(page.items);
					setMore(page.items.length === 50);
				}
			})
			.catch((e) => {
				if (active) setError(e.message);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [base]);

	async function upload(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const body = new FormData(form);
		const files = body.getAll('files') as File[];
		if (
			!files.length ||
			files.length > 20 ||
			files.some((f) => !f.size || f.size > 64 * 1024 * 1024) ||
			files.reduce((sum, f) => sum + f.size, 0) > 128 * 1024 * 1024
		) {
			setError(
				'Select 1–20 nonempty CSV files, up to 64 MiB each and 128 MiB total.',
			);
			return;
		}
		setBusy(true);
		setError('');
		try {
			const result = await read<Detail>(base, {
				method: 'POST',
				body,
			});
			detailRequest.current++;
			previewRequest.current++;
			setDetail(result);
			setPreview(null);
			setSelectedFile('');
			form.reset();
			await load();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Upload failed.');
		} finally {
			setBusy(false);
		}
	}

	async function select(id: string) {
		const request = ++detailRequest.current;
		previewRequest.current++;
		setDetail(null);
		setPreview(null);
		setError('');
		setSelectedFile('');
		try {
			const result = await read<Detail>(`${base}/${id}`);
			if (request === detailRequest.current) setDetail(result);
		} catch (e) {
			if (request === detailRequest.current)
				setError(e instanceof Error ? e.message : 'Unable to load dataset.');
		}
	}

	async function inspect(file: DatasetFile) {
		const request = ++previewRequest.current;
		setPreview(null);
		setSelectedFile(file.name);
		setError('');
		try {
			const result = await read<Preview>(
				`${base}/${detail!.id}/files/${file.id}/preview`,
			);
			if (request === previewRequest.current) setPreview(result);
		} catch (e) {
			if (request === previewRequest.current)
				setError(e instanceof Error ? e.message : 'Preview failed.');
		}
	}

	return (
		<>
			<PageHeader
				title='Datasets'
				description='Upload related CSV files and inspect their source records.'
			/>
			<ProjectSync project={project} />
			{error && (
				<p role='alert' className='notice error'>
					{error}
				</p>
			)}
			{project.role !== 'viewer' && (
				<section className='panel'>
					<h2>Upload dataset</h2>
					<p>
						UTF-8 CSV with unique headers. Up to 20 files, 64 MiB each and 128
						MiB total. Upload observational files only; keep answer keys
						separate.
					</p>
					<form onSubmit={upload}>
						<label>
							Dataset name{' '}
							<input name='name' required maxLength={160} disabled={busy} />
						</label>
						<label>
							CSV files{' '}
							<input
								name='files'
								type='file'
								accept='.csv'
								multiple
								required
								disabled={busy}
							/>
						</label>
						<button className='button primary' disabled={busy}>
							{busy ? 'Uploading…' : 'Upload dataset'}
						</button>
					</form>
				</section>
			)}
			<section className='panel'>
				<h2>Saved datasets</h2>
				{loading ? (
					<p role='status'>Loading datasets…</p>
				) : !items.length ? (
					<p>No datasets uploaded yet.</p>
				) : (
					<ul>
						{items.map((item) => (
							<li key={item.id}>
								<button className='button' onClick={() => void select(item.id)}>
									{item.name}
								</button>{' '}
								<time>{new Date(item.created_at).toLocaleString()}</time>
							</li>
						))}
					</ul>
				)}
				{more && (
					<button
						className='button'
						onClick={async () => {
							try {
								const page = await read<{
									items: Dataset[];
								}>(`${base}?offset=${items.length}`);
								setItems([...items, ...page.items]);
								setMore(page.items.length === 50);
							} catch {
								setError('Unable to load more datasets.');
							}
						}}
					>
						Load more
					</button>
				)}
			</section>
			{detail && (
				<section className='panel'>
					<h2>{detail.name}</h2>
					<p>
						Source files are immutable. Upload a new dataset to use revised
						files.
					</p>
					<ul>
						{detail.files.map((file) => (
							<li key={file.id}>
								<button className='button' onClick={() => void inspect(file)}>
									{file.name}
								</button>{' '}
								{(file.size_bytes / 1024 / 1024).toFixed(2)} MiB{' '}
								<details>
									<summary>SHA-256</summary>
									<code>{file.sha256}</code>
								</details>
							</li>
						))}
					</ul>
				</section>
			)}
			{preview && (
				<section className='panel'>
					<h2>Preview: {selectedFile}</h2>
					<p>
						First {preview.rows.length} records. Preview validation does not
						validate the entire file.
					</p>
					<div className={styles.preview}>
						<table>
							<thead>
								<tr>
									{preview.headers.map((h) => (
										<th key={h} scope='col'>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{preview.rows.map((row, i) => (
									<tr key={i}>
										{row.map((cell, j) => (
											<td key={j}>{cell}</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{preview.truncated && (
						<p>Additional content omitted from this preview.</p>
					)}
				</section>
			)}
		</>
	);
}
