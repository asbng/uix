import type { Tuple } from "datex-core-legacy/types/tuple.ts";
import { ImportMap } from "../utils/importmap.ts";
import { Path } from "datex-core-legacy/utils/path.ts";

declare const Datex: any; // cannot import Datex here, circular dependency problems

export type appOptions = {
	name?: string,  // app name
	description?: string, // app description
	icon?: string, // path to app icon / favicon
	version?: string, // app version
	installable?: boolean, // can be installed as standalone web app
	offline_support?: boolean, // add a service worker with offline cache
	expose_deno?: boolean, // access Deno namespace from the frontend context
	
	manifest?: Record<string, any>, // override default PWA manifest options
	meta?: Record<string, string>, // custom meta tags (name, content)

	frontend?: string|URL|(string|URL)[], // directory for frontend code
	backend?:  string|URL|(string|URL)[] // directory for backend code
	common?: string|URL|(string|URL)[] // directory with access from both frontend end backend code
	pages?: string|URL // common directory with access from both frontend end backend code - gets mapped per default with a UIX.PageProvider for all frontends and backends without a entrypoint

	import_map_path?: string|URL, // custom importmap for the frontend
	import_map?: {imports:Record<string,string>} // prefer over import map path

	experimentalFeatures?: string|string[]
	debug_mode?: boolean // enable debug interfaces available on /@debug/...
	minify_js?: boolean // minify transpiled javascript modules, default: true
	preload_dependencies?: boolean // automatically preload all ts module dependencies, default: true
}

export interface normalizedAppOptions extends appOptions {
	frontend: Path.File[]
	backend: Path.File[]
	common: Path.File[],
	pages?: Path.File
	icon: string,

	scripts: (Path|string)[],
	import_map_path: never
	import_map: ImportMap,

	experimentalFeatures: string[]
}
export async function normalizeAppOptions(options:appOptions = {}, baseURL?:string|URL): Promise<[normalizedAppOptions, Path.File]> {
	const n_options = <normalizedAppOptions> {};
		
	// determine base url
	if (typeof baseURL == "string" && !baseURL.startsWith("file://")) baseURL = 'file://' + baseURL;
	baseURL ??= new Error().stack?.trim()?.match(/((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@)/)?.[1];
	if (!baseURL) throw new Error("Could not determine the app base url (this should not happen)");
	const basePath = Path.File(baseURL.toString());

	n_options.name = options.name;
	n_options.description = options.description;
	n_options.icon = options.icon ?? 'https://dev.cdn.unyt.org/unyt_core/assets/skeleton_light.svg'
	n_options.version = options.version?.replaceAll("\n","");
	n_options.offline_support = options.offline_support ?? true;
	n_options.installable = options.installable ?? false;
	n_options.expose_deno = options.expose_deno ?? false;
	
	n_options.manifest = options.manifest;
	n_options.meta = options.meta;

	n_options.experimentalFeatures = options.experimentalFeatures ? (options.experimentalFeatures instanceof Array ? options.experimentalFeatures : [options.experimentalFeatures]) : [];
	n_options.debug_mode = options.debug_mode ?? false;
	n_options.minify_js = options.minify_js ?? true;
	n_options.preload_dependencies = options.preload_dependencies ?? true;

	// import map or import map path
	if (options.import_map) n_options.import_map = new ImportMap(options.import_map);
	else if (options.import_map_path) {
		n_options.import_map = await ImportMap.fromPath(options.import_map_path);
	}
	else throw new Error("No importmap found or set in the app configuration") // should not happen

	// default frontend, backend, common
	if (options.frontend==undefined && new Path('./frontend/', basePath).fs_exists) options.frontend = [new Path('./frontend/', basePath)]
	if (options.backend==undefined && new Path('./backend/', basePath).fs_exists)   options.backend  = [new Path('./backend/', basePath)]
	if (options.common==undefined && new Path('./common/', basePath).fs_exists)     options.common   = [new Path('./common/', basePath)]

	// convert to arrays
	const frontends = options.frontend instanceof Array ? options.frontend : options.frontend instanceof Datex.Tuple ? (options.frontend as unknown as Tuple<string>).toArray() : [options.frontend]
	const backends  = options.backend instanceof Array ? options.backend : options.backend instanceof Datex.Tuple ? (options.backend as unknown as Tuple<string>).toArray() : [options.backend]
	const commons   = options.common instanceof Array ? options.common : options.common instanceof Datex.Tuple ? (options.common as unknown as Tuple<string>).toArray() : [options.common]

	// convert to absolute paths
	n_options.frontend = frontends.filter(p=>!!p).map(p=>new Path<Path.Protocol.File>(p,basePath).asDir().fsCreateIfNotExists());
	n_options.backend  = backends.filter(p=>!!p).map(p=>new Path<Path.Protocol.File>(p,basePath).asDir().fsCreateIfNotExists());
	n_options.common   = commons.filter(p=>!!p).map(p=>new Path<Path.Protocol.File>(p,basePath).asDir().fsCreateIfNotExists());

	// pages dir or default pages dir
	if (options.pages) n_options.pages = new Path<Path.Protocol.File>(options.pages,basePath).asDir()
	else {
		const defaultPagesDir = new Path<Path.Protocol.File>('./pages/', basePath);
		if (defaultPagesDir.fs_exists) n_options.pages = defaultPagesDir;
	}

	// make sure pages are also a common dir (TODO: also option for only backend/frontend?)
	if (n_options.pages) {
		n_options.common.push(n_options.pages)
	}

	if (!n_options.frontend.length) {
		// try to find the frontend dir
		const frontend_dir = new Path<Path.Protocol.File>("./frontend/",basePath);
		try {
			if (!Deno.statSync(frontend_dir).isFile) n_options.frontend.push(frontend_dir)
		}
		catch {}
	}

	if (!n_options.backend.length) {
		// try to find the backend dir
		const backend_dir = new Path<Path.Protocol.File>("./backend/",basePath);
		try {
			if (!Deno.statSync(backend_dir).isFile) n_options.backend.push(backend_dir)
		}
		catch {}
	}

	if (!n_options.common.length) {
		// try to find the common dir
		const common_dir = new Path<Path.Protocol.File>("./common/",basePath);
		try {
			if (!Deno.statSync(common_dir).isFile) n_options.common.push(common_dir)
		}
		catch {}
	}

	return [n_options, basePath]
}


export function getInferredRunPaths(importMap: ImportMap, rootPath: Path.File): {importMapPath: string|null, uixRunPath: string|null} {
	const importMapPath = importMap.originalPath ? importMap.originalPath.getAsRelativeFrom(rootPath) : null;
	const inferredAbsoluteRunPath = importMap.imports["uix"]?.replace(/\/uix\.ts$/, '/run.ts') ?? null as string|null;
	const uixRunPath = inferredAbsoluteRunPath ? 
		(
			Path.pathIsURL(inferredAbsoluteRunPath) ? 
				inferredAbsoluteRunPath : 
				new Path(inferredAbsoluteRunPath, importMap.path).getAsRelativeFrom(rootPath)) :
		null;

	return {
		importMapPath,
		uixRunPath
	}
}