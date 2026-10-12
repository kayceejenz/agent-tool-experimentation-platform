'use client';
import { useEffect, useRef } from 'react';

export function UnsavedChanges({
	onKeepEditing,
	onDiscard,
}: {
	onKeepEditing: () => void;
	onDiscard: () => void;
}) {
	const keepEditing = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		keepEditing.current?.focus();
		return () => {
			requestAnimationFrame(() => {
				if (opener?.isConnected) opener.focus();
			});
		};
	}, []);
	return (
		<div className='prompt-discard' role='alert'>
			<p>You have unsaved changes.</p>
			<div className='mcp-header-actions'>
				<button
					className='button'
					type='button'
					ref={keepEditing}
					onClick={onKeepEditing}>
					Keep editing
				</button>
				<button
					className='button'
					type='button'
					onClick={onDiscard}>
					Discard changes
				</button>
			</div>
		</div>
	);
}
