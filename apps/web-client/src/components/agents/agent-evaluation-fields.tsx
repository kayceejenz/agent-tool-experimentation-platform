'use client';
import { ClipboardCheck } from 'lucide-react';
import type { useAgentEditor } from './use-agent-editor';
import { PromptPicker } from './prompt-picker';
import { ModelSelect } from './model-select';

type Props = Pick<ReturnType<typeof useAgentEditor>, 'form' | 'field' | 'evaluationPrompt' | 'setEvaluationPrompt' | 'setPickerBusy' | 'disabled'> & { projectId: string };
const dimensions = ['Task completion', 'Tool selection', 'Tool inputs', 'Use of results', 'Answer quality', 'Efficiency', 'Write handling'];

export function AgentEvaluationFields({ form, field, evaluationPrompt, setEvaluationPrompt, setPickerBusy, disabled, projectId }: Props) {
    const profile = form.evaluation_profile;
    return <div className='agent-evaluation-settings'>
        <div className='evaluation-intro'><ClipboardCheck size={22} aria-hidden='true' /><div>
            <h3>Evaluate every finished request</h3>
            <p>Review how the agent used its tools and whether the answer fulfilled the request.</p>
        </div></div>
        <label className='evaluation-toggle'>
            <input type='checkbox' checked={profile.enabled} disabled={disabled}
                onChange={e => field('evaluation_profile', { ...profile, enabled: e.target.checked })} />
            <span><strong>Automatic evaluation</strong><small>Runs after the request finishes, including requests that fail or stop.</small></span>
            <span className='evaluation-toggle-state'>{profile.enabled ? 'On' : 'Off'}</span>
        </label>
        <div className='evaluation-rubric-preview'>
            <h4>What gets reviewed</h4>
            <div className='evaluation-dimensions'>{dimensions.map(name => <span key={name}>{name}</span>)}</div>
            <p>Each finding links to the recorded evidence. Missing evidence is marked unknown.</p>
        </div>
        <ModelSelect label='Evaluator model' value={profile.model ?? ''} disabled={disabled}
            inherit={`Use agent model${form.model_settings.model ? ` (${form.model_settings.model})` : ''}`}
            onChange={model => field('evaluation_profile', { ...profile, model: model || null })} />
        <p className='mcp-note'>Each evaluation uses additional model tokens.</p>
        <details className='evaluation-custom-rubric' open={!!evaluationPrompt}>
            <summary>Additional evaluation instructions <span>{evaluationPrompt ? `${evaluationPrompt.name} · v${evaluationPrompt.revision}` : 'Optional'}</span></summary>
            <p className='mcp-note'>Add domain-specific checks to the standard rubric. The selected revision is saved with this agent.</p>
            <PromptPicker projectId={projectId} kind='evaluation' value={evaluationPrompt} disabled={disabled}
                onChange={setEvaluationPrompt} onBusyChange={setPickerBusy} />
        </details>
    </div>;
}
