import assert from "node:assert";
import type { Binding, Hook, HookValues, StartDevWorkerOptions } from "./types";
import type { Config } from "@cloudflare/workers-utils";
import type { Json } from "miniflare";

export function assertNever(_value: never) {}

export type MaybePromise<T> = T | Promise<T>;
export type DeferredPromise<T> = {
	promise: Promise<T>;
	resolve: (_: MaybePromise<T>) => void;
	reject: (_: Error) => void;
};

export function createDeferred<T>(
	previousDeferred?: DeferredPromise<T>
): DeferredPromise<T> {
	let resolve, reject;
	const newPromise = new Promise<T>((_resolve, _reject) => {
		resolve = _resolve;
		reject = _reject;
	});
	assert(resolve);
	assert(reject);

	// if passed a previousDeferred, ensure it is resolved with the newDeferred
	// so that await-ers of previousDeferred are now await-ing newDeferred
	previousDeferred?.resolve(newPromise);

	return {
		promise: newPromise,
		resolve,
		reject,
	};
}

export function urlFromParts(
	parts: Partial<URL>,
	base = "http://localhost"
): URL {
	const url = new URL(base);

	Object.assign(url, parts);

	return url;
}

type UnwrapHook<
	T extends HookValues | Promise<HookValues>,
	Args extends unknown[],
> = Hook<T, Args>;

export function unwrapHook<
	T extends HookValues | Promise<HookValues>,
	Args extends unknown[],
>(hook: UnwrapHook<T, Args>, ...args: Args): T {
	return typeof hook === "function" ? hook(...args) : hook;
}

/**
 * Options for convertConfigToBindings
 */
export interface ConvertBindingsOptions {
	/**
	 * When true, uses preview IDs (preview_id, preview_bucket_name, preview_database_id)
	 * instead of production IDs. Used for local development.
	 */
	usePreviewIds?: boolean;
	/**
	 * When true, excludes bindings that are not supported in Pages
	 * (send_email, wasm_modules, text_blobs, data_blobs, dispatch_namespaces, pipelines, logfwdr, assets, unsafe)
	 */
	pages?: boolean;
}

/**
 * Binding options that can be provided to convertConfigBindingsToStartWorkerBindings.
 * This is a subset of Config focused only on binding-related fields.
 */
export interface ConfigBindingOptions {
	vars?: Config["vars"];
	kv_namespaces?: Config["kv_namespaces"];
	send_email?: Config["send_email"];
	durable_objects?: Config["durable_objects"];
	workflows?: Config["workflows"];
	queues?: Config["queues"];
	r2_buckets?: Config["r2_buckets"];
	d1_databases?: Config["d1_databases"];
	vectorize?: Config["vectorize"];
	hyperdrive?: Config["hyperdrive"];
	secrets_store_secrets?: Config["secrets_store_secrets"];
	unsafe_hello_world?: Config["unsafe_hello_world"];
	ratelimits?: Config["ratelimits"];
	vpc_services?: Config["vpc_services"];
	services?: Config["services"];
	analytics_engine_datasets?: Config["analytics_engine_datasets"];
	dispatch_namespaces?: Config["dispatch_namespaces"];
	mtls_certificates?: Config["mtls_certificates"];
	pipelines?: Config["pipelines"];
	worker_loaders?: Config["worker_loaders"];
	logfwdr?: Config["logfwdr"];
	wasm_modules?: Config["wasm_modules"];
	browser?: Config["browser"];
	ai?: Config["ai"];
	images?: Config["images"];
	media?: Config["media"];
	version_metadata?: Config["version_metadata"];
	assets?: Config["assets"];
	text_blobs?: Config["text_blobs"];
	data_blobs?: Config["data_blobs"];
	unsafe?: Config["unsafe"];
}

/**
 * Convert Config bindings to the flat StartDevWorkerInput["bindings"] format.
 * This is the canonical conversion function - other converters should delegate to this.
 */
