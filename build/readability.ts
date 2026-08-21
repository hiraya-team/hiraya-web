import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Repository root used to resolve maintained source paths. */
const ROOT = process.cwd();
/** Authored source trees covered by the readability check. */
const SOURCE_DIRECTORIES = ["src", "build", "packages", "apps/system", "tests", "e2e"] as const;
/** Directories omitted because their TypeScript is generated or installed. */
const IGNORED_DIRECTORIES = new Set(["dist", "generated", "node_modules"]);
/** Symbol owners allowed to contain each centralized string literal. */
const SYMBOL_OWNERS: Readonly<Record<string, ReadonlySet<string>>> = {
  "web2-sync-v1": new Set(["src/sync/constants.ts"]),
  "hiraya-item-select": new Set(["packages/apps-ui/src/elements/item-list.ts", "apps/system/shared/src/index.ts"]),
  "hiraya-item-activate": new Set(["packages/apps-ui/src/elements/item-list.ts", "apps/system/shared/src/index.ts"]),
  "hiraya-item-context": new Set(["packages/apps-ui/src/elements/item-list.ts", "apps/system/shared/src/index.ts"]),
  "hiraya-item-reorder": new Set(["packages/apps-ui/src/elements/item-list.ts", "apps/system/shared/src/index.ts"]),
  "files:read": new Set(["src/apps/permissions.ts", "packages/app-runtime/src/dispatcher.ts"]),
  "files:write": new Set(["src/apps/permissions.ts", "packages/app-runtime/src/dispatcher.ts"]),
  "hiraya-active-desktop": new Set(["src/platform/storage/namespace.ts"]),
  singleton: new Set(["src/features/app-management/account-sync.ts", "src/filesystem/database.ts", "src/lib/outbox.ts", "src/platform/storage/database-client.ts"]),
};

/** Collects maintained TypeScript files beneath a source directory. */
function collect(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) collect(path.join(directory, entry.name), files);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path.join(directory, entry.name));
  }
}

/** Reports whether a declaration has a leading JSDoc comment. */
function hasDocumentation(node: ts.Node, source: ts.SourceFile): boolean {
  return (ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []).some((range) => source.text.startsWith("/**", range.pos));
}

/** Reports whether a node belongs to the documented declaration scope. */
function requiresDocumentation(node: ts.Node, source: ts.SourceFile): boolean {
  if (node.parent === source) {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return true;
    if (ts.isVariableStatement(node)) return Boolean(node.declarationList.flags & ts.NodeFlags.Const);
  }
  return (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && ts.isClassDeclaration(node.parent) && node.parent.parent === source;
}

/** Returns a useful declaration name for diagnostics. */
function declarationName(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((declaration) => declaration.name.getText(source)).join(", ");
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const name = (node as ts.NamedDeclaration).name;
  if (name && ts.isIdentifier(name)) return name.text;
  if (name) return name.getText(source);
  return "declaration";
}

/** Reports whether a path is a test contract where expected literals stay explicit. */
function isTestFile(file: string): boolean {
  return /(^|\/)(?:tests|e2e|test-fixture)\//.test(file) || /\.(?:test|e2e)\.tsx?$/.test(file);
}

/** Reports whether a string literal is a direct source expression. */
function isSourceExpression(node: ts.StringLiteralLike): boolean {
  const parent = node.parent;
  return !ts.isLiteralTypeNode(parent)
    && !(ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
    && !ts.isExternalModuleReference(parent);
}

/** Formats a source location for a readability failure. */
function location(file: string, source: ts.SourceFile, node: ts.Node): string {
  const position = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${file}:${position.line + 1}:${position.character + 1}`;
}

/** Checks documentation and centralized string ownership across maintained sources. */
function main(): void {
  const files: string[] = [];
  for (const directory of SOURCE_DIRECTORIES) collect(path.join(ROOT, directory), files);
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:vite|playwright).*\.tsx?$/.test(entry.name)) files.push(path.join(ROOT, entry.name));
  }

  const failures: string[] = [];
  for (const absoluteFile of files.sort()) {
    const file = path.relative(ROOT, absoluteFile).split(path.sep).join("/");
    const source = ts.createSourceFile(absoluteFile, readFileSync(absoluteFile, "utf8"), ts.ScriptTarget.Latest, true, absoluteFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (requiresDocumentation(node, source) && !hasDocumentation(node, source)) failures.push(`${location(file, source, node)} ${declarationName(node, source)} requires /** */ documentation.`);
      if (file !== "build/readability.ts" && !isTestFile(file) && ts.isStringLiteralLike(node) && isSourceExpression(node)) {
        const owners = Object.hasOwn(SYMBOL_OWNERS, node.text) ? SYMBOL_OWNERS[node.text] : undefined;
        if (owners && !owners.has(file)) failures.push(`${location(file, source, node)} use the centralized symbol for ${JSON.stringify(node.text)}.`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Readability check passed for ${files.length} authored TypeScript files.`);
  }
}

main();
