import { UIX } from "uix";
import { testComponents } from "../common/test-components.tsx";
import { invalid, notFound } from "../common/errors.tsx";

export default {
	'/:component/frontend': ctx => testComponents[ctx.match?.pathname.groups['component'] as keyof typeof testComponents] || notFound,
	'/:component/backend*': null,
	'/x/*': {
		'/lazy': () => import("./lazy.tsx")
	},
	'*': invalid
} satisfies UIX.Entrypoint;