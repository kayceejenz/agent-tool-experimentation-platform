'use client';
import type { useAgentEditor } from '@/components/agents/use-agent-editor';

export function AgentModelFields({ form, disabled, field }: Pick<ReturnType<typeof useAgentEditor>, 'form' | 'disabled' | 'field'>) {
	return (
		<>
			<p className='mcp-note'>
				Save the
				intended
				provider
				and
				model
				identifiers.
				Supported
				settings
				and
				credentials
				will be
				validated
				in the
				model
				integration
				increment.
				Do not
				enter
				API keys
				here.
			</p>
			<label className='tool-field'>
				Provider
				<input
					maxLength={80}
					pattern='[a-zA-Z0-9_.\-]*'
					value={
						form
							.model_settings
							.provider
					}
					disabled={disabled}
					onChange={e =>
						field(
							'model_settings',
							{
								...form.model_settings,
								provider: e
									.target
									.value,
							},
						)
					}
				/>
			</label>
			<label className='tool-field'>
				Model
				identifier
				<input
					maxLength={160}
					value={
						form
							.model_settings
							.model
					}
					disabled={disabled}
					onChange={e =>
						field(
							'model_settings',
							{
								...form.model_settings,
								model: e
									.target
									.value,
							},
						)
					}
				/>
			</label>
			<label className='tool-field'>
				Temperature
				(optional)
				<input
					type='number'
					min={0}
					max={2}
					step='0.1'
					value={
						form
							.model_settings
							.temperature ??
						''
					}
					disabled={disabled}
					onChange={e =>
						field(
							'model_settings',
							{
								...form.model_settings,
								temperature:
									e
										.target
										.value ===
										''
										? null
										: Number(
											e
												.target
												.value,
										),
							},
						)
					}
				/>
				<small>
					Leave
					blank
					for
					the
					model
					default.
					Some
					models
					may
					not
					support
					this
					setting.
				</small>
			</label>
		</>
	);
}
