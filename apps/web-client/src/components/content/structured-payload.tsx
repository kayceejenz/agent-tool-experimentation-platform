'use client';

// Decode JSON embedded in MCP text blocks for the formatted display.
function displayValue(value: unknown, depth = 0): unknown {
    if (depth > 6) return value;
    if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
        try { return displayValue(JSON.parse(value), depth + 1); }
        catch { return value; }
    }
    if (Array.isArray(value)) return value.map(item => displayValue(item, depth + 1));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayValue(item, depth + 1)]));
    return value;
}

function responseContent(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const envelope = value as Record<string, unknown>;
    const result = envelope.result && typeof envelope.result === 'object'
        ? envelope.result as Record<string, unknown> : envelope;
    if (result.structuredContent != null) return result.structuredContent;
    if (Array.isArray(result.content) && result.content.length && result.content.every(
        block => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string',
    )) {
        const blocks = result.content.map(block => displayValue(block.text));
        return blocks.length === 1 ? blocks[0] : blocks;
    }
    return value;
}

export function StructuredPayload({ value, label, response = false }: { value: unknown; label: string; response?: boolean }) {
    const formatted = displayValue(response ? responseContent(value) : value);
    return <div className='structured-payload' role='region' aria-label={label}>
        <pre className='payload-json'><code>{JSON.stringify(formatted, null, 2) ?? 'null'}</code></pre>
    </div>;
}
