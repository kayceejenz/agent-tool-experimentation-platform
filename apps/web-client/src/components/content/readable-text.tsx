import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode {
	return text
		.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
		.map((part, index) =>
			part.startsWith('**') && part.endsWith('**') ? (
				<strong key={index}>{part.slice(2, -2)}</strong>
			) : part.startsWith('`') && part.endsWith('`') ? (
				<code key={index}>{part.slice(1, -1)}</code>
			) : (
				<Fragment key={index}>{part}</Fragment>
			),
		);
}
/** Render common model formatting as React text; never inject model HTML. */
export function ReadableText({ text }: { text: string }) {
	const blocks: ReactNode[] = [],
		lines = text.split('\n');
	let paragraph: string[] = [];
	function flush() {
		if (paragraph.length) {
			blocks.push(
				<p key={blocks.length}>
					{inline(paragraph.join('\n'))}
				</p>,
			);
			paragraph = [];
		}
	}
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line.startsWith('```')) {
			flush();
			const code: string[] = [];
			index++;
			while (
				index < lines.length &&
				!lines[index].startsWith('```')
			)
				code.push(lines[index++]);
			blocks.push(
				<pre key={blocks.length}>
					<code>{code.join('\n')}</code>
				</pre>,
			);
		} else if (/^#{1,6}\s/.test(line)) {
			flush();
			blocks.push(
				<h4 key={blocks.length}>
					{inline(line.replace(/^#{1,6}\s+/, ''))}
				</h4>,
			);
		} else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
			flush();
			const ordered = /^\s*\d+\./.test(line),
				items: ReactNode[] = [];
			while (
				index < lines.length &&
				(ordered
					? /^\s*\d+\.\s+/.test(lines[index])
					: /^\s*[-*]\s+/.test(lines[index]))
			) {
				items.push(
					<li key={items.length}>
						{inline(
							lines[index].replace(
								/^\s*([-*]|\d+\.)\s+/,
								'',
							),
						)}
					</li>,
				);
				index++;
			}
			index--;
			blocks.push(
				ordered ? (
					<ol key={blocks.length}>{items}</ol>
				) : (
					<ul key={blocks.length}>{items}</ul>
				),
			);
		} else if (!line.trim()) flush();
		else paragraph.push(line);
	}
	flush();
	return <div className='readable-text'>{blocks}</div>;
}
