export const modelCatalog = [
    { id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o mini', tier: 'Budget', performance: 'Fast · focused tasks', input: 0.15, output: 0.60 },
    { id: 'gpt-4.1-mini', provider: 'openai', name: 'GPT-4.1 mini', tier: 'Balanced', performance: 'Fast · tool use and general tasks', input: 0.40, output: 1.60 },
    { id: 'gpt-4.1', provider: 'openai', name: 'GPT-4.1', tier: 'Higher cost', performance: 'Complex instructions and coding', input: 2, output: 8 },
    { id: 'gemini-2.5-flash-lite', provider: 'google', name: 'Gemini 2.5 Flash-Lite', tier: 'Budget', performance: 'Fast · high-volume tasks', input: 0.10, output: 0.40 },
    { id: 'gemini-2.5-flash', provider: 'google', name: 'Gemini 2.5 Flash', tier: 'Balanced', performance: 'Speed and reasoning balance', input: 0.30, output: 2.50 },
    { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', tier: 'Higher cost', performance: 'Complex reasoning and coding', input: 1.25, output: 10 },
] as const;
export const modelOptionLabel = (model: typeof modelCatalog[number]) => `${model.name} · ${model.tier} · ${model.performance}`;
export const pricingSources = { openai: 'https://developers.openai.com/api/docs/pricing', google: 'https://ai.google.dev/gemini-api/docs/pricing' };
