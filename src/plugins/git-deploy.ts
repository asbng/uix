import { AppPlugin } from "../app/app-plugin.ts";
import { Logger } from "datex-core-legacy/utils/logger.ts";
import { GitRepo } from "../utils/git.ts";
import { json2yaml } from "https://deno.land/x/json2yaml@v1.0.1/mod.ts";
import { Datex } from "datex-core-legacy/mod.ts";
import { isCIRunner } from "../utils/check-ci.ts";
import { normalizedAppOptions } from "../app/options.ts";
import { app } from "../app/app.ts";
import { Path } from "datex-core-legacy/utils/path.ts";
import { getInferredRunPaths } from "../app/options.ts";

const logger = new Logger("Git Deploy Plugin");

export default class GitDeployPlugin implements AppPlugin {
	name = "git_deploy"

	async apply(data: Record<string, unknown>, rootPath: Path.File, appOptions: normalizedAppOptions) {

		// don't update CI workflows from inside a CI runner
		if (isCIRunner()) {
			console.log("Skipping git_deploy plugin in CI runner.")
			return;
		}

		data = Object.fromEntries(Datex.DatexObject.entries(data));

		const gitRepo = await GitRepo.get();
		if (!gitRepo) {
			logger.warn("Git repo not found.");
			return;
		}
		const workflowDir = await gitRepo.initWorkflowDirectory();

		// TODO: also support gitlab
		const workflows = this.generateGithubWorkflows(data, rootPath, appOptions);

		// first delete all old uix-deploy.yml files
		for await (const entry of Deno.readDir(workflowDir.normal_pathname)) {
			if (entry.isFile && entry.name.startsWith("uix-deploy-") && entry.name.endsWith(".yml")) {
				await Deno.remove(workflowDir.getChildPath(entry.name).normal_pathname)
			}
		}

		for (const [fileName, content] of Object.entries(workflows)) {
			await Deno.writeTextFile(workflowDir.getChildPath(fileName).normal_pathname, content)
		}

	}

	generateGithubWorkflows(data: Record<string, unknown>, rootPath: Path.File, appOptions: normalizedAppOptions) {
		const workflows: Record<string,string> = {}

		const {importMapPath, uixRunPath} = getInferredRunPaths(appOptions.import_map, rootPath)

		for (let [stage, config] of Object.entries(data)) {
			config = Object.fromEntries(Datex.DatexObject.entries(config));

			let on = config.on;
			const args = config.args;
			const branch = config.branch;
			const tests = config.tests ?? true;

			const useDevCDN = config.useDevCDN;
			const importmapPath = useDevCDN ? "https://dev.cdn.unyt.org/importmap.json" : (importMapPath??"https://cdn.unyt.org/importmap.json")
			const importmapPathUIX = useDevCDN ? "https://dev.cdn.unyt.org/uix1/importmap.dev.json" : (importMapPath??"https://cdn.unyt.org/importmap.json")
			const testRunPath = useDevCDN ? "https://dev.cdn.unyt.org/unyt_tests/run.ts" : "https://cdn.unyt.org/unyt-tests/run.ts"
			const uixRunnerPath = useDevCDN ? "https://dev.cdn.unyt.org/uix1/run.ts" : (uixRunPath??"https://cdn.unyt.org/uix/run.ts")

			if (branch && branch !== "*") {
				on = {
					[on]: {
						branches: branch instanceof Array ? branch : [branch]
					}
				}
			}

			const env:Record<string,string> = {};
			const env_strings:string[] = []

			if (!config.secrets) config.secrets = []

			// expose GITHUB_TOKEN;
			env["GITHUB_TOKEN"] = `$\{{secrets.GITHUB_TOKEN}}`

			for (const secret of config.secrets) {
				env[secret] = `$\{{secrets.${secret}}}`
				env_strings.push(`--env ${secret}=$${secret}`)
			}

			const testJob = {
				'runs-on': 'ubuntu-latest',
				steps: [
					{
						name: 'Checkout Repo',
						uses: 'actions/checkout@v3'
					},
					{
						name: 'Setup Deno',
						uses: 'denoland/setup-deno@v1'
					},
					{
						name: 'Run Tests',
						run: 'deno run -Aq --import-map '+importmapPath+' '+testRunPath+' -s --reportfile testreport.xml'
					},
					{
						name: 'Publish Test Report',
						uses: 'mikepenz/action-junit-report@v3',
						if: 'success() || failure()',
						with: {
							report_paths: 'testreport.xml'
						}
					}
			
				]
			}

			const deployJob = {
				'runs-on': 'ubuntu-latest',
				steps: [
					{
						name: 'Checkout Repo',
						uses: 'actions/checkout@v3',
						with: {
							submodules: 'recursive'
						}
					},
					{
						name: 'Setup Deno',
						uses: 'denoland/setup-deno@v1'
					},
					{
						name: 'Deploy UIX App',
						run: `deno run --importmap ${importmapPathUIX} -Aqr ${uixRunnerPath} --stage ${stage} --detach` + (args?.length ? ' ' + args.join(" ") : '') + (env_strings?.length ? ' ' + env_strings.join(" ") : '')
					}
				]
			}


			const workflow = {
				name: `Deploy ${stage}`,
				on,
				env,
				jobs: {
					deploy: deployJob,
				}
			}

			if (tests) {
				deployJob.needs = 'test';
				workflow.jobs = {
					test: testJob,
					deploy: deployJob
				}
			}

			workflows[`uix-deploy-${stage}.yml`] = `# This file was auto generated by the uix git_deploy plugin. Do not manually edit.\n\n${json2yaml(JSON.stringify(workflow))}` 
		}

		return workflows
	}
}