export function convertConfigToBindings(
	config: Config,
	options?: ConvertBindingsOptions
): NonNullable<StartDevWorkerOptions["bindings"]> {
	const { usePreviewIds = false, pages = false } = options ?? {};
	const output: NonNullable<StartDevWorkerOptions["bindings"]> = {};

	type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][];
	type ConfigIterable = Entries<Required<ConfigBindingOptions>>;
	const configIterable = Object.entries(config) as ConfigIterable;

	for (const [type, info] of configIterable) {
		if (info === undefined) {
			continue;
		}

		switch (type) {
			case "vars": {
				for (const [key, value] of Object.entries(info)) {
					if (typeof value === "string") {
						output[key] = { type: "plain_text", value };
					} else {
						output[key] = { type: "json", value };
					}
				}
				break;
			}
			case "kv_namespaces": {
				for (const { binding, preview_id, id, ...x } of info) {
					output[binding] = {
						type: "kv_namespace",
						...x,
						id: usePreviewIds ? preview_id ?? id : id,
					};
				}
				break;
			}
			case "send_email": {
				if (pages) break;
				for (const { name, ...x } of info) {
					output[name] = { type: "send_email", ...x };
				}
				break;
			}
			case "wasm_modules": {
				if (pages) break;
				for (const [key, value] of Object.entries(info)) {
					if (typeof value === "string") {
						output[key] = { type: "wasm_module", source: { path: value } };
					} else {
						output[key] = { type: "wasm_module", source: { contents: value } };
					}
				}
				break;
			}
			case "text_blobs": {
				if (pages) break;
				for (const [key, value] of Object.entries(info)) {
					output[key] = { type: "text_blob", source: { path: value } };
				}
				break;
			}
			case "data_blobs": {
				if (pages) break;
				for (const [key, value] of Object.entries(info)) {
					if (typeof value === "string") {
						output[key] = { type: "data_blob", source: { path: value } };
					} else {
						output[key] = { type: "data_blob", source: { contents: value } };
					}
				}
				break;
			}
			case "browser": {
				const { binding, ...x } = info;
				output[binding] = { type: "browser", ...x };
				break;
			}
			case "durable_objects": {
				for (const { name, ...x } of info.bindings ?? []) {
					output[name] = { type: "durable_object_namespace", ...x };
				}
				break;
			}
			case "workflows": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "workflow", ...x };
				}
				break;
			}
			case "queues": {
				for (const producer of info.producers ?? []) {
					output[producer.binding] = {
						type: "queue",
						queue_name: producer.queue,
						...(producer.delivery_delay !== undefined && {
							delivery_delay: producer.delivery_delay,
						}),
					};
				}
				break;
			}
			case "r2_buckets": {
				for (const {
					binding,
					preview_bucket_name,
					bucket_name,
					...x
				} of info) {
					output[binding] = {
						type: "r2_bucket",
						...x,
						bucket_name: usePreviewIds
							? preview_bucket_name ?? bucket_name
							: bucket_name,
					};
				}
				break;
			}
			case "d1_databases": {
				for (const {
					binding,
					preview_database_id,
					database_id,
					...x
				} of info) {
					output[binding] = {
						type: "d1",
						...x,
						database_id: usePreviewIds
							? preview_database_id ?? database_id
							: database_id,
					};
				}
				break;
			}
			case "services": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "service", ...x };
				}
				break;
			}
			case "analytics_engine_datasets": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "analytics_engine", ...x };
				}
				break;
			}
			case "dispatch_namespaces": {
				if (pages) break;
				for (const { binding, ...x } of info) {
					output[binding] = { type: "dispatch_namespace", ...x };
				}
				break;
			}
			case "mtls_certificates": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "mtls_certificate", ...x };
				}
				break;
			}
			case "logfwdr": {
				if (pages) break;
				for (const { name, ...x } of info.bindings ?? []) {
					output[name] = { type: "logfwdr", ...x };
				}
				break;
			}
			case "ai": {
				const { binding, ...x } = info;
				output[binding] = { type: "ai", ...x };
				break;
			}
			case "images": {
				const { binding, ...x } = info;
				output[binding] = { type: "images", ...x };
				break;
			}
			case "version_metadata": {
				const { binding, ...x } = info;
				output[binding] = { type: "version_metadata", ...x };
				break;
			}
			case "hyperdrive": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "hyperdrive", ...x };
				}
				break;
			}
			case "vectorize": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "vectorize", ...x };
				}
				break;
			}
			case "unsafe": {
				if (pages) break;
				for (const { type: unsafeType, name, ...x } of info.bindings ?? []) {
					output[name] = { type: `unsafe_${unsafeType}`, ...x } as Binding;
				}
				break;
			}
			case "assets": {
				if (pages) break;
				if (info.binding) {
					output[info.binding] = { type: "assets" };
				}
				break;
			}
			case "pipelines": {
				if (pages) break;
				for (const { binding, ...x } of info) {
					output[binding] = { type: "pipeline", ...x };
				}
				break;
			}
			case "secrets_store_secrets": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "secrets_store_secret", ...x };
				}
				break;
			}
			case "unsafe_hello_world": {
				if (pages) break;
				for (const { binding, ...x } of info) {
					output[binding] = { type: "unsafe_hello_world", ...x };
				}
				break;
			}
			case "ratelimits": {
				for (const { name, ...x } of info) {
					output[name] = { type: "ratelimit", ...x };
				}
				break;
			}
			case "worker_loaders": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "worker_loader", ...x };
				}
				break;
			}
			case "vpc_services": {
				for (const { binding, ...x } of info) {
					output[binding] = { type: "vpc_service", ...x };
				}
				break;
			}
			case "media": {
				const { binding, ...x } = info;
				output[binding] = { type: "media", ...x };
				break;
			}
			default:
				// Config has many other fields that aren't bindings - ignore them
				break;
		}
	}

	return output;
}

