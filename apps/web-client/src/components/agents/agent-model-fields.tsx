'use client';
import type { useAgentEditor } from './use-agent-editor';
import { ModelSelect } from './model-select';

export function AgentModelFields({
	form,
	disabled,
	field,
}: Pick<ReturnType<typeof useAgentEditor>, 'form' | 'disabled' | 'field'>) {
	const settings = form.model_settings;
	return (
		<>
			<p className='mcp-note'>
				Choose a model for this agent. Provider
				credentials are configured on the server.
			</p>
			<ModelSelect
				label='Model'
				value={settings.model}
				disabled={disabled}
				onChange={(model, provider) =>
					field('model_settings', {
						...settings,
						model,
						provider,
					})
				}
			/>
			<label className='tool-field'>
				Temperature (optional)
				<input
					type='number'
					min={0}
					max={2}
					step='0.1'
					value={settings.temperature ?? ''}
					disabled={disabled}
					onChange={e =>
						field('model_settings', {
							...settings,
							temperature:
								e.target
									.value ===
								''
									? null
									: Number(
											e
												.target
												.value,
										),
						})
					}
				/>
				<small>
					Leave blank for the model default.
				</small>
			</label>
		</>
	);
}
