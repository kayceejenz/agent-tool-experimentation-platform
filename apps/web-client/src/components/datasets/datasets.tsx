'use client';

import {
	Fragment,
	useEffect,
	useId,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import {
	Database,
	FileSpreadsheet,
	Upload,
	RefreshCw,
	ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/workspace/workspace-views';
import { ProjectSync } from '@/components/projects/project-provider';
import { readJsonResponse, isRecord } from '@/lib/http/response';
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

function size(bytes: number) {
	return bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(1)} KiB`
		: `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function message(error: unknown) {
	return error instanceof Error
		? error.message
		: 'Request failed. Please try again.';
}
async function read<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...init,
		cache: 'no-store',
		signal: AbortSignal.timeout(120_000),
	});
	const value = await readJsonResponse(response);
	if (!response.ok)
		throw new Error(
			response.status === 401
				? 'Your session expired. Sign in again.'
				: isRecord(value) && typeof value.error === 'string'
					? value.error
					: 'Dataset request failed. Please try again.',
		);
	return value as T;
}

function Popup({
	title,
	busy = false,
	onClose,
	children,
}: {
	title: string;
	busy?: boolean;
	onClose: () => void;
	children: ReactNode;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	useEffect(() => {
		const element = dialog.current;
		const opener = document.activeElement as HTMLElement | null;
		element?.showModal();
		element?.querySelector<HTMLInputElement>('input')?.focus();
		return () => {
			element?.close();
			requestAnimationFrame(() => {
				if (opener?.isConnected) opener.focus();
			});
		};
	}, []);
	return (
		<dialog
			ref={dialog}
			className={styles.modal}
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				if (!busy) onClose();
			}}
		>
			<header className={styles.modalHeader}>
				<h2 id={titleId}>{title}</h2>
				<button className='button' disabled={busy} onClick={onClose}>
					Close
				</button>
			</header>
			{children}
		</dialog>
	);
}

function rememberView(key: string, dataset: string, file = '') {
	try {
		sessionStorage.setItem(key, JSON.stringify({ dataset, file }));
	} catch {
		/* Browsing still works when storage is unavailable. */
	}
}

