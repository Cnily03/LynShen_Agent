// The launch screen's fixture: scripts/browser-regression.mjs serves
// src/app.html at / with this script before main.ts (which draws the frame of
// one conversation behind it, ?shell). The clock starts with this script, so
// a slow dev server does not eat the timeline; ?launchReady=<ms> says when
// the app is ready (never: not at all).
import { LaunchScreen, pageEnv } from '../../src/lib/launch';

const t0 = performance.now();
const screen = new LaunchScreen(pageEnv(() => performance.now() - t0));
screen.start();
(window as unknown as { __launch: LaunchScreen }).__launch = screen;
const at = new URL(location.href).searchParams.get('launchReady') ?? '0';
if (at !== 'never') setTimeout(() => screen.ready(), Number(at));
