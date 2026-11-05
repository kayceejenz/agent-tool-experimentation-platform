'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Download, FileText, ImageIcon, RefreshCw } from 'lucide-react';
import { projectRequest } from '@/lib/projects/client';
import { useModalDialog } from '@/hooks/use-modal-dialog';
import styles from './execution-artifacts.module.css';

type Artifact = {
	id: string;
	name: string;
	size_bytes: number;
	kind: 'generated' | 'code';
	media_type: string;
	availability: 'available' | 'expired' | 'unavailable';
	width?: number;
	height?: number;
};
type Files = { items: Artifact[]; expires_at: string; warnings: string[] };
type Preview =
	| { kind: 'table'; headers: string[]; rows: string[][]; truncated: boolean }
	| { kind: 'text'; text: string; truncated: boolean };

function fileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	return bytes < 1024 * 1024
		? `${(bytes / 1024).toFixed(1)} KiB`
		: `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function Chart({ item, url }: { item: Artifact; url: string }) {
	const [failed, setFailed] = useState(false);
	return failed ? (
		<p className={styles.error}>
			Chart unavailable. Refresh the generated files to try again.
		</p>
	) : (
		<Image
			unoptimized
			src={`${url}?inline=1`}
			width={item.width ?? 1200}
			height={item.height ?? 800}
			alt={`Generated chart: ${item.name}`}
			onError={() => setFailed(true)}
		/>
	);
}

function ArtifactPreview({
	item,
	path,
	onClose,
}: {
	item: Artifact;
	path: string;
	onClose: () => void;
}) {
	const dialog = useModalDialog();
	const [preview, setPreview] = useState<Preview | null>(null);
	const [error, setError] = useState('');
	const [generation, setGeneration] = useState(0);
	const image = item.media_type === 'image/png';
	const url = `/api/projects${path}/${item.id}`;
	useEffect(() => {
		if (image) return;
		let active = true;
		const controller = new AbortController();
		projectRequest<Preview>(`${path}/${item.id}/preview`, {
			signal: controller.signal,
		})
			.then(value => {
				if (active) setPreview(value);
			})
			.catch(error => {
				if (active) setError(error.message);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [path, item.id, image, generation]);
	return (
		<dialog
			ref={dialog}
			className={styles.modal}
			aria-labelledby='artifact-preview-title'
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<header>
				<div>
					<h2 id='artifact-preview-title'>{item.name}</h2>
					<p>
						{image ? 'Chart preview' : 'File preview'} ·{' '}
						{fileSize(item.size_bytes)}
					</p>
				</div>
				<div className={styles.actions}>
					<a
						className='button'
						href={url}
						download={item.name.split('/').pop()}
					>
						<Download size={16} /> Download
					</a>
					<button className='button' onClick={onClose}>
						Close
					</button>
				</div>
			</header>
			<div className={styles.previewBody}>
				{image ? (
					<Chart item={item} url={url} />
				) : error ? (
					<p role='alert'>
						{error}{' '}
						<button
							className='button'
							onClick={() => {
								setError('');
								setGeneration(old => old + 1);
							}}
						>
							Retry preview
						</button>
					</p>
				) : !preview ? (
					<p role='status'>Loading preview…</p>
				) : preview.kind === 'table' ? (
					<>
						<div
							className={styles.tableScroll}
							role='region'
							tabIndex={0}
							aria-label={`Records from ${item.name}`}
						>
							<table>
								<thead>
									<tr>
										{preview.headers.map((header, i) => (
											<th key={i} scope='col'>
												{header}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{preview.rows.map((row, i) => (
										<tr key={i}>
											{preview.headers.map((_, j) => (
												<td key={j}>{row[j] ?? ''}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<p className={styles.note}>
							{preview.truncated ? 'Preview shortened to fit. ' : ''}Download
							the file for the complete data.
						</p>
					</>
				) : (
					<>
						<pre>{preview.text}</pre>
						{preview.truncated && (
							<p className={styles.note}>
								Preview shortened. Download the file for its complete contents.
							</p>
						)}
					</>
				)}
			</div>
		</dialog>
	);
}

function ArtifactRows({
	items,
	artifactPath,
	inspect,
}: {
	items: Artifact[];
	artifactPath: string;
	inspect: (item: Artifact, element: HTMLElement) => void;
}) {
	return (
		<ul className={styles.fileList}>
			{items.map(item => (
				<li key={item.id}>
					<FileText size={18} />
					<div>
						<strong>{item.name}</strong>
						<small>
							{fileSize(item.size_bytes)}
							{item.availability !== 'available' &&
								` · ${item.availability === 'expired' ? 'Expired — run again to recreate' : 'File unavailable'}`}
						</small>
					</div>
					{item.availability === 'available' && (
						<div className={styles.actions}>
							<button
								className='button'
								aria-label={`Preview ${item.name}`}
								onClick={event => inspect(item, event.currentTarget)}
							>
								Preview
							</button>
							<a
								className='button'
								aria-label={`Download ${item.name}`}
								href={`/api/projects${artifactPath}/${item.id}`}
								download={item.name.split('/').pop()}
							>
								<Download size={16} /> Download
							</a>
						</div>
					)}
				</li>
			))}
		</ul>
	);
}

export function ExecutionArtifacts({
	path,
	incomplete = false,
}: {
	path: string;
	incomplete?: boolean;
}) {
	const [files, setFiles] = useState<Files | null>(null);
	const [error, setError] = useState('');
	const [generation, setGeneration] = useState(0);
	const [preview, setPreview] = useState<Artifact | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	const artifactPath = `${path}/artifacts`;
	useEffect(() => {
		let active = true;
		const controller = new AbortController();
		projectRequest<Files>(artifactPath, { signal: controller.signal })
			.then(value => {
				if (active) setFiles(value);
			})
			.catch(error => {
				if (active) setError(error.message);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [artifactPath, generation]);
	function inspect(item: Artifact, element: HTMLElement) {
		opener.current = element;
		setPreview(item);
	}
	function close() {
		setPreview(null);
		requestAnimationFrame(() => {
			if (opener.current?.isConnected) opener.current.focus();
		});
	}
	const charts =
		files?.items.filter(item => item.media_type === 'image/png') ?? [];
	const tables =
		files?.items.filter(
			item => item.media_type !== 'image/png' && item.kind !== 'code',
		) ?? [];
	const scripts = files?.items.filter(item => item.kind === 'code') ?? [];
	return (
		<section className={styles.root} aria-labelledby='generated-files-title'>
			<div className={styles.heading}>
				<div>
					<h3 id='generated-files-title'>Generated files</h3>
					<p>Charts, data exports and the Python used for this analysis.</p>
				</div>
				<button
					className='button'
					aria-label='Refresh generated files'
					onClick={() => {
						setFiles(null);
						setError('');
						setGeneration(old => old + 1);
					}}
				>
					<RefreshCw size={16} />
				</button>
			</div>
			{error ? (
				<p className={styles.error} role='alert'>
					{error}
				</p>
			) : !files ? (
				<p role='status'>Loading generated files…</p>
			) : (
				<>
					{incomplete && (
						<p className={styles.note}>
							This run did not finish. Generated files may contain partial
							results.
						</p>
					)}
					{files.warnings.map((warning, index) => (
						<p key={index} className={styles.note}>
							{warning}
						</p>
					))}
					{!charts.length && !tables.length && (
						<p className={styles.note}>
							No charts or data exports were saved. Ask the agent to create and
							save visualisations or summary tables.
						</p>
					)}
					{charts.length > 0 && (
						<div className={styles.chartGrid}>
							{charts.map(item => (
								<figure key={item.id}>
									{item.availability === 'available' ? (
										<>
											<button
												className={styles.chartButton}
												aria-label={`Preview ${item.name}`}
												onClick={event => inspect(item, event.currentTarget)}
											>
												<Chart
													item={item}
													url={`/api/projects${artifactPath}/${item.id}`}
												/>
											</button>
											<figcaption>
												<span>
													<ImageIcon size={16} />
													{item.name}
												</span>
												<a
													className='button'
													aria-label={`Download ${item.name}`}
													href={`/api/projects${artifactPath}/${item.id}`}
													download={item.name.split('/').pop()}
												>
													<Download size={16} /> Download
												</a>
											</figcaption>
										</>
									) : (
										<figcaption>
											{item.name} ·{' '}
											{item.availability === 'expired'
												? 'Expired — run again to recreate'
												: 'Unavailable'}
										</figcaption>
									)}
								</figure>
							))}
						</div>
					)}
					{tables.length > 0 && (
						<ArtifactRows
							items={tables}
							artifactPath={artifactPath}
							inspect={inspect}
						/>
					)}
					{scripts.length > 0 && (
						<details className={styles.scripts}>
							<summary>
								Executed Python · {scripts.length}{' '}
								{scripts.length === 1 ? 'script' : 'scripts'}
							</summary>
							{
								<ArtifactRows
									items={scripts}
									artifactPath={artifactPath}
									inspect={inspect}
								/>
							}
						</details>
					)}
					{files.items.length > 0 && (
						<p className={styles.note}>
							Files available until{' '}
							{new Date(files.expires_at).toLocaleDateString(undefined, {
								day: 'numeric',
								month: 'short',
								year: 'numeric',
							})}
							. Expired files can be recreated by running the analysis again.
						</p>
					)}
				</>
			)}
			{preview && (
				<ArtifactPreview
					key={preview.id}
					item={preview}
					path={artifactPath}
					onClose={close}
				/>
			)}
		</section>
	);
}
