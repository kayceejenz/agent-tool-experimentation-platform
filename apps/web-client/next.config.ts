import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	// Production builds must not overwrite a running dev server's CSS manifests.
	distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
	poweredByHeader: false,
	async headers() {
		return [
			{
				source: '/:path*',
				headers: [
					{
						key: 'X-Content-Type-Options',
						value: 'nosniff',
					},
					{
						key: 'X-Frame-Options',
						value: 'DENY',
					},
					{
						key: 'Referrer-Policy',
						value: 'strict-origin-when-cross-origin',
					},
					{
						key: 'Permissions-Policy',
						value: 'camera=(), microphone=(), geolocation=()',
					},
					...(process.env.APP_ORIGIN?.startsWith(
						'https://',
					)
						? [
								{
									key: 'Strict-Transport-Security',
									value: 'max-age=31536000',
								},
							]
						: []),
				],
			},
		];
	},
};
export default nextConfig;
