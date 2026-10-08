'use client';
import type { Tool } from '@/types/tool';
import { useToolTester } from '@/components/tools/use-tool-tester';
import { InputField } from './tool-input-field';
import { Execution } from './tool-execution';

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
	const {
		dialog,
		operationId,
		recovering,
		mode,
		setMode,
		raw,
		setRaw,
		history,
		busy,
		error,
		result,
		acknowledged,
		setAcknowledged,
		uncertain,
		invalidFields,
		setInvalidFields,
		schema,
		reconcile,
		acknowledgeOutcome,
		inputs,
		valid,
		update,
		refreshHistory,
		run,
	} = useToolTester({ projectId, tool, canManage });
	return (
		<dialog
			ref={dialog}
			className='mcp-sheet tool-sheet'
			aria-labelledby='tool-title'
			onCancel={e => {
				e.preventDefault();
				if(!busy) onClose();
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
								onClick={() => setMode('json')}>
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
								spellCheck={false}
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
										key={name}
										name={name}
										schema={field}
										required={
											schema.required?.includes(
												name,
											) ??
											false
										}
										value={inputs[name]}
										disabled={busy}
										onInvalid={invalid =>
											setInvalidFields(
												old => ({
													...old,
													[name]: invalid,
												}),
											)
										}
										onChange={value => update(name, value)}
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
							{JSON.stringify(schema, null, 2)}
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
									checked={acknowledged}
									disabled={busy}
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
									recovering ||
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
								onClick={() => void run()}>
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
							{operationId && (
								<button
									type='button'
									className='button'
									disabled={
										recovering ||
										busy
									}
									onClick={() => void reconcile()}>
									Recheck
									saved
									operation
								</button>
							)}
							<button
								className='button'
								disabled={
									recovering ||
									busy
								}
								onClick={acknowledgeOutcome}>
								I checked the
								outcome; allow a
								new test
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
							onClick={() => void refreshHistory()}>
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
								key={execution.id}>
								<summary>
									{new Date(execution.created_at).toLocaleString()}{' '}
									·{' '}
									{execution.status.replaceAll('_', ' ')}{' '}
									·
									revision{' '}
									{execution.revision}
								</summary>
								<Execution
									execution={execution}
								/>
							</details>
						))
					)}
				</section>
			</div>
		</dialog>
	);
}
