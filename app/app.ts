import { Datex } from "unyt_core";

import { FrontendManager } from "./frontend_manager.ts";
import { BackendManager } from "./backend_manager.ts";
import { endpoint_config } from "unyt_core/runtime/endpoint_config.ts";
import { Path } from "unyt_node/path.ts";
import { ImportMap } from "unyt_node/importmap.ts";
import { Server } from "unyt_node/server.ts";
import { UIX_CACHE_PATH } from "../utils/constants.ts";

let live_frontend:boolean|undefined = false;
let watch:boolean|undefined = false;
let watch_backend:boolean|undefined = false;

if (globalThis.Deno) {
	({ live_frontend, watch, watch_backend } = (await import("../utils/args.ts")))
}

const logger = new Datex.Logger("UIX App");


export const ALLOWED_ENTRYPOINT_FILE_NAMES = ['entrypoint.dx', 'entrypoint.ts', 'entrypoint.tsx']


export type app_options = {
	name?: string,  // app name
	description?: string, // app description
	icon_path?: string, // path to app icon / favicon
	version?: string, // app version
	stage?: string, // stage (production, dev, ...)
	installable?: boolean, // can be installed as standalone web app
	offline_support?: boolean, // add a service worker with offline cache
	
	frontend?: string|URL|(string|URL)[], // directory for frontend code
	backend?:  string|URL|(string|URL)[] // directory for backend code
	common?: string|URL|(string|URL)[] // directory with access from both frotend end backend code

	import_map_path?: string|URL, // custom importmap for the frontend
	import_map?: {imports:Record<string,string>} // prefer over import map path
}

export interface normalized_app_options extends app_options {
	frontend: Path[]
	backend: Path[]
	common: Path[],
	icon_path: string,

	scripts: (Path|string)[],
	import_map_path: never
	import_map: ImportMap
}

class UIXApp {

	base_url?:URL

	options?:normalized_app_options

	frontends = new Map<string, FrontendManager>()
	#ready_handlers = new Set<()=>void>();

	public onReady(handler:()=>void) {
		this.#ready_handlers.add(handler);
	}

	public ready = new Promise<void>(resolve=>this.onReady(()=>resolve()))

