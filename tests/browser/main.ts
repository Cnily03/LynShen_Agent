import { mount } from 'svelte';
import '../../src/lib/app.css';
import { imageSrc, previewFacts } from './previewFiles';
import { SAMPLE_CATALOG, SAMPLE_PLAIN_IDS } from '../../src/lib/models/catalogSample';

const calls: { command: string; args: any }[] = [];
// The picture the app keeps for an account with an avatar (?avatar).
const KEPT_AVATAR = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='teal'/></svg>")}`;
// The window frost choice in storage as the page loads (see set_window_frost).
const frostAtStart = (() => {
  try { return JSON.parse(localStorage.getItem('lynshen-prefs') ?? '{}').sidebarVibrancy === true; } catch { return false; }
})();
// ?trial[=granted|used|404|not_eligible]: signed in, and the gateway's
// answer to the first-use trial claim (a 404 is a gateway without the endpoint).
const trialReply = new URL(location.href).searchParams.get('trial');
// ?latency[=random|<ms>]: the plan's GET / PUT answer that much later
// (random: 300–1500 ms), as a slow gateway would.
const latency = new URL(location.href).searchParams.get('latency');
const slow = () => new Promise((r) => setTimeout(r, latency === 'random' || latency === '' ? 300 + Math.random() * 1200 : Number(latency) || 0));
// ?authorize: the browser approves the device sign-in at the first poll.
// ?freshConfig: a new computer, where config.json names no provider yet.
// ?accountLatency=<ms>: the account (monoize_session) answers that much later.
const params0 = new URL(location.href).searchParams;
const accountLatency = Number(params0.get('accountLatency') || 0);
// ?models[=old]: a gateway account with the sample models (catalogSample.ts):
// the model catalog, or (=old) a gateway without it (404, the plain list only).
const modelsMode = params0.get('models');
let loggedIn = new URL(location.href).searchParams.has('loggedIn') || trialReply != null;
let planFunding = 'plan';
const trialPlan = (used: boolean) => ({
  name: '7 天体验套餐',
  group: '国内模型分组',
  windows: [
    { kind: '5h', quota_cny: '4.00', used_cny: used ? '1.36' : '0.00', resets_at: used ? new Date(Date.now() + 3 * 3_600_000).toISOString() : null },
    { kind: '7d', quota_cny: '10.00', used_cny: used ? '3.58' : '0.00', resets_at: used ? new Date(Date.now() + 5 * 86_400_000).toISOString() : null }
  ],
  expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString()
});
Object.assign(window, {
  __calls: calls,
  __keptAvatar: KEPT_AVATAR,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    // The asset protocol: the stand-in screenshot for a sent PNG.
    convertFileSrc: (path: string) => (path.endsWith('.png') ? imageSrc() : `asset://localhost/${encodeURIComponent(path)}`),
    invoke: async (command: string, args: any) => {
      calls.push({ command, args });
      // `window.__avatarUrl`: the avatar /api/desktop/oauth/me names (?avatar);
      // unset, the user has none (a gateway without DA-12).
      const avatarUrl = (window as unknown as { __avatarUrl?: string }).__avatarUrl;
      if (command === 'monoize_session' && accountLatency) await new Promise((r) => setTimeout(r, accountLatency));
      if (command === 'monoize_session' && loggedIn && avatarUrl) return {logged_in: true, session: {user: {username: 'Test user', avatar_url: avatarUrl}}};
      if (modelsMode != null) {
        if (command === 'monoize_model_catalog') {
          if (modelsMode === 'old') throw JSON.stringify({status: 404, code: null, message: 'Not Found'});
          return SAMPLE_CATALOG;
        }
        if (command === 'fetch_monoize_models') return {data: SAMPLE_PLAIN_IDS.map((id) => ({id, routing_status: 'ready'}))};
        if (command === 'read_config') return {provider: 'monoize', model: 'deepseek-v4.1-flash', models: SAMPLE_PLAIN_IDS.map((name) => ({name})), compact_model: 'glm-5.3-flash', image_model: 'gpt-image-2'};
        if (command === 'read_auth_providers') return ['monoize'];
      }
      switch (command) {
        // ?home: a new install signed in to the gateway, whose engine has
        // not written its own list yet.
        case 'read_config': return params0.has('freshConfig') ? {} : new URL(location.href).searchParams.has('home')
          ? {provider: 'monoize', model: 'deepseek-v4.1-flash', models: [], lynshen_models: [{name: 'deepseek-v4.1-flash', context_window: 1000000}, {name: 'claude-opus-5-5', display_name: 'Claude Opus 5.5'}, {name: 'gpt-image-2'}]}
          : {provider: 'monoize', models: []};
        case 'read_auth_providers': return loggedIn ? ['monoize'] : [];
        case 'list_providers': return [{id:'openai',base_url:'https://api.openai.com/v1',protocol:'responses',models:[{name:'gpt-5'}]}, {id:'openai-codex',base_url:'https://chatgpt.com/backend-api/codex',protocol:'openai-codex-responses',models:[{name:'gpt-5'}]}];
        case 'monoize_session': return {logged_in:loggedIn, session:loggedIn ? {user:{id:'user-1', username:'Test user'}} : null};
        case 'desktop_installation_id': return 'inst-browser';
        case 'monoize_trial_claim':
          if (trialReply === '404') throw JSON.stringify({status: 404, code: null, message: 'Not Found'});
          if (trialReply === 'not_eligible') return {status: 'not_eligible'};
          return {status: 'granted', plan: trialPlan(trialReply === 'used')};
        // GET / PUT /api/desktop/oauth/plan (an older gateway with ?trial=404).
        case 'monoize_desktop_plan':
        case 'monoize_set_plan_funding':
          if (trialReply === '404' || trialReply === 'not_eligible' || trialReply == null) throw JSON.stringify({status: 404, code: null, message: 'Not Found'});
          if (command === 'monoize_set_plan_funding') planFunding = args.funding;
          {
            // The gateway stores a change as it arrives and answers later.
            const answer = {plan: {...trialPlan(trialReply === 'used'), trial: true, active: true}, plan_funding: planFunding};
            if (latency != null) await slow();
            return answer;
          }
        case 'monoize_logout': loggedIn = false; return;
        case 'monoize_oauth_start': return {user_code:'ABCDEF123456',verification_uri_complete:'https://www.lynshen.org/oauth/authorize?user_code=ABCDEF123456'};
        case 'monoize_oauth_poll':
          if (!params0.has('authorize')) return {pending:true};
          loggedIn = true;
          return {user: {id: 'user-1', username: 'Test user', role: 'user'}};
        // The tools a new computer has: Git, no Node, no Claude Code or Codex.
        case 'check_dependencies': return [
          {id: 'node', present: false, detail: '', plan: {kind: 'run', program: '', args: []}},
          {id: 'git', present: true, detail: 'git 2.46', plan: {kind: 'run', program: '', args: []}},
          {id: 'lynshen', present: true, detail: 'lynshen 0.6.0', plan: {kind: 'run', program: '', args: []}},
          {id: 'claude', present: false, detail: '', plan: {kind: 'run', program: '', args: []}},
          {id: 'codex', present: false, detail: '', plan: {kind: 'run', program: '', args: []}}
        ];
        case 'check_backend': return args.backend === 'lynshen' ? {found: true, version: '0.6.0'} : {found: false};
        case 'fetch_monoize_models': return {data:[]};
        case 'monoize_model_catalog': throw JSON.stringify({status: 404, code: null, message: 'Not Found'});
        case 'provider_oauth_start': return 'attempt-1';
        case 'provider_oauth_poll': return {status:'waiting',url:'https://auth.openai.com/oauth/authorize?state=test'};
        // ?balance: an account with money on it.
        case 'fetch_monoize_balance': return params0.has('balance') ? {balance_infos:[{currency:'CNY', total_balance:'12.30', granted_balance:'2.30', topped_up_balance:'10.00'}]} : {balance_infos:[]};
        // ?frost=vibrancy|mica: a system that can frost the window, as the app
        // answers. macOS lays and removes its vibrancy at once; a Windows
        // window keeps what it was created with (here: the choice stored
        // when the page loaded).
        case 'set_window_frost': {
          const kind = new URL(location.href).searchParams.get('frost');
          if (!kind) return {supported: false, effect: null};
          return {supported: true, effect: (kind === 'mica' ? frostAtStart : args.on) ? kind : null};
        }
        case 'diagnostic_logs': return [];
        // ?avatar: the account's avatar as the app kept it (account_avatar.rs);
        // an upload answers the gateway's user and the picture it sent.
        case 'monoize_avatar_cached': return new URL(location.href).searchParams.has('avatar') ? {url: '/api/desktop/oauth/avatars/a1', data_url: KEPT_AVATAR} : null;
        // A changed avatar (?avatar): the picture of the address it names.
        case 'monoize_avatar_sync': return args.url ? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='orange'/><title>${args.url}</title></svg>`)}` : null;
        case 'monoize_avatar_upload': return {user: {id: 'u1', username: 'Test user', role: 'user', avatar_url: '/api/desktop/oauth/avatars/a2'}, data_url: `data:image/webp;base64,${args.image}`};
        case 'about_app': return {version:'0.5.0', cli:'0.5.0', os:'macos', arch:'aarch64', logs:'', daemon_log:''};
        // Only the agent-UX pages have a (stand-in) daemon.
        case 'daemon_endpoint': return ['skills', 'market', 'plugins', 'sidebar', 'shell', 'agents'].some((k) => new URL(location.href).searchParams.has(k)) ? {url: 'ws://fake-daemon', token: 'test'} : null;
        // Plugins of other agents, as the import scan finds them.
        case 'import_scan': return {sessions: [], skills: [
          {source:'claude', name:'docx', description:'', path:'/p/document-skills/docx', plugin:'document-skills', present:false},
          {source:'claude', name:'xlsx', description:'', path:'/p/document-skills/xlsx', plugin:'document-skills', present:false},
          {source:'claude', name:'frontend-design', description:'', path:'/p/frontend-design/skills/frontend-design', plugin:'frontend-design', present:true},
          {source:'codex', name:'figma-implement-design', description:'', path:'/c/figma/skills/implement', plugin:'figma', present:false},
          {source:'zcode', name:'android-emulator', description:'', path:'/z/android/skills/emulator', plugin:'android-emulator', present:false}
        ], mcp: [
          {source:'codex', from:'figma', name:'figma', transport:'http', command:null, args:null, url:'https://mcp.figma.com/mcp', present:false, entry:{name:'figma', transport:'http', enabled:true}},
          {source:'claude', from:'/Users/me/code/app', name:'db', transport:'stdio', command:'db-mcp', args:[], url:null, present:false, entry:{name:'db', transport:'stdio', enabled:true}}
        ]};
        // A sent file's preview (?shell&preview, previewFiles.ts).
        case 'preview_file': return previewFacts(args.path, args.maxBytes);
        default: return null;
      }
    }
  }
});
// The agent-UX pages run against a stand-in daemon (fakeDaemon.ts).
const params = new URL(location.href).searchParams;
const panels = ['skills', 'market', 'plugins', 'sidebar', 'welcome', 'updates', 'agents'].some((k) => params.has(k));
// ?shell: the window's frame around one conversation (Shell.svelte).
const shell = params.has('shell');
if (panels || shell) {
  const { installFakeDaemon, daemonState } = await import('./fakeDaemon');
  installFakeDaemon();
  daemonState.old = params.has('oldEngine');
  daemonState.stall = params.has('stall');
  daemonState.shellsPlatform = params.get('agents') === 'windows' ? 'windows' : 'macos';
}
// ?remote: the phone remote page's conversation (Remote.svelte), in a
// browser, not the app.
const remote = params.has('remote');
if (remote) Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
const { default: Fixture } = remote ? await import('./Remote.svelte') : shell ? await import('./Shell.svelte') : panels ? await import('./Panels.svelte') : await import('./Regression.svelte');
mount(Fixture, {target:document.getElementById('app')!});
