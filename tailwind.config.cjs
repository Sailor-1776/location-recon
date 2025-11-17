/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		'./src/server/next/app/**/*.{js,ts,jsx,tsx,mdx}',
		'./src/server/next/components/**/*.{js,ts,jsx,tsx,mdx}',
	],
	theme: {
		extend: {
			colors: {
				border: '#e5e7eb',
			},
		},
	},
	plugins: [],
};


