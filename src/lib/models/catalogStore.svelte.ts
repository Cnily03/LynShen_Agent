// The gateway's model catalog for the app: fetched with the device key when
// the provider list loads and when a picker opens (at most once a minute: the
// gateway refreshes health that often), kept on this computer so names show
// at once on the next start. A gateway without the catalog (404) leaves the
// pickers on the plain model list.

import { fetchModelCatalog, GatewayError } from '$lib/protocol';
import { catalogIndex, parseCatalog, type CatalogModel, type GatewayCatalog } from './gatewayCatalog';

const STORAGE_KEY = 'lynshen-model-catalog';
const FRESH_MS = 60_000;

class GatewayCatalogStore {
	/** The last catalog read; null before one, or from a gateway without it. */
	data = $state<GatewayCatalog | null>(null);
	/** The gateway answered 404: no catalog there, the plain list stands. */
	absent = $state(false);
	#index = $derived(catalogIndex(this.data));
	#fetchedAt = 0;
	#pending: Promise<GatewayCatalog | null> | null = null;

	constructor() {
		try {
			const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
			if (raw) this.data = parseCatalog(JSON.parse(raw));
		} catch {
			/* a damaged copy: wait for the gateway */
		}
	}

	/** The catalog's model for an id, the name sent for it, or an alias. */
	lookup = (id: string): CatalogModel | undefined => this.#index.get(id.toLowerCase());

	/** Reads the catalog again; keeps the last one when the gateway cannot be
	 *  reached. Concurrent calls share one request. */
	refresh(): Promise<GatewayCatalog | null> {
		this.#pending ??= this.#load().finally(() => (this.#pending = null));
		return this.#pending;
	}

	/** Reads it again when the copy is older than a minute. */
	refreshIfStale(): Promise<GatewayCatalog | null> {
		return Date.now() - this.#fetchedAt < FRESH_MS ? Promise.resolve(this.data) : this.refresh();
	}

	async #load(): Promise<GatewayCatalog | null> {
		try {
			const body = await fetchModelCatalog();
			const parsed = parseCatalog(body);
			this.#fetchedAt = Date.now();
			this.absent = !parsed;
			this.data = parsed;
			try {
				if (parsed) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(body));
				else globalThis.localStorage?.removeItem(STORAGE_KEY);
			} catch {
				/* no storage: kept for this run */
			}
		} catch (e) {
			const status = e instanceof GatewayError ? e.status : null;
			// 404: an older gateway. 401/403 or signed out: not this account's to show.
			if (status === 404 || status === 401 || status === 403 || (e instanceof GatewayError && e.code === 'not_signed_in')) {
				this.#fetchedAt = Date.now();
				this.absent = status === 404;
				this.data = null;
				try {
					globalThis.localStorage?.removeItem(STORAGE_KEY);
				} catch {
					/* nothing kept */
				}
			}
		}
		return this.data;
	}
}

export const gatewayCatalog = new GatewayCatalogStore();
