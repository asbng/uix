import { clear } from "../app/args.ts";
import type { normalizedAppOptions } from "../app/options.ts";
import { getExistingFile } from "../utils/file-utils.ts";
import { Path } from "../utils/path.ts";
import { logger, runParams } from "./runner.ts";


export const CSI = '\u001b['
export const CTRLSEQ = {
	CLEAR_SCREEN:						CSI + '2J',
	HOME:								CSI + 'H'
} as const;



export async function runLocal(params: runParams, root_path: URL, options: normalizedAppOptions, isWatching: boolean) {

	const run_script_url = "app/start.ts"
	const run_script_import_map_entry = options.import_map.imports['uix/'] + run_script_url;
	const run_script_abs_url = 
		(run_script_import_map_entry.startsWith("https://") || run_script_import_map_entry.startsWith("http://")) ?
		run_script_import_map_entry :
		new Path(run_script_import_map_entry, options.import_map.path??options.import_map_path).toString();

	// reload cache
	if (params.reload) {
		const deno_lock_path = getExistingFile(root_path, './deno.lock');
		if (deno_lock_path) {
			// console.log("removing " + new URL(deno_lock_path).pathname);
			await Deno.remove(deno_lock_path)
		}
	}

	// start actual deno process

	const config_params:string[] = [];

	const cmd = [
		"run",
		"-Aq"
	];

	if (params.enableTLS) cmd.push("--unsafely-ignore-certificate-errors=localhost");

	if (params.reload) {
		cmd.push("--reload");
	}

	if (params.inspect!=undefined) {
		if (params.inspect) cmd.push(`--inspect=${params.inspect}`);
		else cmd.push("--inspect");
	}

	if (params.unstable) {
		cmd.push("--unstable");
	}

	if (params.deno_config_path) {
		config_params.push("--config", params.deno_config_path instanceof URL && params.deno_config_path.protocol=="file:" ? new Path(params.deno_config_path).normal_pathname : params.deno_config_path.toString())
	}
	if (options.import_map.path) {
		config_params.push("--import-map", options.import_map.path?.is_web ? options.import_map.path.toString() : options.import_map.path?.normal_pathname)
	}

	let process: Deno.ChildProcess;

	// explicitly kill child process to trigger SIG event on child process
	// (required for saving state on exit)
	addEventListener("unload", ()=>{
		if (process) {
			try {
				process.kill();
			}
			catch {/* ignore */}
		}
		else {
			logger.error("Cannot kill child process")
		}
	}, {capture: true});

	Deno.addSignalListener("SIGINT", ()=>Deno.exit())


	try {
		// not supported by WiNdoWs
		Deno.addSignalListener("SIGTERM", ()=>Deno.exit())
		Deno.addSignalListener("SIGQUIT", ()=>Deno.exit())
	}
	catch {
		/* ignore */
	}
	
	let isClearingState = clear;
	let stateCleared = false;
	const args = [...Deno.args];

	await run();
	
	async function run() {
		await Deno.stdout.write(new TextEncoder().encode(CTRLSEQ.CLEAR_SCREEN));
		await Deno.stdout.write(new TextEncoder().encode(CTRLSEQ.HOME));
		if (stateCleared) {
			stateCleared = false;
			logger.warn("Cleared all eternal states on the backend");
		}

		const command = new Deno.Command(Deno.execPath(), {
			args: [
				...cmd,
				...config_params,
				run_script_abs_url,
				...config_params, // pass --import-map and --config also as runtime args to reconstruct the command when the backend restarts
				...args,
			]
		})
		process = command.spawn();

		// detach, continues in background
		// TODO: fix child process does not keep running correctly
		if (params.detach) {
			console.log(`UIX App running in background (PID ${process.pid})`);
			Deno.exit(0);
		}
		const exitStatus = await process.output();
		if (exitStatus.code == 42) {
			await run();
		}
		else if (isClearingState) {
			stateCleared = true;
			isClearingState = false;
			// restart without --clear
			args.splice(args.indexOf("--clear"), 1);
			await run();
		}
		else if (isWatching) {
			console.log("waiting until files are updated...");
			// error - wait until a file was modified before restart
			for await (const _event of Deno.watchFs(new Path(root_path).normal_pathname, {recursive: true})) {
				break;
			}
			await run();
		}

		Deno.exit(exitStatus.code);
	}
}