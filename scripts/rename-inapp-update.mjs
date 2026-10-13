// Drives an installed app's own updater for the "Rename upgrade" workflow
// (scripts/windows-rename-upgrade-check.ps1). Two commands:
//
//   node scripts/rename-inapp-update.mjs serve <root> <pfx> <passphrase> <port>
//     Serves the files under <root> over https with the certificate in <pfx>,
//     until it is stopped. The app's update feed points here.
//
//   node scripts/rename-inapp-update.mjs update <devtools port> <version>
//     Does what a user does in the running app: the update check, the download
//     with its signature check, then "restart and install". It calls the
//     app's own commands (update_check, update_install, update_apply) in its
//     page, through the WebView2 DevTools port that
//     WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
//     opens. update_apply starts the installer the way the updater plugin
//     does and ends the app, so the page goes away; that is the success case.
//
// Needs Node 22 or later (global WebSocket and fetch).
import { createServer } from 'node:https';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function serve(root, pfx, passphrase, port) {
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
}

/** The app's page on the DevTools port, as a small CDP client. */
async function connect(port, seconds = 120) {
	const deadline = Date.now() + seconds * 1000;
	let page;
	while (!page) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			page = targets.find((target) => target.type === 'page' && /tauri\.localhost|^tauri:/.test(target.url));
		} catch {
			// the app (or its WebView2) is not up yet
		}
		if (!page) {
			if (Date.now() > deadline) throw new Error(`no app page on DevTools port ${port}`);
			await sleep(1000);
		}
	}
	console.log(`page: ${page.url}`);
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((open, fail) => {
		socket.onopen = open;
		socket.onerror = () => fail(new Error('could not open the DevTools socket'));
	});
	let last = 0;
	const waiting = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		const done = waiting.get(message.id);
		if (done) {
			waiting.delete(message.id);
			done(message);
		}
	};
	socket.onclose = () => {
		for (const done of waiting.values()) done({ closed: true });
		waiting.clear();
	};
	const send = (method, params) =>
		new Promise((done) => {
			const id = ++last;
			waiting.set(id, done);
			socket.send(JSON.stringify({ id, method, params }));
		});
	/** Evaluates `expression` in the page; `closed` when the page went away meanwhile. */
	const evaluate = async (expression) => {
		const message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (message.closed) return { closed: true };
		if (message.error) throw new Error(JSON.stringify(message.error));
		const { result, exceptionDetails } = message.result;
		if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
		return { value: result.value };
	};
	return { socket, evaluate };
}

async function update(port, version) {
	const { socket, evaluate } = await connect(port);
	for (let i = 0; ; i++) {
		const ready = await evaluate(`typeof window.__TAURI_INTERNALS__?.invoke === 'function'`);
		if (ready.value) break;
		if (i > 120) throw new Error('the page never got the Tauri IPC');
		await sleep(500);
	}
	const running = await evaluate(
		`window.__TAURI_INTERNALS__.invoke('plugin:app|version').catch((error) => 'unknown (' + error + ')')`
	);
	console.log(`app version: ${running.value}`);
	// The app checks by itself a few seconds after it starts and asks the user;
	// let that check finish first, so the two do not overlap.
	await sleep(15000);
	const found = (await evaluate(`window.__TAURI_INTERNALS__.invoke('update_check')`)).value;
	console.log(`update_check: ${JSON.stringify(found)}`);
	if (!found || found.version !== version) throw new Error(`expected the update to ${version}`);
	// "Update now": download and verify the signature. The progress channel is
	// what the app's own Channel object sends (`__CHANNEL__:<callback id>`).
	await evaluate(`(() => {
		const tauri = window.__TAURI_INTERNALS__;
		const id = tauri.transformCallback(() => {});
		return tauri.invoke('update_install', { onEvent: '__CHANNEL__:' + id });
	})()`);
	console.log('downloaded and verified');
	// "Restart and install": the app starts the installer and exits.
	const applied = await evaluate(
		`window.__TAURI_INTERNALS__.invoke('update_apply').then(() => 'returned', (error) => 'failed: ' + error)`
	);
	if (!applied.closed) throw new Error(`update_apply ${applied.value}; the app is still running`);
	console.log('the app exited to install the update');
	socket.close();
}

const [command, ...args] = process.argv.slice(2);
if (command === 'serve' && args.length === 4) {
	serve(...args);
} else if (command === 'update' && args.length === 2) {
	await update(...args);
	process.exit(0);
} else {
	console.error('usage: rename-inapp-update.mjs serve <root> <pfx> <passphrase> <port> | update <devtools port> <version>');
	process.exit(2);
}
