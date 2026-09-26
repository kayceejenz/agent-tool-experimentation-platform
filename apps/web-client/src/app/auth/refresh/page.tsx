'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ensureLogin, signInUrl } from '@/lib/auth/client';
import { safeCallback } from '@/lib/auth/shared';

function RefreshLogin() {
	const params = useSearchParams();
	const callback = safeCallback(params.get('callbackUrl'));
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		let active = true;
		void ensureLogin()
			.then(response => {
				if (!active) return;
				if (response.ok)
					window.location.replace(callback);
				else if (response.status === 401)
					window.location.replace(
						signInUrl(callback),
					);
				else setError(true);
			})
			.catch(() => {
				if (active) setError(true);
			});
		return () => {
			active = false;
		};
	}, [callback, attempt]);

	return (
		<main className='signin-page'>
			<section className='signin-card'>
				<h1>
					{error
						? 'Unable to reconnect'
						: 'Restoring your login'}
				</h1>
				<p role='status'>
					{error
						? 'The server is temporarily unavailable. Your login has been kept so you can retry.'
						: 'Please wait a moment…'}
				</p>
				{error && (
					<button
						className='auth-submit'
						onClick={() => {
							setError(false);
							setAttempt(attempt + 1);
						}}>
						Try again
					</button>
				)}
			</section>
		</main>
	);
}
export default function RefreshPage() {
	return (
		<Suspense>
			<RefreshLogin />
		</Suspense>
	);
}
