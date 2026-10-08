import Link from 'next/link';

export default function NotFound() {
	return (
		<section className='panel empty-state'>
			<span className='eyebrow'>404</span>
			<h1>Page not found</h1>
			<p>This project or page is not available.</p>
			<Link className='button primary' href='/projects'>
				Back to projects
			</Link>
		</section>
	);
}
