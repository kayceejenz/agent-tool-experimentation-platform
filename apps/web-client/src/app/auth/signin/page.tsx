'use client';
import { useSearchParams } from 'next/navigation';
import {
	Suspense,
	useEffect,
	useState,
	type FormEvent,
	type KeyboardEvent,
} from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import {
	authFetch,
	ensureLogin,
	notifyAuthChange,
	withAuthLock,
} from '@/lib/auth/client';
import { safeCallback } from '@/lib/auth/shared';

function SignInContent() {
	const params = useSearchParams();
	const callback = safeCallback(params.get('callbackUrl'));
	const [mode, setMode] = useState<'signin' | 'register'>('signin');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [name, setName] = useState('');
	const [invitation, setInvitation] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState('');
	const [error, setError] = useState(
		params.get('error') === 'SessionExpired'
			? 'Your session expired. Sign in again to continue.'
			: '',
	);

	useEffect(() => {
		let active = true;
		void ensureLogin()
			.then(response => {
				if (active && response.ok)
					window.location.replace(callback);
			})
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [callback]);

	function changeMode(next: 'signin' | 'register') {
		setMode(next);
		setError('');
		setNotice('');
	}

	function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
			return;
		event.preventDefault();
		const next = mode === 'signin' ? 'register' : 'signin';
		changeMode(next);
		document.getElementById(`tab-${next}`)?.focus();
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError('');
		try {
			await withAuthLock(async () => {
				if (mode === 'register') {
					const response = await authFetch(
						'/api/auth/register',
						{
							method: 'POST',
							headers: {
								'Content-Type':
									'application/json',
							},
							body: JSON.stringify({
								email,
								password,
								display_name:
									name.trim() ||
									null,
								invitation_code:
									invitation,
							}),
						},
					);
					const body = await response.json();
					if (!response.ok)
						throw new Error(
							body.error ??
								'Unable to create your account.',
						);
					setMode('signin');
					setNotice(
						'Account created. You can now sign in.',
					);
				}
				const response = await authFetch(
					'/api/auth/login',
					{
						method: 'POST',
						headers: {
							'Content-Type':
								'application/json',
						},
						body: JSON.stringify({
							email,
							password,
						}),
					},
				);
				const body = await response.json();
				if (!response.ok)
					throw new Error(
						body.error ??
							'Unable to sign in.',
					);
			});
			notifyAuthChange();
			window.location.replace(callback);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: 'Unable to connect. Please try again.',
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<main className='signin-page'>
			<div className='signin-decoration' />
			<section
				className='signin-card'
				aria-labelledby='signin-title'
				aria-busy={busy || undefined}>
				<div className='signin-card-header'>
					<div className='signin-brand'>
						kayceejenz.ai <span>Agent</span>
					</div>
					<ThemeToggle disabled={busy} />
				</div>
				<div className='signin-copy'>
					<h1 id='signin-title'>
						{mode === 'signin'
							? 'Welcome back'
							: 'Create your account'}
					</h1>
					<p>
						{mode === 'signin'
							? 'Sign in to continue to your agent workspace.'
							: 'Start building and evaluating your agents.'}
					</p>
				</div>
				<div
					className='auth-tabs'
					role='tablist'
					aria-label='Authentication mode'>
					{(['signin', 'register'] as const).map(
						tab => (
							<button
								key={tab}
								id={`tab-${tab}`}
								role='tab'
								type='button'
								aria-selected={
									mode ===
									tab
								}
								aria-controls='auth-panel'
								tabIndex={
									mode ===
									tab
										? 0
										: -1
								}
								className={
									mode ===
									tab
										? 'active'
										: ''
								}
								disabled={busy}
								onKeyDown={
									tabKey
								}
								onClick={() =>
									changeMode(
										tab,
									)
								}>
								{tab ===
								'signin'
									? 'Sign in'
									: 'Create account'}
							</button>
						),
					)}
				</div>
				{error && (
					<div
						className='signin-error'
						role='alert'>
						<CircleAlert
							size={16}
							aria-hidden
						/>
						<span>{error}</span>
					</div>
				)}
				{notice && (
					<p
						className='signin-notice'
						role='status'>
						{notice}
					</p>
				)}
				<div
					id='auth-panel'
					role='tabpanel'
					aria-labelledby={`tab-${mode}`}>
					<form
						className='auth-form'
						onSubmit={submit}>
						{mode === 'register' && (
							<label>
								<span>
									Display
									name
								</span>
								<input
									autoComplete='name'
									value={
										name
									}
									onChange={e =>
										setName(
											e
												.target
												.value,
										)
									}
									maxLength={
										160
									}
									placeholder='Optional'
									disabled={
										busy
									}
								/>
							</label>
						)}
						<label>
							<span>Email</span>
							<input
								type='email'
								autoComplete='email'
								value={email}
								onChange={e =>
									setEmail(
										e
											.target
											.value,
									)
								}
								maxLength={320}
								placeholder='you@example.com'
								required
								disabled={busy}
							/>
						</label>
						<label>
							<span id='password-label'>
								Password
							</span>
							<input
								type='password'
								aria-labelledby='password-label'
								aria-describedby={
									mode ===
									'register'
										? 'password-hint'
										: undefined
								}
								autoComplete={
									mode ===
									'signin'
										? 'current-password'
										: 'new-password'
								}
								value={password}
								onChange={e =>
									setPassword(
										e
											.target
											.value,
									)
								}
								minLength={
									mode ===
									'register'
										? 12
										: 1
								}
								maxLength={1024}
								placeholder='••••••••••••'
								required
								disabled={busy}
							/>
							{mode ===
								'register' && (
								<small id='password-hint'>
									At least
									12
									characters.
								</small>
							)}
						</label>
						{mode === 'register' && (
							<label>
								<span>
									Invitation
									code
								</span>
								<input
									type='password'
									autoComplete='off'
									value={
										invitation
									}
									onChange={e =>
										setInvitation(
											e
												.target
												.value,
										)
									}
									placeholder='Provided with your invitation'
									disabled={
										busy
									}
								/>
								<small>
									Enter
									the code
									included
									with
									your
									invitation.
								</small>
							</label>
						)}
						<button
							type='submit'
							className='auth-submit'
							disabled={busy}>
							{busy && (
								<LoaderCircle
									className='signin-spin'
									size={
										16
									}
									aria-hidden
								/>
							)}
							{busy
								? 'Please wait…'
								: mode ===
									  'signin'
									? 'Sign in'
									: 'Create account'}
						</button>
					</form>
				</div>
			</section>
		</main>
	);
}

export default function SignInPage() {
	return (
		<Suspense>
			<SignInContent />
		</Suspense>
	);
}
