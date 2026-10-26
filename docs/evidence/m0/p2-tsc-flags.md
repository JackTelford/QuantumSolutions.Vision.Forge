# P2: TypeScript flag behavior

Generated 2026-10-26T20:04:35.016Z by `node scripts/probes/run.ts p2-tsc-flags`.

| Fact | Value |
| --- | --- |
| typescript | Version 6.0.3 |
| node | v24.13.0 |

Each sample is compiled alone with `tsc -p` through node.exe (never tsc.cmd) under a config that extends the repository `tsconfig.base.json`. "Expected" is what the repository relies on; "Observed" is what this TypeScript did.

## Sample matrix

| Sample | Config | Expected | Observed | Match | First error | Why it matters |
| --- | --- | --- | --- | --- | --- | --- |
| ok.ts | node | accept | accept | ok |  | erasable syntax only, import type, .ts extensions, as const unions, explicit fields |
| ok.ts | browser | accept | accept | ok |  | erasable syntax only, import type, .ts extensions, as const unions, explicit fields |
| enum.ts | node | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | enum is not erasable |
| enum.ts | browser | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | enum is not erasable |
| namespace.ts | node | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | namespace with runtime code is not erasable |
| namespace.ts | browser | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | namespace with runtime code is not erasable |
| param-prop.ts | node | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | parameter property is not erasable |
| param-prop.ts | browser | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | parameter property is not erasable |
| angle-cast.ts | node | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | angle-bracket assertion is not erasable |
| angle-cast.ts | browser | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | angle-bracket assertion is not erasable |
| import-equals.ts | node | reject | reject | ok | error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled. | import = require is not erasable |
| no-extension.ts | node | reject | reject | ok | error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. | relative import without .ts extension |
| no-extension.ts | browser | reject | reject | ok | error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. | relative import without .ts extension |
| type-without-keyword.ts | node | reject | reject | ok | error TS1484: 'Shape' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled. | type imported without the type keyword under verbatimModuleSyntax |
| type-without-keyword.ts | browser | reject | reject | ok | error TS1484: 'Shape' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled. | type imported without the type keyword under verbatimModuleSyntax |
| decorator.ts | node | accept | accept | ok |  | decorators are NOT flagged by erasableSyntaxOnly (lint must catch them) |
| decorator.ts | browser | accept | accept | ok |  | decorators are NOT flagged by erasableSyntaxOnly (lint must catch them) |
| inline-type-specifier.ts | node | accept | accept | ok |  | inline type specifier is accepted by tsc (house rule enforced by lint) |
| inline-type-specifier.ts | browser | accept | accept | ok |  | inline type specifier is accepted by tsc (house rule enforced by lint) |
| dom-in-node.ts | node | reject | reject | ok | error TS2584: Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom | DOM global must not type-check under the node config |
| process-in-browser.ts | browser | reject | reject | ok | error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add  | Node global must not type-check under the browser config |
| any.ts | node | accept | accept | ok |  | tsc accepts explicit any (lint must catch it); noImplicitAny only catches implicit any |
| any.ts | browser | accept | accept | ok |  | tsc accepts explicit any (lint must catch it); noImplicitAny only catches implicit any |
| unchecked-index.ts | node | reject | reject | ok | error TS2322: Type 'string \| undefined' is not assignable to type 'string'. | noUncheckedIndexedAccess makes xs[0] string \| undefined |
| unchecked-index.ts | browser | reject | reject | ok | error TS2322: Type 'string \| undefined' is not assignable to type 'string'. | noUncheckedIndexedAccess makes xs[0] string \| undefined |

## Conclusion

All 25 checks behaved as the repository expects with TypeScript Version 6.0.3.

Scratch project: `.tmp\p2`.

## Not verified

- Decorators and inline type specifiers are accepted by tsc by design; scripts/lint.ts (M0b) must reject them.
