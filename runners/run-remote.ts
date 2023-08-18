import { normalizedAppOptions } from "../app/options.ts";
import type {runParams} from "../run.ts";
import { stage, env, watch } from "../app/args.ts";
import { ESCAPE_SEQUENCES } from "unyt_core/utils/logger.ts";
import { GitRepo } from "../utils/git.ts";

declare const Datex: any; // cannot import Datex here, circular dependency problems

// copied from ContainerManager
enum ContainerStatus {
	STOPPED = 0,
	STARTING = 1,
	RUNNING = 2,
	STOPPING = 3,
	FAILED = 4,
	INITIALIZING = 5,
	ONLINE = 6
}


/**
 * Run UIX app on a remote host
 * Currently using git for file sync with remote
 */
export async function runRemote(params: runParams, root_path: URL, options: normalizedAppOptions, backend: URL, requiredLocation: Datex.Endpoint, stageEndpoint: Datex.Endpoint, customDomains: Record<string,number|null> = {}) {
	const logger = new Datex.Logger();

	const repo = await GitRepo.get();

	// Git: All changes have to be added
	const unaddedFiles = await repo.getUnaddedFiles();
	if (unaddedFiles) {
		logger.error(`You have changed files that are not yet updated on the git origin:\n${unaddedFiles}\nPlease add, commit, and push all changes first.`)
		Deno.exit(1)
	}

	// Git: All changes have to be committed
	const uncommitedChanges = await repo.getUncommittedChanges();
	if (uncommitedChanges) {
		logger.error(`You have uncommitted changes:\n${uncommitedChanges}\nPlease commit all changes (git commit -m "commit message") first.`)
		Deno.exit(1)
	}


	// Git: changes have to be pushed
	const hasUnpushedChanges = await repo.getHasUnpushedChanges();
	if (hasUnpushedChanges) {
		logger.error(`You have not pushed your recent changes in the '${repo.branch}' branch to ${repo.origin}.\nPlease run 'git push' first.`)
		Deno.exit(1)
	}

	await Datex.Supranet.connect()

	if (!await requiredLocation.isOnline()) {
		logger.error(`Host endpoint ${requiredLocation} not reachable`)
		Deno.exit(1)
	}

	console.log('Deploying "'+options.name+'" ('+stage+')...');

	// sanitized uix args
	const args = [];
	if (watch) args.push("--watch");

	try {
		let loaded = false;

		setTimeout(()=>{
			if (!loaded) {
				logger.error('❌ Timeout ' + stageEndpoint + (Object.keys(customDomains).length ? ` (${Object.keys(customDomains).map(domain=>`https://${domain}`).join(", ")})` : '') +" on " + requiredLocation);
				Deno.exit(1)
			}
		}, 80_000);

		const container = await datex<any> `
			use ContainerManager from ${requiredLocation};
			ContainerManager.createUIXAppContainer(
				${repo.origin}, 
				${repo.branch}, 
				${stageEndpoint},
				${stage},
				${customDomains},
				${env},
				${args},
				${Deno.env.get("GITHUB_TOKEN")}
			)
		`
		// console.log("");
		// logger.error(container)


		// observe container status and exit
		Datex.Value.observeAndInit(await datex `${container}->status`, async (status: ContainerStatus) => {
			// As soon as container is running, keep process alive, show remote container logs
			if (!params.detach && status == ContainerStatus.RUNNING) {
				loaded = true;
				const stream = (await container.getLogs());
				// @ts-ignore TODO: only workaround, make persistent
				globalThis.__stream = stream;

				const logs = stream.getReader() as ReadableStreamDefaultReader;
				streamLogs(logs)
			}
			// As soon as endpoint is online: don't stream logs, close process
			else if (params.detach && status == ContainerStatus.ONLINE) {
				loaded = true;
				console.log(ESCAPE_SEQUENCES.GREEN + stageEndpoint + (Object.keys(customDomains).length ? ` (${Object.keys(customDomains).map(domain=>`https://${domain}`).join(", ")})` : '') +" is running on " + requiredLocation + ESCAPE_SEQUENCES.RESET);
				Deno.exit(0)
			}
			else if (status == ContainerStatus.FAILED) {
				loaded = true;
				logger.error('❌ Failed to start ' + stageEndpoint + (Object.keys(customDomains).length ? ` (${Object.keys(customDomains).map(domain=>`https://${domain}`).join(", ")})` : '') +" on " + requiredLocation);
				Deno.exit(1)
			}
		})
	}

	catch (e) {
		console.log(e.message);
		logger.error('❌ Failed to start ' + stageEndpoint + (Object.keys(customDomains).length ? ` (${Object.keys(customDomains).map(domain=>`https://${domain}`).join(", ")})` : '') +" on " + requiredLocation);
		Deno.exit(1)
	}
	

}

function streamLogs(reader: ReadableStreamDefaultReader) {
	function readStream() {
		reader.read().then(({ done, value }) => {
		  if (done) {
			// Stream ended, exit the loop
			console.log("Stream ended");
			return;
		  }
	  
		  // Process and print the data
		  Deno.stdout.writeSync(value)
	  
		  // Continue reading the stream
		  readStream();
		});
	  }
	  
	  // Start reading the stream
	  readStream();
}