export function convertConfigBindingsToStartWorkerBindings(
	configBindings: ConfigBindingOptions
): StartDevWorkerOptions["bindings"] {
	return convertConfigToBindings(configBindings as unknown as Config, {
		usePreviewIds: true,
	});
}

/**
 * Bindings that can be passed via the StartDevOptions (CLI/API) interface.
 * This is a subset of all binding types, focused on the most commonly used ones.
 */
export interface StartDevOptionsBindings {
	vars?: Record<string, string | Json>;
	kv?: {
		binding: string;
		id?: string;
		preview_id?: string;
	}[];
	durableObjects?: {
		name: string;
		class_name: string;
		script_name?: string;
		environment?: string;
	}[];
	services?: {
		binding: string;
		service: string;
		environment?: string;
		entrypoint?: string;
	}[];
	r2?: {
		binding: string;
		bucket_name?: string;
		preview_bucket_name?: string;
		jurisdiction?: string;
	}[];
	ai?: {
		binding: string;
	};
	version_metadata?: {
		binding: string;
	};
	d1Databases?: {
		binding: string;
		database_id?: string;
		database_name?: string;
		database_internal_env?: string;
		preview_database_id?: string;
	}[];
	queueProducers?: {
		binding: string;
		queue: string;
		delivery_delay?: number;
	}[];
	hyperdrive?: {
		binding: string;
		id: string;
		localConnectionString?: string;
	}[];
}

/**
 * Convert StartDevOptions bindings to the flat StartDevWorkerInput["bindings"] format.
 * Only supports the binding types available in StartDevOptions (the subset that can be
 * passed via CLI/API).
 */
export function convertStartDevOptionsToBindings(
	inputBindings: StartDevOptionsBindings
): StartDevWorkerOptions["bindings"] {
	const output: StartDevWorkerOptions["bindings"] = {};

	type Entries<T> = { [K in keyof T]: [K, T[K]] }[keyof T][];
	type BindingsIterable = Entries<Required<typeof inputBindings>>;
	const bindingsIterable = Object.entries(inputBindings) as BindingsIterable;

	for (const [type, info] of bindingsIterable) {
		if (info === undefined) {
			continue;
		}

		switch (type) {
			case "vars": {
				for (const [key, value] of Object.entries(info)) {
					if (typeof value === "string") {
						output[key] = { type: "plain_text", value };
					} else {
						output[key] = { type: "json", value };
					}
				}
				break;
			}
			case "kv": {
				for (const kv of info) {
					output[kv.binding] = {
						type: "kv_namespace",
						id: kv.id,
					};
				}
				break;
			}
			case "durableObjects": {
				for (const durable of info) {
					output[durable.name] = {
						type: "durable_object_namespace",
						class_name: durable.class_name,
						script_name: durable.script_name,
						environment: durable.environment,
					};
				}
				break;
			}
			case "services": {
				for (const service of info) {
					output[service.binding] = {
						type: "service",
						service: service.service,
						environment: service.environment,
						entrypoint: service.entrypoint,
					};
				}
				break;
			}
			case "r2": {
				for (const r2 of info) {
					output[r2.binding] = {
						type: "r2_bucket",
						bucket_name: r2.bucket_name,
						jurisdiction: r2.jurisdiction,
					};
				}
				break;
			}
			case "ai": {
				output[info.binding] = {
					type: "ai",
				};
				break;
			}
			case "version_metadata": {
				output[info.binding] = {
					type: "version_metadata",
				};
				break;
			}
			case "d1Databases": {
				for (const d1 of info) {
					output[d1.binding] = {
						type: "d1",
						database_id: d1.database_id,
						database_name: d1.database_name,
						database_internal_env: d1.database_internal_env,
					};
				}
				break;
			}
			case "queueProducers": {
				for (const queue of info) {
					output[queue.binding] = {
						type: "queue",
						queue_name: queue.queue,
						...(queue.delivery_delay !== undefined && {
							delivery_delay: queue.delivery_delay,
						}),
					};
				}
				break;
			}
			case "hyperdrive": {
				for (const hd of info) {
					output[hd.binding] = {
						type: "hyperdrive",
						id: hd.id,
						localConnectionString: hd.localConnectionString,
					};
				}
				break;
			}
			default:
				assertNever(type);
		}
	}

	return output;
}

export function extractBindingsOfType<
	Type extends NonNullable<StartDevWorkerOptions["bindings"]>[string]["type"],
>(
	type: Type,
	bindings: StartDevWorkerOptions["bindings"]
): (Extract<Binding, { type: Type }> & {
	binding: string;
	/* ugh why durable objects :( */ name: string;
})[] {
	return Object.entries(bindings ?? {})
		.filter(
			(binding): binding is [string, Extract<Binding, { type: Type }>] =>
				binding[1].type === type
		)
		.map((binding) => ({
			...binding[1],
			binding: binding[0],
			name: binding[0],
		})) as (Extract<Binding, { type: Type }> & {
		binding: string;
		/* ugh why durable objects :( */ name: string;
	})[];
}
