import { mount } from 'svelte';
import '../../src/lib/app.css';

const calls: { command: string; args: any }[] = [];
let loggedIn = new URL(location.href).searchParams.has('loggedIn');
Object.assign(window, {
  __calls: calls,
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string, args: any) => {
      calls.push({ command, args });
      switch (command) {
        // ?home: a new install signed in to the gateway, whose engine has
        // not written its own list yet.
        case 'read_config': return new URL(location.href).searchParams.has('home')
          ? {provider: 'monoize', model: 'deepseek-v4.1-flash', models: [], lynshen_models: [{name: 'deepseek-v4.1-flash', context_window: 1000000}, {name: 'claude-opus-5-5', display_name: 'Claude Opus 5.5'}, {name: 'gpt-image-2'}]}
          : {provider: 'monoize', models: []};
        case 'read_auth_providers': return loggedIn ? ['monoize'] : [];
        case 'list_providers': return [{id:'openai',base_url:'https://api.openai.com/v1',protocol:'responses',models:[{name:'gpt-5'}]}, {id:'openai-codex',base_url:'https://chatgpt.com/backend-api/codex',protocol:'openai-codex-responses',models:[{name:'gpt-5'}]}];
        case 'monoize_session': return {logged_in:loggedIn, session:loggedIn ? {user:{username:'Test user'}} : null};
        case 'monoize_logout': loggedIn = false; return;
        case 'monoize_oauth_start': return {user_code:'ABCDEF123456',verification_uri_complete:'https://www.lynshen.org/oauth/authorize?user_code=ABCDEF123456'};
        case 'monoize_oauth_poll': return {pending:true};
        case 'fetch_monoize_models': return {data:[]};
        case 'provider_oauth_start': return 'attempt-1';
        case 'provider_oauth_poll': return {status:'waiting',url:'https://auth.openai.com/oauth/authorize?state=test'};
        case 'fetch_monoize_balance': return {balance_infos:[]};
        // Only the agent-UX pages have a (stand-in) daemon.
        case 'daemon_endpoint': return ['skills', 'market', 'plugins', 'sidebar'].some((k) => new URL(location.href).searchParams.has(k)) ? {url: 'ws://fake-daemon', token: 'test'} : null;
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
        default: return null;
      }
    }
  }
});
// The agent-UX pages run against a stand-in daemon (fakeDaemon.ts).
const params = new URL(location.href).searchParams;
const panels = ['skills', 'market', 'plugins', 'sidebar'].some((k) => params.has(k));
if (panels) {
  const { installFakeDaemon, daemonState } = await import('./fakeDaemon');
  installFakeDaemon();
  daemonState.old = params.has('oldEngine');
}
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
const { default: Fixture } = panels ? await import('./Panels.svelte') : await import('./Regression.svelte');
mount(Fixture, {target:document.getElementById('app')!});
