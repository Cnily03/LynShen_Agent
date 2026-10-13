// A local update feed for the "Rename upgrade" workflow
// (scripts/windows-rename-upgrade-check.ps1): serves the files under <root>
// over https with the certificate in <pfx>, until it is stopped. The old app's
// updater is pointed here (desktop_update_url in ~/.lynshen/config.json), so
// it finds, downloads and verifies the update the way it does from the
// release server. Each request is logged on stdout.
//
//   node scripts/rename-update-feed.mjs <root> <pfx> <passphrase> <port>
import { createServer } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const [root, pfx, passphrase, port] = process.argv.slice(2);
if (!port) {
	console.error('usage: rename-update-feed.mjs <root> <pfx> <passphrase> <port>');
	process.exit(2);
}
const base = resolve(root);
createServer({ pfx: readFileSync(pfx), passphrase }, (request, response) => {
	const path = resolve(base, '.' + decodeURIComponent(new URL(request.url, 'https://feed').pathname));
	let size = -1;
	try {
		if (path.startsWith(base + sep)) size = statSync(path).size;
	} catch {
		// missing: 404 below
	}
	console.log(`${new Date().toISOString()} ${request.method} ${request.url} ${size < 0 ? 404 : 200}`);
	if (size < 0) {
		response.writeHead(404).end();
		return;
	}
	const type = path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
	response.writeHead(200, { 'content-type': type, 'content-length': size });
	if (request.method === 'HEAD') response.end();
	else createReadStream(path).pipe(response);
}).listen(Number(port));
console.log(`serving ${base} on https://localhost:${port}/`);