export function Datasets({ project }: { project: Project }) {
	const base = `/api/projects/${project.id}/datasets`;
	const [items, setItems] = useState<Dataset[]>([]);
	const [detail, setDetail] = useState<Detail | null>(null);
	const [selectedId, setSelectedId] = useState('');
	const [file, setFile] = useState<DatasetFile | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [listError, setListError] = useState('');
	const [detailError, setDetailError] = useState('');
	const [previewError, setPreviewError] = useState('');
	const [uploadError, setUploadError] = useState('');
	const [notice, setNotice] = useState('');
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [detailLoading, setDetailLoading] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [more, setMore] = useState(false);
	const [moreLoading, setMoreLoading] = useState(false);
	const [generation, setGeneration] = useState(0);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [pending, setPending] = useState<File[]>([]);
	const previewRequest = useRef(0);
	const detailRequest = useRef(0);
	const listRequest = useRef(0);
	const uploadButton = useRef<HTMLButtonElement>(null);
	const canEdit = project.role !== 'viewer';

	useEffect(() => {
		const request = ++listRequest.current;
		let active = true;
		read<{ items: Dataset[] }>(base)
			.then(page => {
				if (!active || request !== listRequest.current) return;
				setItems(page.items);
				setMore(page.items.length === 50);
			})
			.catch(error => {
				if (active && request === listRequest.current)
					setListError(message(error));
			})
			.finally(() => {
				if (active && request === listRequest.current) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [base, generation]);

	useEffect(() => {
		let active = true;
		const initialRequest = detailRequest.current;
		let saved: { dataset?: string; file?: string };
		try {
			saved = JSON.parse(sessionStorage.getItem(base) ?? '{}');
		} catch {
			return;
		}
		if (
			!saved ||
			typeof saved.dataset !== 'string' ||
			!/^[0-9a-f-]{36}$/i.test(saved.dataset)
		)
			return;
		const datasetId = saved.dataset;
		read<Detail>(`${base}/${datasetId}`)
			.then(async result => {
				if (!active || detailRequest.current !== initialRequest) return;
				setSelectedId(result.id);
				setDetail(result);
				const selected = result.files.find(item => item.id === saved.file);
				if (!selected) return;
				const request = ++previewRequest.current;
				setFile(selected);
				setPreviewLoading(true);
				try {
					const records = await read<Preview>(
						`${base}/${datasetId}/files/${selected.id}/preview`,
					);
					if (active && request === previewRequest.current) setPreview(records);
				} catch (error) {
					if (active && request === previewRequest.current)
						setPreviewError(message(error));
				} finally {
					if (active && request === previewRequest.current)
						setPreviewLoading(false);
				}
			})
			.catch(() => {
				/* A removed or inaccessible saved selection must not expose cached data. */
			});
		return () => {
			active = false;
		};
	}, [base]);

	function refresh() {
		setListError('');
		setLoading(true);
		setGeneration(value => value + 1);
	}
	async function inspect(datasetId: string, selected: DatasetFile) {
		rememberView(base, datasetId, selected.id);
		const request = ++previewRequest.current;
		setFile(selected);
		setPreview(null);
		setPreviewError('');
		setPreviewLoading(true);
		try {
			const result = await read<Preview>(
				`${base}/${datasetId}/files/${selected.id}/preview`,
			);
			if (request === previewRequest.current) setPreview(result);
		} catch (error) {
			if (request === previewRequest.current) setPreviewError(message(error));
		} finally {
			if (request === previewRequest.current) setPreviewLoading(false);
		}
	}
	function show(result: Detail) {
		setDetail(result);
		setFile(null);
		setPreview(null);
		setPreviewError('');
	}
	function toggleDataset(id: string) {
		if (selectedId !== id) {
			void select(id);
			return;
		}
		detailRequest.current++;
		previewRequest.current++;
		setSelectedId('');
		setDetail(null);
		setFile(null);
		setPreview(null);
		setDetailLoading(false);
		setPreviewLoading(false);
		rememberView(base, '');
	}

	async function select(id: string) {
		rememberView(base, id);
		const request = ++detailRequest.current;
		previewRequest.current++;
		setSelectedId(id);
		setDetail(null);
		setFile(null);
		setPreview(null);
		setDetailError('');
		setPreviewError('');
		setPreviewLoading(false);
		setDetailLoading(true);
		try {
			const result = await read<Detail>(`${base}/${id}`);
			if (request === detailRequest.current) show(result);
		} catch (error) {
			if (request === detailRequest.current) setDetailError(message(error));
		} finally {
			if (request === detailRequest.current) setDetailLoading(false);
		}
	}
	async function upload(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const body = new FormData(form);
		const name = String(body.get('name') ?? '').trim();
		if (
			!name ||
			!pending.length ||
			pending.length > 20 ||
			pending.some(
				f => !/\.csv$/i.test(f.name) || !f.size || f.size > 64 * 1024 * 1024,
			) ||
			pending.reduce((sum, f) => sum + f.size, 0) > 128 * 1024 * 1024 ||
			new Set(pending.map(f => f.name)).size !== pending.length
		) {
			setUploadError(
				'Enter a name and select 1–20 unique, nonempty CSV files. Maximum 64 MiB per file and 128 MiB total.',
			);
			return;
		}
		body.delete('files');
		pending.forEach(f => body.append('files', f));
		body.set('name', name);
		setBusy(true);
		setUploadError('');
		setNotice('');
		try {
			const result = await read<Detail>(base, {
				method: 'POST',
				body,
			});
			detailRequest.current++;
			listRequest.current++;
			setDetailLoading(false);
			setSelectedId(result.id);
			rememberView(base, result.id);
			show(result);
			setItems(current => [
				result,
				...current.filter(item => item.id !== result.id),
			]);
			setLoading(false);
			setListError('');
			setDetailError('');
			setPending([]);
			form.reset();
			setUploadOpen(false);
			setNotice(
				`“${result.name}” uploaded. ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'} ready to inspect.`,
			);
			uploadButton.current?.focus();
		} catch (error) {
			setUploadError(message(error));
		} finally {
			setBusy(false);
		}
	}
	async function loadMore() {
		if (moreLoading) return;
		const request = listRequest.current;
		setMoreLoading(true);
		setListError('');
		try {
			const page = await read<{ items: Dataset[] }>(
				`${base}?offset=${items.length}`,
			);
			if (request !== listRequest.current) return;
			setItems(current => [
				...current,
				...page.items.filter(item => !current.some(old => old.id === item.id)),
			]);
			setMore(page.items.length === 50);
		} catch (error) {
			if (request === listRequest.current) setListError(message(error));
		} finally {
			setMoreLoading(false);
		}
	}

	return (
		<div className={styles.workspace}>
			<PageHeader
				title='Datasets'
				description='Keep related CSV files together and explore their source records.'
			>
				{canEdit && (
					<button
						ref={uploadButton}
						className='button primary'
						aria-expanded={uploadOpen}
						aria-controls='dataset-upload'
						onClick={() => {
							setUploadOpen(open => !open);
						}}
						disabled={busy}
					>
						<Upload size={16} /> Upload dataset
					</button>
				)}
			</PageHeader>
			<ProjectSync project={project} />
			{notice && (
				<p className={styles.success} role='status'>
					{notice}
				</p>
			)}
			{canEdit && uploadOpen && (
				<Popup
					title='Upload dataset'
					busy={busy}
					onClose={() => setUploadOpen(false)}
				>
					<section
						className={`panel ${styles.upload}`}
						id='dataset-upload'
						aria-labelledby='upload-title'
					>
						<h2 id='upload-title'>New dataset</h2>
						<p>Give related files a name, then upload them together.</p>
						<form onSubmit={upload} aria-busy={busy}>
							<label>
								Dataset name
								<input
									name='name'
									required
									maxLength={160}
									placeholder='e.g. Pig behaviour trial — March 2025'
									disabled={busy}
								/>
							</label>
							<label className={styles.picker}>
								<Upload size={24} />
								<span>Choose CSV files</span>
								<small>
									UTF-8 · Up to 20 files · 64 MiB each · 128 MiB total
								</small>
								<input
									name='files'
									type='file'
									accept='.csv'
									multiple
									disabled={busy}
									onChange={event => {
										setPending(Array.from(event.target.files ?? []));
										setUploadError('');
									}}
								/>
							</label>
							{pending.length > 0 && (
								<div className={styles.pending}>
									<strong>
										{pending.length} selected ·{' '}
										{size(pending.reduce((sum, f) => sum + f.size, 0))}
									</strong>
									<ul>
										{pending.map((f, index) => (
											<li key={`${f.name}-${index}`}>
												<span>{f.name}</span>
												<small>{size(f.size)}</small>
												<button
													type='button'
													className='button'
													disabled={busy}
													aria-label={`Remove ${f.name}`}
													onClick={() =>
														setPending(current =>
															current.filter((_, i) => i !== index),
														)
													}
												>
													Remove
												</button>
											</li>
										))}
									</ul>
								</div>
							)}
							{uploadError && (
								<p role='alert' className={styles.error}>
									{uploadError}
								</p>
							)}
							<div className={styles.actions}>
								<button
									className='button primary'
									disabled={busy || !pending.length}
								>
									{busy ? 'Uploading files…' : 'Save dataset'}
								</button>
								<button
									type='button'
									className='button'
									disabled={busy}
									onClick={() => {
										setUploadOpen(false);
										uploadButton.current?.focus();
									}}
								>
									Cancel
								</button>
								<small>
									{busy
										? 'Keep this page open until the upload completes.'
										: 'Include only files you want the agent to access.'}
								</small>
							</div>
						</form>
					</section>
				</Popup>
			)}
			<section
				className={`panel ${styles.library}`}
				aria-labelledby='library-title'
			>
				<div className={styles.heading}>
					<h2 id='library-title'>Datasets</h2>
					<button
						className='button'
						aria-label='Refresh datasets'
						disabled={loading || moreLoading || busy}
						onClick={refresh}
					>
						<RefreshCw size={16} />
					</button>
				</div>
				{listError && (
					<div className={styles.error} role='alert'>
						{listError}{' '}
						<button className='button' onClick={refresh}>
							Retry
						</button>
					</div>
				)}
				{loading ? (
					<p className={styles.empty} role='status'>
						Loading datasets…
					</p>
				) : !items.length && !listError ? (
					<div className={styles.empty}>
						<Database size={28} />
						<h3>Add your first dataset</h3>
						<p>
							{canEdit
								? 'Upload related CSV files to inspect their records.'
								: 'An owner or editor can upload files for this project.'}
						</p>
						{canEdit && (
							<button
								className='button primary'
								onClick={() => setUploadOpen(true)}
							>
								<Upload size={16} /> Add dataset
							</button>
						)}
					</div>
				) : (
					<div
						className={styles.catalogue}
						tabIndex={0}
						role='region'
						aria-label='Datasets and files'
					>
						<table>
							<thead>
								<tr>
									<th scope='col'>Dataset / file</th>
									<th scope='col'>Type</th>
									<th scope='col'>Size</th>
									<th scope='col'>Added</th>
									<th scope='col'>Actions</th>
								</tr>
							</thead>
							<tbody>
								{items.map(item => (
									<Fragment key={item.id}>
										<tr
											className={
												selectedId === item.id ? styles.activeRow : undefined
											}
										>
											<th scope='row'>
												<button
													className={styles.datasetName}
													disabled={busy}
													aria-expanded={selectedId === item.id}
													onClick={() => toggleDataset(item.id)}
												>
													<ChevronRight
														size={16}
														className={
															selectedId === item.id
																? styles.expanded
																: styles.collapsed
														}
													/>
													<Database size={18} />
													{item.name}
												</button>
											</th>
											<td>Dataset</td>
											<td>
												{detail?.id === item.id
													? size(
															detail.files.reduce(
																(sum, f) => sum + f.size_bytes,
																0,
															),
														)
													: '—'}
											</td>
											<td>
												<time dateTime={item.created_at}>
													{new Date(item.created_at).toLocaleDateString(
														undefined,
														{
															day: 'numeric',
															month: 'short',
															year: 'numeric',
														},
													)}
												</time>
											</td>
											<td>
												<button
													className='button'
													disabled={busy}
													onClick={() => toggleDataset(item.id)}
													aria-label={`${selectedId === item.id ? 'Collapse' : 'Expand'} ${item.name}`}
												>
													{selectedId === item.id ? 'Collapse' : 'Expand'}
												</button>
											</td>
										</tr>
										{selectedId === item.id &&
											(detailLoading ? (
												<tr>
													<td colSpan={5} role='status'>
														Loading files…
													</td>
												</tr>
											) : detailError ? (
												<tr>
													<td colSpan={5}>
														<div role='alert' className={styles.error}>
															{detailError}{' '}
															<button
																className='button'
																onClick={() => void select(item.id)}
															>
																Retry
															</button>
														</div>
													</td>
												</tr>
											) : (
												detail?.id === item.id &&
												detail.files.map(entry => (
													<tr key={entry.id} className={styles.fileEntry}>
														<th scope='row'>
															<span className={styles.filename}>
																<FileSpreadsheet size={18} />
																{entry.name}
															</span>
														</th>
														<td>CSV</td>
														<td>{size(entry.size_bytes)}</td>
														<td>—</td>
														<td>
															<button
																className='button'
																aria-label={`Preview ${entry.name}`}
																onClick={() => void inspect(item.id, entry)}
															>
																Preview
															</button>
														</td>
													</tr>
												))
											))}
									</Fragment>
								))}
							</tbody>
						</table>
					</div>
				)}
				{more && (
					<button
						className='button'
						disabled={moreLoading || loading || busy}
						onClick={() => void loadMore()}
					>
						{moreLoading ? 'Loading…' : 'Load more datasets'}
					</button>
				)}
			</section>

			{file && (
				<Popup
					title='File preview'
					onClose={() => {
						previewRequest.current++;
						rememberView(base, selectedId);
						setFile(null);
						setPreview(null);
					}}
				>
					<section
						className={`panel ${styles.records}`}
						aria-labelledby='preview-title'
						aria-busy={previewLoading}
					>
						<div className={styles.heading}>
							<div>
								<h2 id='preview-title'>Preview: {file.name}</h2>
								<p>
									{preview
										? `${preview.rows.length} preview rows · ${preview.headers.length} columns`
										: 'Source records'}
								</p>
							</div>
							<span className='badge'>CSV</span>
						</div>
						{previewLoading ? (
							<p className={styles.empty} role='status'>
								Loading records…
							</p>
						) : previewError ? (
							<div className={styles.error} role='alert'>
								{previewError}{' '}
								<button
									className='button'
									onClick={() => void inspect(detail!.id, file)}
								>
									Retry preview
								</button>
							</div>
						) : (
							preview && (
								<>
									<div
										className={styles.preview}
										tabIndex={0}
										role='region'
										aria-label={`Scrollable records from ${file.name}`}
									>
										<table>
											<caption className={styles.visuallyHidden}>
												First records from {file.name}
											</caption>
											<thead>
												<tr>
													<th scope='col'>Row</th>
													{preview.headers.map(h => (
														<th key={h} scope='col'>
															{h}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{preview.rows.map((row, i) => (
													<tr key={i}>
														<th scope='row'>{i + 1}</th>
														{row.map((cell, j) => (
															<td key={j}>
																{cell || (
																	<span
																		className={styles.missing}
																		aria-label='Empty value'
																	>
																		—
																	</span>
																)}
															</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<p className={styles.hint}>
										{preview.truncated
											? 'Showing the first 20 records. '
											: !preview.rows.length
												? 'This file has headers but no preview records. '
												: ''}
										Preview checks do not validate the complete file. Scroll
										horizontally to see all columns.
									</p>
								</>
							)
						)}
					</section>
				</Popup>
			)}
		</div>
	);
}
