# shortcuts-scripts

JavaScript and TypeScript scripts for Apple Shortcuts. The Shortcut Helpers app runs them with its **Run Repo Script** action: it downloads this repository's default branch from GitHub and runs one file from it. After a push, the next run of every shortcut that uses a script runs the new version, with no shortcut edited.

## Naming a script in a shortcut

Set **Script** to the file's path in this repository, for example `src/hello.ts`. Write it exactly as it is here: no leading `/` or `./`, and the same case.

The app keeps only files ending in `.js`, `.mjs`, `.cjs`, `.ts`, `.mts` or `.cts`, from anywhere in the repository. Shortcut scripts live in `src/`. The repository's own tooling files (for example `scripts/check-scripts.ts`) are script files too, so the app lists them as well. Do not run them from a shortcut.

## The script format

A script is the body of a function, not a module. The app removes TypeScript types (it does not check them) and runs:

```js
(function (input, inputText) {
  /* the file's text */
});
```

- `input` is the shortcut's input parsed as JSON when it parses, otherwise the input text, or `null` when there is no input.

- `inputText` is always the input as a string (`""` when there is none).

- Use a bare top-level `return` to give the shortcut its result. A returned string comes back as is. Anything else comes back as JSON.

- Do not use `export`, and do not use `import`. A file with either fails when it runs. One script cannot import another yet.

- The script runs in JavaScriptCore with no DOM, network (`fetch`), timers (`setTimeout`), modules or file access.

Example, `src/hello.ts`:

<!-- prettier-ignore -->
```ts
const who: string = input?.name ?? "world"; return "Hello, " + who;
```

Given the input `{"name": "Ada"}` it returns `Hello, Ada`. Given no input it returns `Hello, world`.

## Checking scripts

Plain `tsc` cannot check these files: a top-level `return` is an error in a module (TS1108). `scripts/check-scripts.ts` wraps each file in `src/` the way the app does, with `input: any` and `inputText: string`, and type-checks the result. Line numbers in its errors are the file's own. It uses only the ESNext library, so `fetch`, `setTimeout` and DOM names are errors, as they are at run time.

```sh
bun install
bun run ts-check   # tsc for the tooling, then the script check
bun run signal     # type checks, ESLint and Prettier
```

GitHub Actions runs `bun run signal` on every push and every pull request.

`src/` is excluded from ESLint, because a top-level `return` crashes the shared ESLint rules, and from plain `tsc`.
