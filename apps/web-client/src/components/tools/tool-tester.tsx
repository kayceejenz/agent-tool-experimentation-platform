'use client';
import { useEffect, useRef, useState } from 'react';
import type { Schema, Tool, ToolExecution } from '@/types/tool';
import { projectRequest, ProjectRequestError } from '@/lib/projects/client';

function initialInputs(schema: Schema) {
	return Object.fromEntries(
		Object.entries(schema.properties ?? {})
			.filter(([, s]) => s.default !== undefined)
			.map(([key, s]) => [key, s.default]),
	);
}
export function ToolTester({
	projectId,
	tool,
	canManage,
	onClose,
}: {
	projectId: string;
	tool: Tool;
	canManage: boolean;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [mode, setMode] = useState<'form' | 'json'>('form');
	const [raw, setRaw] = useState(() =>
		JSON.stringify(
			initialInputs(tool.definition.input_schema),
			null,
			2,
		),
	);
	const [history, setHistory] = useState<ToolExecution[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [result, setResult] = useState<ToolExecution | null>(null);
	const [acknowledged, setAcknowledged] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const [invalidFields, setInvalidFields] = useState<
		Record<string, boolean>
	>({});
	const base = `/${projectId}/tools/${tool.id}/executions`;
	const schema = tool.definition.input_schema;
	useEffect(() => {
		const element = dialog.current;
		const overflow = document.body.style.overflow;
		element?.showModal();
		document.body.style.overflow = 'hidden';
		let active = true;
		void projectRequest<{ items: ToolExecution[] }>(base)
			.then(page => {
				if (active) setHistory(page.items);
			})
			.catch(e => {
				if (active) setError(e.message);
			});
		return () => {
			active = false;
			element?.close();
			document.body.style.overflow = overflow;
		};
	}, [base]);
	let inputs: Record<string, unknown> = {};
	let valid = true;
	try {
		inputs = JSON.parse(raw);
		if (
			!inputs ||
			typeof inputs !== 'object' ||
			Array.isArray(inputs)
		)
			valid = false;
	} catch {
		valid = false;
	}
	function update(key: string, value: unknown) {
		const next = { ...inputs };
		if (value === undefined) delete next[key];
		else next[key] = value;
		setRaw(JSON.stringify(next, null, 2));
	}
	async function refreshHistory() {
		try {
			const page = await projectRequest<{
				items: ToolExecution[];
			}>(base);
			setHistory(page.items);
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to load history.',
			);
		}
	}
	async function run() {
		if (!valid || busy) return;
		setBusy(true);
		setError('');
		try {
			const response = await projectRequest<ToolExecution>(
				base,
				{
					method: 'POST',
					headers: {
						'Content-Type':
							'application/json',
					},
					body: JSON.stringify({
						arguments: inputs,
						revision: tool.revision,
						request_id: crypto.randomUUID(),
					}),
				},
			);
			setResult(response);
			setUncertain(
				response.status === 'unknown' ||
					response.status === 'running',
			);
			await refreshHistory();
		} catch (e) {
			setError(
				e instanceof Error
					? e.message
					: 'Unable to run tool.',
			);
			setUncertain(
				!(e instanceof ProjectRequestError) ||
					e.status >= 500,
			);
			await refreshHistory();
		} finally {
			setBusy(false);
		}
	}
	return (
		<dialog
			ref={dialog}
			className='mcp-sheet tool-sheet'
			aria-labelledby='tool-title'
			onCancel={e => {
				e.preventDefault();
				if (!busy) onClose();
			}}>
			<header className='mcp-sheet-header'>
				<div>
					<p className='eyebrow'>
						{tool.server_name} · Revision{' '}
						{tool.revision}
					</p>
					<h2 id='tool-title'>{tool.name}</h2>
				</div>
				<button
					className='button'
					disabled={busy}
					onClick={onClose}>
					Close
				</button>
			</header>
			<div className='mcp-sheet-body'>
				<p>
					{tool.definition.description ||
						'No description provided.'}
				</p>
				{error && (
					<p className='mcp-error' role='alert'>
						{error}
					</p>
				)}
				<section className='mcp-sheet-section'>
					<div className='mcp-sheet-section-heading'>
						<h3>Test inputs</h3>
						<div className='tool-modes'>
							<button
								className='button'
								aria-pressed={
									mode ===
									'form'
								}
								disabled={
									!valid ||
									busy
								}
								onClick={() => {
									setInvalidFields(
										{},
									);
									setMode(
										'form',
									);
								}}>
								Form
							</button>
							<button
								className='button'
								aria-pressed={
									mode ===
									'json'
								}
								disabled={busy}
								onClick={() =>
									setMode(
										'json',
									)
								}>
								JSON
							</button>
						</div>
					</div>
					{mode === 'json' ? (
						<label className='tool-field'>
							Arguments (JSON object)
							<textarea
								className='tool-json'
								rows={12}
								value={raw}
								disabled={busy}
								onChange={e =>
									setRaw(
										e
											.target
											.value,
									)
								}
								spellCheck={
									false
								}
							/>
							{!valid && (
								<span className='mcp-error'>
									Enter a
									valid
									JSON
									object.
								</span>
							)}
						</label>
					) : (
						<div className='tool-inputs'>
							{Object.entries(
								schema.properties ??
									{},
							).map(
								([
									name,
									field,
								]) => (
									<InputField
										key={
											name
										}
										name={
											name
										}
										schema={
											field
										}
										required={
											schema.required?.includes(
												name,
											) ??
											false
										}
										value={
											inputs[
												name
											]
										}
										disabled={
											busy
										}
										onInvalid={invalid =>
											setInvalidFields(
												old => ({
													...old,
													[name]: invalid,
												}),
											)
										}
										onChange={value =>
											update(
												name,
												value,
											)
										}
									/>
								),
							)}
							{!Object.keys(
								schema.properties ??
									{},
							).length && (
								<p>
									This
									tool has
									no form
									fields.
									Use JSON
									for
									additional
									inputs.
								</p>
							)}
						</div>
					)}
					<details className='tool-schema'>
						<summary>Input schema</summary>
						<pre>
							{JSON.stringify(
								schema,
								null,
								2,
							)}
						</pre>
					</details>
					{!canManage ? (
						<p className='mcp-note'>
							Your project role can
							inspect results but
							cannot run tools.
						</p>
					) : !tool.available ||
					  !tool.enabled ||
					  !tool.server_enabled ? (
						<p className='mcp-note'>
							Enable this tool and its
							MCP server before
							testing. Rediscover
							tools if the connection
							changed.
						</p>
					) : (
						<>
							<label className='tool-confirm'>
								<input
									type='checkbox'
									checked={
										acknowledged
									}
									disabled={
										busy
									}
									onChange={e =>
										setAcknowledged(
											e
												.target
												.checked,
										)
									}
								/>
								Run against the
								connected
								server. This may
								read or change
								its data.
							</label>
							<button
								className='button primary'
								disabled={
									busy ||
									!valid ||
									!acknowledged ||
									uncertain ||
									(mode ===
										'form' &&
										Object.values(
											invalidFields,
										).some(
											Boolean,
										))
								}
								onClick={() =>
									void run()
								}>
								{busy
									? 'Running…'
									: 'Run tool'}
							</button>
						</>
					)}
					{uncertain && (
						<div
							className='tool-warning'
							role='status'>
							<p>
								The outcome may
								be unknown.
								Check the saved
								history and
								remote system
								before running
								again.
							</p>
							<button
								className='button'
								onClick={() => {
									setUncertain(
										false,
									);
									setAcknowledged(
										false,
									);
								}}>
								I have checked
								the outcome
							</button>
						</div>
					)}
				</section>
				{result && (
					<section className='mcp-sheet-section'>
						<h3>Test result</h3>
						<Execution execution={result} />
					</section>
				)}
				<section className='mcp-sheet-section'>
					<div className='mcp-sheet-section-heading'>
						<h3>Recent tests</h3>
						<button
							className='button'
							disabled={busy}
							onClick={() =>
								void refreshHistory()
							}>
							Refresh history
						</button>
					</div>
					<p className='mcp-note'>
						Last 20 tests. Inputs and
						results are saved with the tool
						revision.
					</p>
					{!history.length ? (
						<p>No tests recorded.</p>
					) : (
						history.map(execution => (
							<details
								className='tool-history'
								key={
									execution.id
								}>
								<summary>
									{new Date(
										execution.created_at,
									).toLocaleString()}{' '}
									·{' '}
									{execution.status.replaceAll(
										'_',
										' ',
									)}{' '}
									·
									revision{' '}
									{
										execution.revision
									}
								</summary>
								<Execution
									execution={
										execution
									}
								/>
							</details>
						))
					)}
				</section>
			</div>
		</dialog>
	);
}
function Execution({ execution }: { execution: ToolExecution }) {
	const envelope =
		execution.result && typeof execution.result === 'object'
			? (execution.result as Record<string, unknown>)
			: null;
	const output =
		envelope?.structuredContent ??
		envelope?.content ??
		execution.result;
	return (
		<div>
			<p className='tool-result-meta'>
				{execution.status.replaceAll('_', ' ')}
				{execution.duration_ms !== null
					? ` · ${execution.duration_ms} ms`
					: ''}
				{execution.error_code
					? ` · ${execution.error_code}`
					: ''}
			</p>
			{execution.status === 'unknown' && (
				<p>
					The request may have completed remotely.
					Verify before repeating it.
				</p>
			)}
			<details>
				<summary>Saved inputs</summary>
				<pre>
					{JSON.stringify(
						execution.inputs,
						null,
						2,
					)}
				</pre>
			</details>
			<pre className='tool-output'>
				{JSON.stringify(output, null, 2)}
			</pre>
			<details>
				<summary>Raw response</summary>
				<pre>
					{JSON.stringify(
						execution.result,
						null,
						2,
					)}
				</pre>
			</details>
		</div>
	);
}
function InputField({
	name,
	schema,
	required,
	value,
	disabled,
	onChange,
	onInvalid,
}: {
	name: string;
	schema: Schema;
	required: boolean;
	value: unknown;
	disabled: boolean;
	onInvalid: (invalid: boolean) => void;
	onChange: (value: unknown) => void;
}) {
	const [draft, setDraft] = useState(
		value === undefined ? '' : JSON.stringify(value, null, 2),
	);
	const [invalid, setInvalid] = useState(false);
	const simple = ['string', 'number', 'integer', 'boolean'].includes(
		schema.type ?? '',
	);
	return (
		<label className='tool-field'>
			<span>
				{schema.title ?? name}
				{required ? ' *' : ' (optional)'}
			</span>
			{schema.description && (
				<small>{schema.description}</small>
			)}
			{schema.enum ? (
				<select
					disabled={disabled}
					value={
						value === undefined
							? ''
							: JSON.stringify(value)
					}
					onChange={e =>
						onChange(
							e.target.value
								? JSON.parse(
										e
											.target
											.value,
									)
								: undefined,
						)
					}>
					<option value=''>Not set</option>
					{schema.enum.map(item => (
						<option
							key={JSON.stringify(
								item,
							)}
							value={JSON.stringify(
								item,
							)}>
							{String(item)}
						</option>
					))}
				</select>
			) : schema.type === 'boolean' ? (
				<select
					disabled={disabled}
					value={
						value === undefined
							? ''
							: String(value)
					}
					onChange={e =>
						onChange(
							e.target.value === ''
								? undefined
								: e.target
										.value ===
										'true',
						)
					}>
					<option value=''>Not set</option>
					<option value='true'>True</option>
					<option value='false'>False</option>
				</select>
			) : simple ? (
				<input
					disabled={disabled}
					type={
						schema.type === 'string'
							? 'text'
							: 'number'
					}
					step={
						schema.type === 'integer'
							? 1
							: 'any'
					}
					value={
						value === undefined
							? ''
							: String(value)
					}
					onChange={e =>
						onChange(
							e.target.value === ''
								? undefined
								: schema.type ===
									  'string'
									? e
											.target
											.value
									: Number(
											e
												.target
												.value,
										),
						)
					}
				/>
			) : (
				<>
					<textarea
						disabled={disabled}
						rows={4}
						value={draft}
						placeholder='JSON value'
						onChange={e => {
							setDraft(
								e.target.value,
							);
							try {
								onChange(
									e.target
										.value ===
										''
										? undefined
										: JSON.parse(
												e
													.target
													.value,
											),
								);
								setInvalid(
									false,
								);
								onInvalid(
									false,
								);
							} catch {
								setInvalid(
									true,
								);
								onInvalid(true);
							}
						}}
					/>
					{invalid && (
						<span className='mcp-error'>
							Enter valid JSON before
							running this tool.
						</span>
					)}
				</>
			)}
		</label>
	);
}
