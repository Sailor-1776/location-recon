import './globals.css';

export const metadata = {
	title: 'Location Reconciliation Review',
	description: 'Review CLOSE matches and export NEW as CSV',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}


