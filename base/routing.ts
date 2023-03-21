// deno-lint-ignore-file no-namespace

import { Path } from "unyt_node/path.ts";
import { Logger } from "unyt_core/datex_all.ts";
import { resolveEntrypointRoute, Entrypoint, html_content_or_generator, provideError, RenderMethod, RoutingHandler } from "../html/rendering.ts";
import { HTMLUtils } from "../html/utils.ts";

/**
 * Generalized implementation for setting the route in the current tab URL
 * Used in combination with components
 * You should only use the Routing.update() method in most cases to update the current URL, and otherwise rely on the component specific routing implementation (resolveRoute, handleRoute, getInternalRoute)
 */

const logger = new Logger("UIX Routing");

export namespace Routing {

	let frontend_entrypoint: Entrypoint|undefined
	let backend_entrypoint: Entrypoint|undefined
	let current_content: any;

	// @deprecated
	export const Prefix = {};
	export function setPrefix(){}

	export function getCurrentRouteFromURL() {
		return Path.Route(window.location.href ?? import.meta.url);
	}

	export function setCurrentRoute(url?:string|URL, silent?: boolean):Promise<void>
	export function setCurrentRoute(parts?:string[], silent?: boolean):Promise<void>
	export function setCurrentRoute(_route?:string|string[]|URL, silent = false) {
		if (!globalThis.history) return;
		const route = Path.Route(_route);
		if (Path.routesAreEqual(getCurrentRouteFromURL(), route)) return; // no change, ignore

		history.pushState(null, "", route.routename);
	
		if (!silent) return handleCurrentURLRoute();
	}


	export async function setEntrypoints(frontend?: Entrypoint, backend?: Entrypoint) {
		frontend_entrypoint = frontend;
		backend_entrypoint = backend;
		const backend_available = backend_entrypoint ? await initEndpointContent(backend_entrypoint) : false;
		const frontend_available = frontend_entrypoint ? await initEndpointContent(frontend_entrypoint) : false;
		// no content for path found after initial loading
		if (!frontend_available && !backend_available) {
			document.body.innerHTML = await (await provideError("Page not found on frontend")).text();
		}
	}


	async function initEndpointContent(entrypoint:Entrypoint) {
		const content = await getContentFromEntrypoint(entrypoint)
		if (content != null) await setContent(content)
		return content != null
	}

	async function getContentFromEntrypoint(entrypoint: Entrypoint, route: Path.Route = getCurrentRouteFromURL()) {
		const [collapsed_content, _render_method] = <[html_content_or_generator, RenderMethod]><any> await resolveEntrypointRoute(entrypoint, route, undefined, false);
		return collapsed_content;
	}

	async function setContent(content: html_content_or_generator) {
		if (current_content !== content) {
			current_content = content;
			document.body.innerHTML = "";
			// console.log("-->",collapsed_content)
			// TODO: 
			if (typeof content == "object" && !(content instanceof HTMLElement)) console.warn("invalid content, cannot handle yet", content)
			HTMLUtils.append(document.body, content) // add to document
		}
	
		await update(getCurrentRouteFromURL(), false)
	}


	async function handleCurrentURLRoute(){
		let content:any;

		// try frontend entrypoint
		if (frontend_entrypoint) content = await getContentFromEntrypoint(frontend_entrypoint)
		// try backend entrypoint
		if (content == null && backend_entrypoint) content = await getContentFromEntrypoint(backend_entrypoint);

		// still nothing found - route could not be fully resolved on frontend, try to reload from backend
		if (content == null) {
			logger.warn `no content for ${getCurrentRouteFromURL().routename}, reloading page from backend`; 
			window.location.reload();
		}

		await setContent(content);
	}

	/**
	 * updates the current URL with the current route requested from the get_handler
	 */
	export async function update(compare?:Path.route_representation, load_current_new = false){

		// first load current route
		if (load_current_new) await handleCurrentURLRoute();

		if (typeof current_content?.getInternalRoute === "function") {
			const current_route = Path.Route(await (<RoutingHandler>current_content).getInternalRoute());

			// check of accepted route matches new calculated current_route
			if (compare && !Path.routesAreEqual(compare, current_route)) {
				logger.warn `new route should be "${Path.Route(compare).routename}", but was changed to "${current_route.routename}". Make sure getInternalRoute() and onRoute() are consistent in all components.`;
				// stop ongoing loading animation
				window.stop()
			}

			setCurrentRoute(current_route, true); // update silently
		}

		logger.success `new route: ${getCurrentRouteFromURL().routename??"/"}`;

	}


	// listen for history changes
	// globalThis.addEventListener('popstate', (e) => {
	// 	handleCurrentURLRoute();
	// });

	// @ts-ignore
	globalThis.navigation?.addEventListener("navigate", (e:any)=>{

		if (!e.userInitiated || !e.canIntercept || e.downloadRequest || e.formData) return;
		const url = new URL(e.destination.url);
		if (url.origin != new URL(window.location.href).origin) return;

		// console.log("nav " + url, e)
		e.intercept({
			async handler() {
				await handleCurrentURLRoute();
			}
		})
		e.s
	})



}