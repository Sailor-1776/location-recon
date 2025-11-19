/** @type {import('next').NextConfig} */
const nextConfig = {
	output: 'standalone',
	// Explicitly externalize native packages on the server (stable option)
	serverExternalPackages: ['odbc', '@mapbox/node-pre-gyp', 'mssql', 'pdfjs-dist'],
	experimental: {
		externalDir: true,
		// Ensure native/binary packages are treated as externals in RSC/route handlers
		serverComponentsExternalPackages: ['odbc', '@mapbox/node-pre-gyp', 'mssql', 'pdfjs-dist'],
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
		// Ignore pdfjs-dist worker files and build artifacts that webpack shouldn't process
		if (isServer) {
			config.plugins.push(
				new webpack.IgnorePlugin({
					resourceRegExp: /pdfjs-dist\/build\/pdf\.worker/,
				}),
			);
		}

		// Fallback: treat HTML files under @mapbox/node-pre-gyp as raw strings so webpack doesn't try to parse them as JS
		config.module = config.module || {};
		config.module.rules = config.module.rules || [];
		config.module.rules.push({
			test: /\.html$/,
			type: 'asset/source',
			include: [/node_modules[\/\\]@mapbox[\/\\]node-pre-gyp/],
		});

		// Note: serverExternalPackages in Next.js config handles most externals.
		// We only add webpack externals if Next.js hasn't already set them up.
		// The HTML file handling is done via IgnorePlugin and module rules above.

		// Explicitly externalize pdfjs-dist for server-side builds
		// This prevents webpack from trying to bundle it, which causes Object.defineProperty errors
		if (isServer) {
			if (!config.externals) {
				config.externals = [];
			} else if (!Array.isArray(config.externals)) {
				config.externals = [config.externals];
			}
			
			// Add pdfjs-dist as an external using a function that handles webpack 5 signature
			// This must match ALL pdfjs-dist imports including .mjs files to prevent bundling
			const pdfjsExternal = (data, callback) => {
				// Handle webpack 5 signature: ({ context, request }, callback)
				if (data && typeof data === 'object' && 'request' in data) {
					const request = data.request;
					if (request && typeof request === 'string') {
						// Match pdfjs-dist and all its submodules/paths (including .mjs files)
						if (request === 'pdfjs-dist' || 
						    request.startsWith('pdfjs-dist/') ||
						    request.includes('pdfjs-dist/build/') ||
						    request.includes('pdfjs-dist/legacy/') ||
						    /pdfjs-dist/.test(request)) {
							// Return as commonjs external - webpack will not bundle it
							return callback(null, `commonjs ${request}`);
						}
					}
					return callback();
				}
				
				// Handle webpack 4 signature: (context, request, callback) - fallback
				if (typeof callback === 'function' && typeof data === 'string') {
					const request = data;
					if (request === 'pdfjs-dist' || 
					    request.startsWith('pdfjs-dist/') ||
					    request.includes('pdfjs-dist/build/') ||
					    request.includes('pdfjs-dist/legacy/') ||
					    /pdfjs-dist/.test(request)) {
						return callback(null, `commonjs ${request}`);
					}
					return callback();
				}
				
				// Default: continue with normal resolution
				if (typeof callback === 'function') {
					callback();
				}
			};
			
			// Check if pdfjs external function already exists
			const hasPdfjsExternal = config.externals.some(ext => 
				typeof ext === 'function' && ext.toString().includes('pdfjs-dist')
			);
			
			if (!hasPdfjsExternal) {
				config.externals.push(pdfjsExternal);
			}
			
			// Also add as string external for the main module
			if (!config.externals.some(ext => ext === 'pdfjs-dist' || (typeof ext === 'string' && ext === 'pdfjs-dist'))) {
				config.externals.push('pdfjs-dist');
			}
		}

		// Ensure React resolves from root node_modules to avoid duplicate instances
		config.resolve = config.resolve || {};
		config.resolve.modules = config.resolve.modules || [];
		// Add root node_modules to the beginning of the resolve path
		const path = require('path');
		const rootNodeModules = path.resolve(__dirname, '../../../node_modules');
		if (!config.resolve.modules.includes(rootNodeModules)) {
			config.resolve.modules.unshift(rootNodeModules);
		}

		if (!isServer) {
			config.resolve.alias = {
				...(config.resolve.alias || {}),
				odbc: false,
				'@mapbox/node-pre-gyp': false,
				mssql: false,
			};
		} else {
			// On the server, if those drivers are not selected, stub them out too.
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
			// Don't alias pdfjs-dist - we want to externalize it, not stub it
		}
		return config;
	},
};
module.exports = nextConfig;


