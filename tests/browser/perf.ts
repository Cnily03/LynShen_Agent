// A conversation pane with a stubbed Tauri bridge, for streaming benchmarks
// (scripts/reasoning-perf.mjs). No daemon: the script feeds engine events.
import { mount } from 'svelte';
import '../../src/lib/app.css';

Object.assign(window, {
  __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command: string) => {
      switch (command) {
        case 'read_config': return { provider: 'monoize', models: [] };
        case 'read_auth_providers': return [];
        case 'list_providers': return [];
        default: return null;
      }
    }
  }
});
const { default: Fixture } = await import('./Perf.svelte');
mount(Fixture, { target: document.getElementById('app')! });