	/**
	 * resolves file paths to web paths, keep everything else (web urls, import aliases)
	 * @param filePath file path (e.g. "file://", "./xy", "/xy")
	 * @returns web path (e.g. "/@uix/src/xy")
	 */
	public filePathToWebPath(filePath:URL|string){
		// keep import aliases
		if (typeof filePath == "string" && !(filePath.startsWith("./")||filePath.startsWith("../")||filePath.startsWith("/")||filePath.startsWith("file://"))) return filePath;

		// already a web path
		if (Path.pathIsURL(filePath) && new Path(filePath).is_web) return filePath.toString();

		if (!this.base_url) throw new Error("Cannot convert file path to web path - no base file path set");
		const path = new Path(filePath, this.base_url);
		// is /@uix/cache
		if (path.isChildOf(UIX_CACHE_PATH)) return path.getAsRelativeFrom(UIX_CACHE_PATH).replace(/^\.\//, "/@uix/cache/");
		// is /@uix/src
		else return path.getAsRelativeFrom(this.base_url).replace(/^\.\//, "/@uix/src/")
	}

	public async start(options:app_options = {}, base_url?:string|URL) {
		const n_options = <normalized_app_options> {};
		
		// determine base url
		if (typeof base_url == "string" && !base_url.startsWith("file://")) base_url = 'file://' + base_url;
		base_url ??= new Error().stack?.trim()?.match(/((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@)/)?.[1];
		if (!base_url) throw new Error("Could not determine the app base url (this should not happen)");
		base_url = new URL(base_url.toString());
		this.base_url = base_url;

		n_options.name = options.name;
		n_options.description = options.description;
		n_options.icon_path = options.icon_path ?? 'https://cdn.unyt.org/unyt_core/assets/skeleton_light.svg'
		n_options.version = options.version?.replaceAll("\n","");
		n_options.stage = options.stage?.replaceAll("\n","");
		n_options.offline_support = options.offline_support ?? true;
		n_options.installable = options.installable ?? false;
		
		// import map or import map path
		if (options.import_map_path) {
			n_options.import_map = await ImportMap.fromPath(options.import_map_path);
		}
		else if (options.import_map) n_options.import_map = new ImportMap(options.import_map);
		else throw new Error("No importmap found or set in the app configuration") // should not happen

		if (options.frontend instanceof Datex.Tuple) options.frontend = options.frontend.toArray();
		if (options.backend instanceof Datex.Tuple) options.backend = options.backend.toArray();
		if (options.common instanceof Datex.Tuple) options.common = options.common.toArray();

		n_options.frontend = options.frontend instanceof Array ? options.frontend.filter(p=>!!p).map(p=>new Path(p,base_url)) : (new Path(options.frontend??'./frontend/', base_url).fs_exists ? [new Path(options.frontend??'./frontend/', base_url)] : []);
		n_options.backend  = options.backend instanceof Array  ? options.backend.filter(p=>!!p).map(p=>new Path(p,base_url)) :  (new Path(options.backend??'./backend/', base_url).fs_exists ? [new Path(options.backend??'./backend/', base_url)] : []);
		n_options.common   = options.common instanceof Array   ? options.common.filter(p=>!!p).map(p=>new Path(p,base_url)) :   (new Path(options.common??'./common/', base_url).fs_exists ? [new Path(options.common??'./common/', base_url)] : []);
		this.options = n_options;

		if (!n_options.frontend.length) {
			// try to find the frontend dir
			const frontend_dir = new Path("./frontend/",base_url);
			try {
				if (!Deno.statSync(frontend_dir).isFile) n_options.frontend.push(frontend_dir)
			}
			catch {}
		}

		if (!n_options.backend.length) {
			// try to find the backend dir
			const backend_dir = new Path("./backend/",base_url);
			try {
				if (!Deno.statSync(backend_dir).isFile) n_options.backend.push(backend_dir)
			}
			catch {}
		}

		if (!n_options.common.length) {
			// try to find the common dir
			const common_dir = new Path("./common/",base_url);
			try {
				if (!Deno.statSync(common_dir).isFile) n_options.common.push(common_dir)
			}
			catch {}
		}

		// logger.info("options", {...n_options, import_map:{imports:n_options.import_map.imports}})

		// for unyt log
		Datex.Unyt.setAppInfo({name:n_options.name, version:n_options.version, stage:n_options.stage})

		// set .dx path to backend
		if (n_options.backend.length) {
			await endpoint_config.load(new URL("./.dx", n_options.backend[0]))
		}

		// connect to supranet
		if (endpoint_config.connect !== false) await Datex.Supranet.connect();
		else await Datex.Supranet.init();

		// TODO: map multiple backends to multiple frontends?
		let backend_with_default_export:BackendManager|undefined;

		// load backend
		for (const backend of n_options.backend) {
			const backend_manager = new BackendManager(n_options, backend, base_url, watch_backend);
			await backend_manager.run()
			if (backend_manager.content_provider!=undefined) {
				if (backend_with_default_export!=undefined) logger.warn("multiple backend entrypoint export a default content");
				backend_with_default_export = backend_manager; 
			}
		}

		// also override endpoint default
		if (backend_with_default_export) Datex.Runtime.endpoint_entrypoint = backend_with_default_export.content_provider;


		let server:Server|undefined
		// load frontend
		for (const frontend of n_options.frontend) {
			const frontend_manager = new FrontendManager(n_options, frontend, base_url, backend_with_default_export, watch, live_frontend)
			await frontend_manager.run();
			server = frontend_manager.server;
			this.frontends.set(frontend.toString(), frontend_manager);
		}
		// no frontend, but has backend with default export -> create empty frontedn
		if (!n_options.frontend.length && backend_with_default_export) {
			// TODO: remove tmp dir on exit
			const dir = new Path(Deno.makeTempDirSync()).asDir();
			const frontend_manager = new FrontendManager(n_options, dir, base_url, backend_with_default_export, watch, live_frontend)
			await frontend_manager.run();
			server = frontend_manager.server;
		}

		// expose DATEX interfaces
		// TODO: also enable without connect == false (For all uix servers), working, but routing problems
		if (server && endpoint_config.connect === false) {
			const DatexServer = (await import("unyt_node/datex_server.ts")).DatexServer
			DatexServer.addInterfaces(["websocket", "webpush"], server);
			// also add custom .dx file
			const data = new Map<Datex.Endpoint, {channels:Record<string,string>,keys:[ArrayBuffer, ArrayBuffer]}>();
			data.set(Datex.Runtime.endpoint,  {
				channels: {
					'websocket': '##location##'
				},
				keys: Datex.Crypto.getOwnPublicKeysExported()
			})
			server.path("/.dx", Datex.Runtime.valueToDatexStringExperimental(new Datex.Tuple({nodes:data}), true).replace('"##location##"', '#location'), 'text/datex')
		}

		await import("./http_over_datex.ts")
		
		try {
			for (const handler of this.#ready_handlers) await handler();
		}
		catch {}
	}

}

export function getDirType(app_options:normalized_app_options, path:Path) {	
	// backend path?
	for (const backend of app_options.backend) {
		if (path.isChildOf(backend)) return 'backend'
	}

	// frontend path?
	for (const frontend of app_options.frontend) {
		if (path.isChildOf(frontend)) return 'frontend'
	}

	// common path?
	for (const common of app_options.common) {
		if (path.isChildOf(common)) return 'common'
	}
}


export function urlToPath(url:string|URL){
	if (typeof url == "string" && url.startsWith("/")) return url;
	else return url.toString().replace("file://","");
}

export function validateDirExists(url:URL, type:string) {
	let dir = false;
	try {
		if (!Deno.statSync(url).isFile) dir = true;
	}
	catch {
		logger.error("The specified "+type+" directory '"+url+"' does not exist.");
		throw new Error("UIX App initialization failed");
	}
	if (!dir) {
		logger.error("The specified "+type+" path '"+url+"' is not a directory.");
		throw new Error("UIX App initialization failed");
	}
}


export const App = new UIXApp();