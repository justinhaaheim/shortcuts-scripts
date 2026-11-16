/**
 * Type-check every script in src/ the way Shortcut Helpers runs it.
 *
 * A script is a function body, not a module: the app's Run Repo Script action
 * strips TypeScript types and evaluates
 *   `(function (input, inputText) {` + file text + `\n})`
 * so a file uses a bare top-level `return`. Plain `tsc` refuses that (TS1108),
 * so this check wraps each file the same way, with `input: any` and
 * `inputText: string`, and checks the wrapped text. The wrapper head sits on
 * the script's first line, so line numbers match the file.
 *
 * The scripts run in JavaScriptCore with no DOM, network, timers or modules,
 * so the check uses only the ESNext library: no DOM types, no Bun or Node
 * types.
 *
 * Usage: bun scripts/check-scripts.ts
 */
import {readdirSync} from 'node:fs';
import {extname, join, relative, resolve} from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dir, '..');
const SCRIPTS_DIR = join(ROOT, 'src');
const SCRIPT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
]);
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

const TS_WRAPPER_HEAD = '(function (input: any, inputText: string) {';
const JS_WRAPPER_HEAD =
  '(/** @param {any} input @param {string} inputText */ function (input, inputText) {';
const WRAPPER_TAIL = '\n})';

type WrappedScript = {
  absolutePath: string;
  headLength: number;
  relativePath: string;
  text: string;
};

function listScriptFiles(dir: string): string[] {
  // Throws when src/ cannot be read: a failed listing is never "no scripts".
  const entries = readdirSync(dir, {recursive: true, withFileTypes: true});
  return entries
    .filter(
      (entry) => entry.isFile() && SCRIPT_EXTENSIONS.has(extname(entry.name)),
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function wrapScript(absolutePath: string): WrappedScript {
  const source = ts.sys.readFile(absolutePath);
  if (source == null) {
    throw new Error(`Could not read ${absolutePath}`);
  }
  // The app removes a byte order mark before running the file.
  const body = source.startsWith('﻿') ? source.slice(1) : source;
  const head = JS_EXTENSIONS.has(extname(absolutePath))
    ? JS_WRAPPER_HEAD
    : TS_WRAPPER_HEAD;
  return {
    absolutePath,
    headLength: head.length,
    relativePath: relative(ROOT, absolutePath),
    text: head + body + WRAPPER_TAIL,
  };
}

function readCompilerOptions(): ts.CompilerOptions {
  const configPath = join(ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (read.error != null) {
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  return {
    ...parsed.options,
    lib: ['lib.esnext.d.ts'],
    noEmit: true,
    // A script need not use both input and inputText.
    noUnusedParameters: false,
    types: [],
  };
}

function formatDiagnostic(
  diagnostic: ts.Diagnostic,
  scriptsByPath: Map<string, WrappedScript>,
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const code = `TS${diagnostic.code}`;
  const file = diagnostic.file;
  if (file == null || diagnostic.start == null) {
    return `error ${code}: ${message}`;
  }
  const script = scriptsByPath.get(resolve(file.fileName));
  const position = file.getLineAndCharacterOfPosition(diagnostic.start);
  if (script == null) {
    return `${relative(ROOT, file.fileName)}:${position.line + 1}:${position.character + 1} - error ${code}: ${message}`;
  }
  let column = position.character + 1;
  let where = '';
  if (position.line === 0) {
    if (position.character < script.headLength) {
      column = 1;
      where = ' (in the wrapper the app adds)';
    } else {
      column = position.character - script.headLength + 1;
    }
  }
  return `${script.relativePath}:${position.line + 1}:${column} - error ${code}: ${message}${where}`;
}

function main(): number {
  const files = listScriptFiles(SCRIPTS_DIR);
  if (files.length === 0) {
    console.error(
      `check-scripts: found no script files under ${relative(ROOT, SCRIPTS_DIR)}/, so nothing was checked.`,
    );
    return 1;
  }

  const scripts = files.map(wrapScript);
  const scriptsByPath = new Map(
    scripts.map((script) => [resolve(script.absolutePath), script]),
  );
  const options = readCompilerOptions();
  const host = ts.createCompilerHost(options);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const script = scriptsByPath.get(resolve(fileName));
    if (script == null) {
      return defaultGetSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreate,
      );
    }
    return ts.createSourceFile(fileName, script.text, languageVersion, true);
  };
  host.readFile = (fileName) =>
    scriptsByPath.get(resolve(fileName))?.text ?? defaultReadFile(fileName);

  const program = ts.createProgram({
    host,
    options,
    rootNames: scripts.map((script) => script.absolutePath),
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic, scriptsByPath));
  }
  if (diagnostics.length > 0) {
    console.error(
      `check-scripts: ${diagnostics.length} error(s) in ${scripts.length} script(s).`,
    );
    return 1;
  }
  console.log(`check-scripts: ${scripts.length} script(s) type-check.`);
  return 0;
}

process.exit(main());
