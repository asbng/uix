# Localization
UIX allows for simple text content adaption depending on the user's selected language.

Localized text content can be realized with the help of dynamic [text pointers](https://docs.unyt.org/manual/datex/pointers#pointers-for-primitive-values) that change their value depending on the user language.

You can get the current user language with`DATEX.Runtime.ENV.LANG` or `UIX.language`.

## Defining localized text in DATEX resource scripts
The easiest way to create and load localizations is to define texts for multiple languages in a [DATEX Script](https://docs.unyt.org/manual/datex/important-datex-concepts) (*.dx*) file using the `localtext` helper function:

```datex
// file: localized.dx
use localtext from #std;

export const plane = localtext {
    en: "Plane",
    de: "Flugzeug",
    fr: "Avion"
}
```

The exported `plane` pointer now contains a text value that changes depending on the current language.

The exported `plane` value from the DATEX Script file can be imported with `datex.get`:
```ts
const { plane } = await datex.get("./localized.dx");
export default <h1>{plane}</h1>;
```

DATEX Script exports can also get automatically mapped to component properties with the [`@include` decorator](./04%20Components.md):

```tsx
import { Component } from "uix/components/Component.ts";
import { template } from "uix/html/template.ts";
import { include } from "uix/base/decorators.ts";

@template(function(this: MyApp) {
    return <h1>{this.plane} ✈️</h1>;
})
export class MyApp extends Component {
    @include("./localized.dx") plane!: string;
}
```

## Defining localized texts with TypeScript

Localized texts can also be defined in TypeScript with the `localtext` method.
```tsx
import { localtext } from "unyt_core/datex_short.ts";

const strings = {
    title: localtext({
        de: 'Hallo Welt',
        en: 'Hello world'
    }),
    subtitle: localtext({
        de: 'Das ist meine App',
        en: 'This is my app'
    })
}

function myApp() {
    return <>
        <h1>{strings.title}</h1>
        <span>{strings.subtitle}</span>
    </>;
)
```

