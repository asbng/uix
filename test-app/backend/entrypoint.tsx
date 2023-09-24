import { UIX } from "uix";
import { testComponents } from "../common/test-components.tsx";
import { invalid, notFound } from "../common/errors.tsx";


export default {
	'/:component/backend\\+dynamic' : (ctx, {component}) => UIX.renderDynamic(testComponents[component as keyof typeof testComponents] || notFound), 
	'/:component/backend\\+static'  : (ctx, {component}) => UIX.renderStatic(testComponents[component as keyof typeof testComponents] || notFound),
	'/:component/backend\\+hydrated': (ctx, {component}) => UIX.renderWithHydration(testComponents[component as keyof typeof testComponents] || notFound),
	'/:component/frontend': null,
	'/x/*': null,

	'exampleError': (ctx) => {
		throw new Error("This is an example error");
	},

	'setValue/:key/:val': async (ctx, {key, val}) => {
		(await ctx.getPrivateData())[key] = val;
		console.log("set value", key,val)
		return UIX.renderStatic(`${key}=${val}`)
	},
	'getValue/:key': async (ctx, {key}) => {
		const val = (await ctx.getPrivateData())[key];
		return UIX.renderStatic(`${key}=${val}`)
	},

	'*': invalid
} satisfies UIX.Entrypoint;