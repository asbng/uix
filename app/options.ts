import { ImportMap } from "unyt_node/importmap.ts";
import { Path } from "unyt_node/path.ts";

declare const Datex: any; // cannot import Datex here, circular dependency problems

export type app_options = {
	name?: string,  // app name
	description?: string, // app description
	icon_path?: string, // path to app icon / favicon
	version?: string, // app version
	installable?: boolean, // can be installed as standalone web app
	offline_support?: boolean, // add a service worker with offline cache
	expose_deno?: boolean, // access Deno namespace from the frontend context
	
	frontend?: string|URL|(string|URL)[], // directory for frontend code
	backend?:  string|URL|(string|URL)[] // directory for backend code
	common?: string|URL|(string|URL)[] // directory with access from both frontend end backend code
	pages?: string|URL // common directory with access from both frontend end backend code - gets mapped per default with a UIX.PageProvider for all frontends and backends without a entrypoint

	import_map_path?: string|URL, // custom importmap for the frontend
	import_map?: {imports:Record<string,string>} // prefer over import map path
}

export interface normalized_app_options extends app_options {
	frontend: Path[]
	backend: Path[]
	common: Path[],
	pages?: Path
	icon_path: string,

	scripts: (Path|string)[],
	import_map_path: never
	import_map: ImportMap
}
export async function normalizeAppOptions(options:app_options = {}, base_url?:string|URL): Promise<[normalized_app_options, URL]> {
	const n_options = <normalized_app_options> {};
		
	// determine base url
	if (typeof base_url == "string" && !base_url.startsWith("file://")) base_url = 'file://' + base_url;
	base_url ??= new Error().stack?.trim()?.match(/((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@)/)?.[1];
	if (!base_url) throw new Error("Could not determine the app base url (this should not happen)");
	base_url = new URL(base_url.toString());

	n_options.name = options.name;
	n_options.description = options.description;
	n_options.icon_path = options.icon_path ?? 'https://cdn.unyt.org/unyt_core/assets/skeleton_light.svg'
	n_options.version = options.version?.replaceAll("\n","");
	n_options.offline_support = options.offline_support ?? true;
	n_options.installable = options.installable ?? false;
	n_options.expose_deno = options.expose_deno ?? false;
	
	// import map or import map path
	if (options.import_map_path) {
		n_options.import_map = await ImportMap.fromPath(options.import_map_path);
	}
	else if (options.import_map) n_options.import_map = new ImportMap(options.import_map);
	else throw new Error("No importmap found or set in the app configuration") // should not happen

	if (options.frontend instanceof Datex.Tuple) options.frontend = options.frontend.toArray();
	if (options.backend instanceof Datex.Tuple) options.backend = options.backend.toArray();
	if (options.common instanceof Datex.Tuple) options.common = options.common.toArray();

	n_options.frontend = options.frontend instanceof Array ? options.frontend.filter(p=>!!p).map(p=>new Path(p,base_url).asDir()) : (new Path(options.frontend??'./frontend/', base_url).fs_exists ? [new Path(options.frontend??'./frontend/', base_url).asDir()] : []);
	n_options.backend  = options.backend instanceof Array  ? options.backend.filter(p=>!!p).map(p=>new Path(p,base_url).asDir()) :  (new Path(options.backend??'./backend/', base_url).fs_exists ? [new Path(options.backend??'./backend/', base_url).asDir()] : []);
	n_options.common   = options.common instanceof Array   ? options.common.filter(p=>!!p).map(p=>new Path(p,base_url).asDir()) :   (new Path(options.common??'./common/', base_url).fs_exists ? [new Path(options.common??'./common/', base_url).asDir()] : []);
	// pages dir or default pages dir
	if (options.pages) n_options.pages = new Path(options.pages,base_url).asDir()
	else {
		const defaultPagesDir = new Path('./pages/', base_url);
		if (defaultPagesDir.fs_exists) n_options.pages = defaultPagesDir;
	}

	// make sure pages are also a common dir (TODO: also option for only backend/frontend?)
	if (n_options.pages) {
		n_options.common.push(n_options.pages)
	}

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

	return [n_options, base_url]
}