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
// ?trial[=granted|used|full|ended|404|not_eligible]: signed in, and the
// gateway's answer to the first-use trial claim (a 404 is a gateway without
// the endpoint). =full: its 5-hour window is used up (recovers in 2 hours);
// =ended: no plan in force any more (the claim says not_eligible); =web: a
// paid plan (Grove) bought on the website, which this device does not pay
// with yet (the claim says not_eligible).
// ?funding=plan: the device pays with the plan (default: the balance, as a
// new device key starts; notes/plan-balance-contract.md F5). PUT plan
// without a plan in force answers 409 plan_inactive (contract 2.2).
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
// ?purchase[=404|reject|offline]: the gateway's store for the app
// (desktop-purchase.spec.md): the owner's plans and packs, and one EPay
// Channel with both wallets (WeChat answers a QR code, Alipay a payment page).
// `window.__storePaid = true` makes the next status check see the payment.
// =404: a gateway without the store; =reject: the first payment attempt is
// refused (payment_provider_rejected); =offline: the first order fails on the
// network. &nofundswitch: fulfilling a plan leaves the device's funding as it
// was (a gateway before contract v1.2). &current=sprout|branch: that plan is
// in force already (12 days left): a higher plan is an upgrade at a quoted
// price, a lower one is not offered, the same one renews.
const purchaseMode = params0.get('purchase');
let loggedIn = new URL(location.href).searchParams.has('loggedIn') || trialReply != null || purchaseMode != null;
let planFunding = params0.get('funding') === 'plan' ? 'plan' : 'balance';
// ?devices=<n>: the devices using the plan now (of 3 at most; default 1).
const planDevices = () => ({in_use: Number(params0.get('devices') ?? 1), limit: 3, this_device: true});
const planRefused = () => JSON.stringify({status: 409, code: 'plan_inactive', message: '现在没有生效的套餐'});
const STORE_CATALOG = {
  currency: 'CNY',
  products: [
    {id: 'b10', kind: 'balance', name: '10', description: '', price_minor: '1000', duration_seconds: null, groups: [], windows: [], balance: {recharge_minor: '1000', bonus_minor: '0', actual_received_minor: '1000'}},
    {id: 'b50', kind: 'balance', name: '50', description: '', price_minor: '5000', duration_seconds: null, groups: [], windows: [], balance: {recharge_minor: '5000', bonus_minor: '500', actual_received_minor: '5500'}},
    ...[['sprout', 'Sprout', '4900', '800', '2300'], ['branch', 'Branch', '9900', '1600', '4600']].map(([id, name, price, h5, d7]) => ({
      id, kind: 'plan', name, description: '可用模型：Claude、GPT、Gemini、国产模型。积分：1 积分 = ¥1 按量消费', price_minor: price, duration_seconds: 2_592_000, groups: ['套餐专用'], balance: null,
      windows: [{window_kind: '5h', window_seconds: 18000, quota_fen_cny: h5}, {window_kind: 'custom', window_seconds: 604800, quota_fen_cny: d7}]
    }))
  ],
  payment_options: ['alipay', 'wxpay'].map((method) => ({id: `store-channel-epay:${method}`, channel_id: 'store-channel-epay', method, label: method === 'alipay' ? 'Alipay' : 'WeChat Pay', actions: ['qr', 'redirect'], min_minor: '1', max_minor: '100000000'})),
  custom_recharge: {product_id: 'b10', min_minor: '100', max_minor: '100000000'}
};
const store = {
  orders: [] as any[],
  attempts: new Map<string, any>(),
  payFailures: purchaseMode === 'reject' ? 1 : 0,
  orderFailures: purchaseMode === 'offline' ? 1 : 0,
  plan: null as any
};
const storeRefusal = (status: number | null, code: string | null, message: string) => JSON.stringify({status, code, message});
// A plan of the store in force (&current=<product id>: one bought before).
const storePlan = (id: string, endsAt: number) => {
  const product = STORE_CATALOG.products.find((p) => p.id === id)!;
  const kinds = product.windows.map((w: any) => [w.window_seconds === 18000 ? '5h' : '7d', (Number(w.quota_fen_cny) / 100).toFixed(2)]);
  return {id, name: product.name, group: '套餐专用', windows: kinds.map(([kind, quota]) => ({kind, quota_cny: quota, used_cny: '0.00', resets_at: null})), expires_at: new Date(endsAt).toISOString(), trial: false, active: true, devices: planDevices()};
};
if (params0.get('current')) { store.plan = storePlan(params0.get('current')!, Date.now() + 12 * 86_400_000); planFunding = 'plan'; }
// The catalog as the gateway sends it to an account with a paid plan: a
// higher plan carries the upgrade quote (placeholder numbers: the price
// difference; the formula is the gateway's), a lower one is not offered.
function storeCatalog() {
  const current = store.plan ? STORE_CATALOG.products.find((p) => p.id === store.plan.id) : null;
  if (!current) return STORE_CATALOG;
  return {...STORE_CATALOG, products: STORE_CATALOG.products.map((p) => {
    if (p.kind !== 'plan' || p.id === current.id) return p;
    if (Number(p.price_minor) > Number(current.price_minor))
      return {...p, upgrade: {price_minor: String(Number(p.price_minor) - Number(current.price_minor)), expires_at: store.plan.expires_at, from: current.id}};
    return {...p, downgrade: true};
  })};
}
// The trial's windows: unused, used, or (=full) the 5-hour one used up.
const planStartedAt = Date.now();
// Plans end at a fixed time (the same plan on the next load), 6.5 to 7.5 days
// after the start for the trial (a 7-day trial when its card counts days).
const planEndsFrom = Math.floor(planStartedAt / 86_400_000) * 86_400_000 + 12 * 3_600_000;
const trialPlan = (used: boolean, full = trialReply === 'full') => ({
  name: '7 天体验套餐',
  group: '国内模型分组',
  windows: [
    { kind: '5h', quota_cny: '4.00', used_cny: full ? '4.00' : used ? '1.36' : '0.00', resets_at: full ? new Date(planStartedAt + 2 * 3_600_000).toISOString() : used ? new Date(planStartedAt + 3 * 3_600_000).toISOString() : null },
    { kind: '7d', quota_cny: '10.00', used_cny: full ? '6.20' : used ? '3.58' : '0.00', resets_at: used || full ? new Date(planStartedAt + 5 * 86_400_000).toISOString() : null }
  ],
  expires_at: new Date(planEndsFrom + 7 * 86_400_000).toISOString()
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
      if (command.startsWith('monoize_store_')) {
        if (purchaseMode === '404') throw storeRefusal(404, null, 'Not Found');
        const view = (o: any) => {
          if ((window as any).__storePaid && o.state === 'awaiting_payment') {
            o.state = 'completed';
            // The gateway moves the account's devices to a plan bought (contract
            // v1.2); &nofundswitch: a gateway that does not.
            if (o.kind === 'plan' && !params0.has('nofundswitch')) planFunding = 'plan';
            // Renewal: 30 days from the current end; an upgrade keeps the quoted end;
            // otherwise 30 days from now (contract v1.2 section 5).
            if (o.kind === 'plan') {
              const renewed = store.plan?.id === o.product_id ? Date.parse(store.plan.expires_at) + 30 * 86_400_000 : null;
              const upgraded = o.upgrade_from && store.plan ? Date.parse(store.plan.expires_at) : null;
              store.plan = storePlan(o.product_id, renewed ?? upgraded ?? Date.now() + 30 * 86_400_000);
            }
          }
          return {...o};
        };
        switch (command) {
          case 'monoize_store_catalog': return storeCatalog();
          case 'monoize_store_orders': return {orders: store.orders.slice().reverse().slice(0, args.limit).map(view)};
          case 'monoize_store_order': {
            if (store.orderFailures > 0) { store.orderFailures--; throw storeRefusal(null, null, 'all gateways unreachable'); }
            const kept = store.orders.find((o) => o.request_id === args.requestId);
            if (kept) return view(kept);
            const product = storeCatalog().products.find((p: any) => p.id === args.productId)! as any;
            const amount = args.customMinor ?? product.upgrade?.price_minor ?? product.price_minor;
            const order = {
              id: `order-${store.orders.length + 1}`, order_number: `LS-${store.orders.length + 1}`, request_id: args.requestId, product_id: product.id, upgrade_from: args.upgradeFrom ?? null,
              kind: product.kind, name: product.name, amount_minor: amount, currency: 'CNY', payment_state: 'unpaid', fulfillment_state: 'pending', state: 'awaiting_payment',
              balance: product.kind === 'balance' ? (args.customMinor ? {recharge_minor: amount, bonus_minor: '0', actual_received_minor: amount} : product.balance) : null,
              expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), created_at: new Date().toISOString()
            };
            store.orders.push(order);
            return view(order);
          }
          case 'monoize_store_pay': {
            if (store.payFailures > 0) { store.payFailures--; throw storeRefusal(422, 'payment_provider_rejected', 'payment provider rejected checkout'); }
            const kept = store.attempts.get(args.requestId);
            if (kept) return kept;
            const expires_at = new Date(Date.now() + 30 * 60_000).toISOString();
            const answer = {
              attempt: {id: `attempt-${store.attempts.size + 1}`, state: 'presented', method: args.method, expires_at},
              action: args.method === 'alipay' ? {kind: 'redirect', url: `https://pay.example.com/pay/${args.orderId}`, expires_at} : {kind: 'qr', payload: `weixin://wxpay/bizpayurl?pr=${args.orderId}`, expires_at}
            };
            store.attempts.set(args.requestId, answer);
            return answer;
          }
          case 'monoize_store_query': return view(store.orders.find((o) => o.id === args.orderId));
        }
      }
      // The plan bought in the store (?purchase without ?trial).
      if ((command === 'monoize_desktop_plan' || command === 'monoize_set_plan_funding') && purchaseMode != null && trialReply == null) {
        if (command === 'monoize_set_plan_funding') {
          if (args.funding === 'plan' && !store.plan) throw planRefused();
          planFunding = args.funding;
        }
        return {plan: store.plan, plan_funding: planFunding, bucket: planFunding};
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
          if (trialReply === 'not_eligible' || trialReply === 'ended' || trialReply === 'web') return {status: 'not_eligible'};
          // The claim does not switch the device (contract 2.3).
          return {status: 'granted', plan: trialPlan(trialReply === 'used'), plan_funding: planFunding};
        // GET / PUT /api/desktop/oauth/plan (an older gateway with ?trial=404).
        case 'monoize_desktop_plan':
        case 'monoize_set_plan_funding':
          if (trialReply === '404' || trialReply === 'not_eligible' || trialReply == null) throw JSON.stringify({status: 404, code: null, message: 'Not Found'});
          if (command === 'monoize_set_plan_funding') {
            if (args.funding === 'plan' && trialReply === 'ended') throw planRefused();
            planFunding = args.funding;
          }
          {
            // The gateway stores a change as it arrives and answers later.
            const plan = trialReply === 'ended' ? null
              : trialReply === 'web' ? {...trialPlan(true), name: 'Grove', group: '套餐专用', expires_at: new Date(planEndsFrom + 30 * 86_400_000).toISOString(), trial: false, active: true, devices: planDevices()}
              : {...trialPlan(trialReply === 'used'), trial: true, active: true, devices: planDevices()};
            const answer = {plan, plan_funding: planFunding, bucket: planFunding};
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
        // No ACP agent registered (the app's command answers a list).
        case 'acp_agents_list': return [];
        // ?avatar: the account's avatar as the app kept it (account_avatar.rs);
        // an upload answers the gateway's user and the picture it sent.
        case 'monoize_avatar_cached': return new URL(location.href).searchParams.has('avatar') ? {url: '/api/desktop/oauth/avatars/a1', data_url: KEPT_AVATAR} : null;
        // A changed avatar (?avatar): the picture of the address it names.
        case 'monoize_avatar_sync': return args.url ? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='orange'/><title>${args.url}</title></svg>`)}` : null;
        case 'monoize_avatar_upload': return {user: {id: 'u1', username: 'Test user', role: 'user', avatar_url: '/api/desktop/oauth/avatars/a2'}, data_url: `data:image/webp;base64,${args.image}`};
        case 'about_app': return {version:'0.5.0', cli:'0.5.0', os:'macos', arch:'aarch64', logs:'', daemon_log:''};
        // Only the agent-UX pages have a (stand-in) daemon.
        case 'daemon_endpoint': return ['skills', 'market', 'plugins', 'sidebar', 'shell', 'agents', 'styles'].some((k) => new URL(location.href).searchParams.has(k)) ? {url: 'ws://fake-daemon', token: 'test'} : null;
        // Plugins of other agents, as the import scan finds them.
        case 'import_scan': return {sessions: [], skipped: [], skills: [
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
        // Conversations outside a project (?newchat): the workspace dir, and
        // the folder a first message makes there.
        case 'default_workspace_dir': return '/Users/me/Documents/LynShen';
        case 'create_chat_dir': return `${args.root}/${args.name}`;
        default: return null;
      }
    }
  }
});
// The agent-UX pages run against a stand-in daemon (fakeDaemon.ts).
const params = new URL(location.href).searchParams;
const panels = ['skills', 'market', 'plugins', 'sidebar', 'welcome', 'updates', 'agents', 'styles'].some((k) => params.has(k));
// ?shell: the window's frame around one conversation (Shell.svelte).
const shell = params.has('shell');
if (panels || shell) {
  const { installFakeDaemon, daemonState } = await import('./fakeDaemon');
  installFakeDaemon();
  daemonState.old = params.has('oldEngine');
  daemonState.stall = params.has('stall');
  daemonState.shellsPlatform = params.get('agents') === 'windows' ? 'windows' : 'macos';
  // ?chats[=empty|error|old|all]: Settings → 聊天连接's sample (fakeDaemon.ts).
  daemonState.chats = params.get('chats') ?? '';
  daemonState.connectors = (await import('./fakeDaemon')).chatSample(daemonState.chats);
}
// ?remote: the phone remote page's conversation (Remote.svelte), in a
// browser, not the app.
const remote = params.has('remote');
if (remote) Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';
const { default: Fixture } = remote ? await import('./Remote.svelte') : shell ? await import('./Shell.svelte') : panels ? await import('./Panels.svelte') : await import('./Regression.svelte');
mount(Fixture, {target:document.getElementById('app')!});
