'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { projectRequest } from '@/lib/projects/client';
import styles from './analysis-dataset-picker.module.css';

type Dataset = { id: string; name: string };

export function AnalysisDatasetPicker({
	projectId,
	value,
	onChange,
	disabled,
}: {
	projectId: string;
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
}) {
	const [datasets, setDatasets] = useState<Dataset[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [generation, setGeneration] = useState(0);
	const [more, setMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	useEffect(() => {
		let active = true;
		const controller = new AbortController();
		projectRequest<{ items: Dataset[] }>(`/${projectId}/datasets`, {
			signal: controller.signal,
		})
			.then(page => {
				if (active) {
					setDatasets(page.items);
					setMore(page.items.length === 50);
				}
			})
			.catch(() => {
				if (active)
					setError('Unable to load datasets. Retry or run without a dataset.');
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [projectId, generation]);
	async function loadMore() {
		setLoadingMore(true);
		setError('');
		try {
			const page = await projectRequest<{ items: Dataset[] }>(
				`/${projectId}/datasets?offset=${datasets.length}`,
			);
			setDatasets(current => [...current, ...page.items]);
			setMore(page.items.length === 50);
		} catch {
			setError('Unable to load more datasets.');
		} finally {
			setLoadingMore(false);
		}
	}
	return (
		<div className={styles.picker}>
			<label htmlFor='analysis-dataset'>
				Dataset <span>Optional</span>
			</label>
			<div className={styles.controls}>
				<select
					id='analysis-dataset'
					value={value}
					disabled={disabled || loading}
					onChange={event => onChange(event.target.value)}
				>
					<option value=''>
						{loading
							? 'Loading datasets…'
							: 'No dataset — use configured tools'}
					</option>
					{value && !datasets.some(dataset => dataset.id === value) && (
						<option value={value}>Previously selected dataset</option>
					)}
					{datasets.map(dataset => (
						<option key={dataset.id} value={dataset.id}>
							{dataset.name}
						</option>
					))}
				</select>
				<Link href={`/projects/${projectId}/datasets`}>Manage datasets</Link>
			</div>
			{value && (
				<p>
					Enables file inspection and isolated Python analysis for this run.
					Evaluation is disabled.
				</p>
			)}
			{!loading && !datasets.length && !error && (
				<p>Upload CSV files in Datasets to enable analysis.</p>
			)}
			{more && (
				<button
					type='button'
					className='button'
					disabled={disabled || loadingMore}
					onClick={() => void loadMore()}
				>
					{loadingMore ? 'Loading…' : 'Load more datasets'}
				</button>
			)}
			{error && (
				<p role='alert'>
					{error}{' '}
					<button
						type='button'
						className='button'
						disabled={disabled}
						onClick={() => {
							setError('');
							setLoading(true);
							setGeneration(old => old + 1);
						}}
					>
						Retry
					</button>
				</p>
			)}
		</div>
	);
}
