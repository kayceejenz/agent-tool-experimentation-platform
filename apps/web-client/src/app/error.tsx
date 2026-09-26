'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
	return (
		<main className='signin-page'>
			<section className='signin-card' role='alert'>
				<h1>Unable to connect</h1>
				<p>
					We could not verify your login. Please
					try again.
				</p>
				<button className='auth-submit' onClick={reset}>
					Try again
				</button>
			</section>
		</main>
	);
}
