'use client';
export default function WorkspaceError({ reset }: { reset: () => void }) {
	return <section className='panel project-feedback' role='alert'><h1>Unable to load this page</h1><p>The workspace is temporarily unavailable. Please try again.</p><button className='button' onClick={reset}>Try again</button></section>;
}
