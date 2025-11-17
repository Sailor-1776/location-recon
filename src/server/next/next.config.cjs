/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	// Explicitly externalize native packages on the server (stable option)
	serverExternalPackages: ['odbc', '@mapbox/node-pre-gyp', 'mssql'],
	experimental: {
		externalDir: true,
		// Ensure native/binary packages are treated as externals in RSC/route handlers
		serverComponentsExternalPackages: ['odbc', '@mapbox/node-pre-gyp', 'mssql'],
	},
	webpack: (config, { isServer, webpack }) => {
		// Ensure native/binary helpers are not bundled; they are Node-only.
		const isOdbcDriver = process.env.MR8_DRIVER === 'odbc';
		const isMssqlDriver = process.env.MR8_DRIVER === 'sqlserver';
		config.plugins = config.plugins || [];
		config.plugins.push(
			new webpack.IgnorePlugin({
				resourceRegExp: /@mapbox\/node-pre-gyp/,
			}),
		);
		// Specifically ignore the HTML file that's causing issues (match by context + relative request)
		config.plugins.push(
			new webpack.IgnorePlugin({
				resourceRegExp: /^\.\/index\.html$/,
				contextRegExp: /@mapbox[\/\\]node-pre-gyp[\/\\]lib[\/\\]util[\/\\]nw-pre-gyp/,
			}),
		);

		// Fallback: treat HTML files under @mapbox/node-pre-gyp as raw strings so webpack doesn't try to parse them as JS
		config.module = config.module || {};
		config.module.rules = config.module.rules || [];
		config.module.rules.push({
			test: /\.html$/,
			type: 'asset/source',
			include: [/node_modules[\/\\]@mapbox[\/\\]node-pre-gyp/],
		});

		// Add externals for server-side code (including API routes)
		config.externals = config.externals || [];
		config.externals.push('odbc');
		config.externals.push('@mapbox/node-pre-gyp');
		config.externals.push('mssql');

		// Custom externals function to handle problematic modules
		config.externals.push((context, request, callback) => {
			// Externalize any request that includes @mapbox/node-pre-gyp
			if (request.includes('@mapbox/node-pre-gyp')) {
				return callback(null, 'commonjs ' + request);
			}
			// Externalize any HTML files in node_modules
			if (request.endsWith('.html') && request.includes('node_modules')) {
				return callback(null, 'commonjs ' + request);
			}
			callback();
		});

		if (!isServer) {
			config.resolve = config.resolve || {};
			config.resolve.alias = {
				...(config.resolve.alias || {}),
				odbc: false,
				'@mapbox/node-pre-gyp': false,
				mssql: false,
			};
		} else {
			// On the server, if those drivers are not selected, stub them out too.
			config.resolve = config.resolve || {};
			config.resolve.alias = {
				...(config.resolve.alias || {}),
				...(isOdbcDriver
					? {}
					: {
							odbc: false,
							'@mapbox/node-pre-gyp': false,
					  }),
				...(isMssqlDriver ? {} : { mssql: false }),
			};
		}
		return config;
	},
};
module.exports = nextConfig;


