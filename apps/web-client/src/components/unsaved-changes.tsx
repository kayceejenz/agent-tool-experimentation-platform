'use client';

export function UnsavedChanges({
	onKeepEditing,
	onDiscard,
}: {
	onKeepEditing: () => void;
	onDiscard: () => void;
}) {
	return (
		<div className='prompt-discard' role='alert'>
			<p>You have unsaved changes.</p>
			<div className='mcp-header-actions'>
				<button
					className='button'
					type='button'
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
