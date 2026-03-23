import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { builtinModules } from "node:module"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { dedupePluginsByCanonicalName, extractCanonicalPluginName } from "../registry/merge"
import type { Registry } from "../schemas/registry"
import { normalizeComponentManifest, normalizeFile } from "../schemas/registry"
import {
	mergeNpmDependencySpecifiers,
	parseNpmDependencySpecifier,
} from "../utils/npm-dependencies"
import { resolveTargetPath } from "../utils/paths"
import {
	HOST_RUNTIME_PACKAGES,
	isHostRuntimePackage,
	seedHostRuntimePackages,
} from "./host-runtime-packages"
import type { PluginLoadabilityIssue, PluginLoadabilityValidationResult } from "./validators"

const VALIDATION_ROOT_PREFIX = "ocx-plugin-validation-"
const RUNTIME_SMOKE_RESULT_FILE_PREFIX = ".ocx-plugin-runtime-smoke-"

const ENTRYPOINT_EXTENSIONS = new Set([
	".ts",
	".js",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".tsx",
	".jsx",
])

const LOCAL_RESOLUTION_EXTENSIONS = [
	"",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
	".json",
]

const INDEX_CANDIDATES = [
	"index.ts",
	"index.tsx",
	"index.js",
	"index.jsx",
	"index.mts",
	"index.cts",
	"index.mjs",
	"index.cjs",
	"index.json",
]

const NON_DETERMINISTIC_PLUGIN_VERSIONS = new Set(["*", "latest"])

const EXACT_PINNED_SEMVER_VERSION =
	/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

const NODE_BUILTIN_PACKAGE_NAMES = new Set(
	builtinModules
		.map((moduleName) => (moduleName.startsWith("node:") ? moduleName.slice(5) : moduleName))
		.map((moduleName) => moduleName.split("/")[0] ?? moduleName),
)

interface PackagePluginSpec {
	rawSpecifier: string
	packageName: string
	version: string
	components: string[]
	deterministic: boolean
}

interface StaticAnalysisContext {
	stagedFileSet: Set<string>
	componentOwnersByRelativePath: Map<string, Set<string>>
	issues: PluginLoadabilityIssue[]
	externalImportsByPackage: Map<string, { components: Set<string>; entrypoints: Set<string> }>
	entrypointsBlockedFromRuntime: Set<string>
}

export class PluginLoadabilityOperationalError extends Error {
	constructor(
		message: string,
		public readonly details: string[] = [],
	) {
		super(message)
		this.name = "PluginLoadabilityOperationalError"
	}
}

export async function runPluginLoadabilityValidation(
	registry: Registry,
	sourcePath: string,
): Promise<PluginLoadabilityValidationResult> {
	const validationRoot = await mkdtemp(join(tmpdir(), VALIDATION_ROOT_PREFIX))

	try {
		const { stagedFileSet, componentOwnersByRelativePath, fileBackedEntrypoints, workspaceRoot } =
			await stageRegistryInstallTree(registry, sourcePath, validationRoot)

		const issues: PluginLoadabilityIssue[] = []

		const packagePluginSpecs = collectPackagePluginSpecs(registry, issues)

		const analysisContext: StaticAnalysisContext = {
			stagedFileSet,
			componentOwnersByRelativePath,
			issues,
			externalImportsByPackage: new Map(),
			entrypointsBlockedFromRuntime: new Set(),
		}

		for (const entrypoint of fileBackedEntrypoints) {
			await analyzeEntrypointStaticImports(entrypoint, validationRoot, analysisContext)
		}

		const manifestDependencyMerge = collectManifestDependencyMaps(registry, issues)

		const declaredPackageNames = new Set<string>()
		for (const packageName of manifestDependencyMerge.dependencies.keys()) {
			declaredPackageNames.add(packageName)
		}
		for (const packageName of manifestDependencyMerge.devDependencies.keys()) {
			declaredPackageNames.add(packageName)
		}
		for (const packagePluginSpec of packagePluginSpecs) {
			declaredPackageNames.add(packagePluginSpec.packageName)
		}
		for (const hostPackageName of Object.keys(HOST_RUNTIME_PACKAGES)) {
			declaredPackageNames.add(hostPackageName)
		}

		for (const [packageName, usage] of analysisContext.externalImportsByPackage.entries()) {
			if (declaredPackageNames.has(packageName)) {
				continue
			}

			issues.push(
				createIssue({
					code: "plugin_external_dependency_undeclared",
					severity: "error",
					message:
						`Package "${packageName}" is imported by plugin entrypoint(s) ` +
						`${Array.from(usage.entrypoints).sort().join(", ")} but is not declared in npmDependencies/npmDevDependencies`,
					affectedComponents: Array.from(usage.components).sort(),
					affectedEntrypoints: Array.from(usage.entrypoints).sort(),
				}),
			)

			for (const entrypoint of usage.entrypoints) {
				analysisContext.entrypointsBlockedFromRuntime.add(entrypoint)
			}
		}

		const deterministicPackagePlugins = packagePluginSpecs.filter((spec) => spec.deterministic)

		const runtimeFileEntrypoints = fileBackedEntrypoints.filter(
			(entrypoint) => !analysisContext.entrypointsBlockedFromRuntime.has(entrypoint),
		)

		const runtimeTargets = [
			...runtimeFileEntrypoints.map((entrypoint) => `./${entrypoint.replace(/^\.opencode\//, "")}`),
			...deterministicPackagePlugins.map((spec) => spec.packageName),
		]

		if (runtimeTargets.length > 0) {
			await writeValidationWorkspacePackageJson(
				workspaceRoot,
				manifestDependencyMerge.dependencies,
				manifestDependencyMerge.devDependencies,
				deterministicPackagePlugins,
			)

			const hostPackagesToSeed = new Set<string>()
			for (const packageName of declaredPackageNames) {
				if (isHostRuntimePackage(packageName)) {
					hostPackagesToSeed.add(packageName)
				}
			}

			const shouldHydrateDependencies = shouldHydrateManifestDependencies(
				manifestDependencyMerge.dependencies,
				manifestDependencyMerge.devDependencies,
				deterministicPackagePlugins,
			)

			if (shouldHydrateDependencies) {
				await hydrateWorkspaceDependencies(workspaceRoot)
			}

			if (hostPackagesToSeed.size > 0) {
				await seedHostRuntimePackages(workspaceRoot, hostPackagesToSeed)
			}

			const runtimeFailures = await runRuntimeSmokeImports(workspaceRoot, runtimeTargets)

			for (const failure of runtimeFailures) {
				if (failure.target.startsWith("./")) {
					const relativeEntrypoint = `.opencode/${failure.target.slice(2).replace(/\\/g, "/")}`
					issues.push(
						createIssue({
							code: "plugin_runtime_entrypoint_import_failed",
							severity: "error",
							message: `${relativeEntrypoint}: Runtime import failed - ${failure.message}`,
							affectedComponents: getOwnersForRelativePath(
								relativeEntrypoint,
								componentOwnersByRelativePath,
							),
							affectedEntrypoints: [relativeEntrypoint],
						}),
					)
					continue
				}

				const matchingPackagePlugin = deterministicPackagePlugins.find(
					(spec) => spec.packageName === failure.target,
				)
				issues.push(
					createIssue({
						code: "plugin_runtime_package_import_failed",
						severity: "error",
						message: `Package plugin "${failure.target}" failed runtime import - ${failure.message}`,
						affectedComponents: matchingPackagePlugin?.components ?? [],
						affectedEntrypoints: [
							`package:${matchingPackagePlugin?.rawSpecifier ?? failure.target}`,
						],
					}),
				)
			}
		}

		const errors = issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.rendered)
		const warnings = issues
			.filter((issue) => issue.severity === "warning")
			.map((issue) => issue.rendered)

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			issues,
		}
	} finally {
		await rm(validationRoot, { recursive: true, force: true })
	}
}

function collectManifestDependencyMaps(
	registry: Registry,
	issues: PluginLoadabilityIssue[],
): {
	dependencies: Map<string, string>
	devDependencies: Map<string, string>
} {
	const npmDependencies: string[] = []
	const npmDevDependencies: string[] = []

	for (const component of registry.components) {
		if (component.npmDependencies) {
			npmDependencies.push(...component.npmDependencies)
		}
		if (component.npmDevDependencies) {
			npmDevDependencies.push(...component.npmDevDependencies)
		}
	}

	try {
		return mergeNpmDependencySpecifiers(npmDependencies, npmDevDependencies)
	} catch (error) {
		issues.push(
			createIssue({
				code: "plugin_manifest_dependency_conflict",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
				affectedComponents: [],
				affectedEntrypoints: [],
			}),
		)
		return {
			dependencies: new Map(),
			devDependencies: new Map(),
		}
	}
}

function collectPackagePluginSpecs(
	registry: Registry,
	issues: PluginLoadabilityIssue[],
): PackagePluginSpec[] {
	const allPluginSpecifiers: string[] = []
	const ownerByCanonicalName = new Map<string, Set<string>>()

	for (const component of registry.components) {
		const normalizedComponent = normalizeComponentManifest(component)
		const pluginSpecifiers = normalizedComponent.opencode?.plugin ?? []
		for (const pluginSpecifier of pluginSpecifiers) {
			allPluginSpecifiers.push(pluginSpecifier)

			const canonicalName = extractCanonicalPluginName(pluginSpecifier)
			if (!ownerByCanonicalName.has(canonicalName)) {
				ownerByCanonicalName.set(canonicalName, new Set())
			}
			ownerByCanonicalName.get(canonicalName)?.add(component.name)
		}
	}

	const dedupedSpecifiers = dedupePluginsByCanonicalName(allPluginSpecifiers)

	if (!dedupedSpecifiers || dedupedSpecifiers.length === 0) {
		return []
	}

	const collectedSpecs: PackagePluginSpec[] = []
	for (const rawSpecifier of dedupedSpecifiers) {
		const trimmedSpecifier = rawSpecifier.trim()
		const owners = Array.from(
			ownerByCanonicalName.get(extractCanonicalPluginName(rawSpecifier)) ?? [],
		).sort()

		if (!trimmedSpecifier) {
			issues.push(
				createIssue({
					code: "plugin_package_spec_invalid",
					severity: "error",
					message: "Encountered an empty opencode.plugin package specifier",
					affectedComponents: owners,
					affectedEntrypoints: ["package:<empty>"],
				}),
			)
			continue
		}

		if (isQualifiedCrossRegistrySpecifier(trimmedSpecifier)) {
			issues.push(
				createIssue({
					code: "plugin_package_cross_registry_unsupported",
					severity: "error",
					message:
						`Unsupported qualified cross-registry plugin dependency "${trimmedSpecifier}" in opencode.plugin. ` +
						"Use npm package specifiers instead.",
					affectedComponents: owners,
					affectedEntrypoints: [`package:${trimmedSpecifier}`],
				}),
			)
			continue
		}

		const withoutNpmPrefix = trimmedSpecifier.startsWith("npm:")
			? trimmedSpecifier.slice(4)
			: trimmedSpecifier

		let parsedSpecifier: ReturnType<typeof parseNpmDependencySpecifier>
		try {
			parsedSpecifier = parseNpmDependencySpecifier(withoutNpmPrefix)
		} catch (error) {
			issues.push(
				createIssue({
					code: "plugin_package_spec_invalid",
					severity: "error",
					message:
						`Invalid package plugin specifier "${trimmedSpecifier}": ` +
						`${error instanceof Error ? error.message : String(error)}`,
					affectedComponents: owners,
					affectedEntrypoints: [`package:${trimmedSpecifier}`],
				}),
			)
			continue
		}

		const deterministic = isDeterministicPluginSpecifier(trimmedSpecifier, parsedSpecifier.version)

		if (!deterministic) {
			issues.push(
				createIssue({
					code: "plugin_package_spec_nondeterministic",
					severity: "warning",
					message:
						`Package plugin specifier "${trimmedSpecifier}" is non-deterministic and cannot be fully prevalidated. ` +
						"Prefer an exact pinned version.",
					affectedComponents: owners,
					affectedEntrypoints: [`package:${trimmedSpecifier}`],
				}),
			)
		}

		collectedSpecs.push({
			rawSpecifier: trimmedSpecifier,
			packageName: parsedSpecifier.name,
			version: parsedSpecifier.version,
			components: owners,
			deterministic,
		})
	}

	return collectedSpecs
}

function isDeterministicPluginSpecifier(specifier: string, parsedVersion: string): boolean {
	const normalizedSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier
	const hasExplicitVersion = hasExplicitSpecifierVersion(normalizedSpecifier)

	if (!hasExplicitVersion) {
		return false
	}

	return isDeterministicPluginVersion(parsedVersion)
}

function isDeterministicPluginVersion(version: string): boolean {
	const normalizedVersion = version.trim()
	if (!normalizedVersion) {
		return false
	}

	if (normalizedVersion.startsWith("file:")) {
		return true
	}

	if (NON_DETERMINISTIC_PLUGIN_VERSIONS.has(normalizedVersion.toLowerCase())) {
		return false
	}

	return EXACT_PINNED_SEMVER_VERSION.test(normalizedVersion)
}

function hasExplicitSpecifierVersion(specifier: string): boolean {
	if (!specifier) {
		return false
	}

	if (specifier.startsWith("@")) {
		const slashIndex = specifier.indexOf("/")
		if (slashIndex === -1) {
			return false
		}
		const packagePortion = specifier.slice(slashIndex + 1)
		return packagePortion.includes("@")
	}

	return specifier.includes("@")
}

function isQualifiedCrossRegistrySpecifier(specifier: string): boolean {
	if (specifier.startsWith("@") || specifier.startsWith("npm:")) {
		return false
	}

	return /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:@.+)?$/.test(specifier)
}

async function stageRegistryInstallTree(
	registry: Registry,
	sourcePath: string,
	validationRoot: string,
): Promise<{
	stagedFileSet: Set<string>
	componentOwnersByRelativePath: Map<string, Set<string>>
	fileBackedEntrypoints: string[]
	workspaceRoot: string
}> {
	const stagedFileSet = new Set<string>()
	const componentOwnersByRelativePath = new Map<string, Set<string>>()

	for (const component of registry.components) {
		for (const rawFile of component.files) {
			const file = normalizeFile(rawFile, component.type)
			const sourceFilePath = join(sourcePath, "files", file.path)
			if (!(await Bun.file(sourceFilePath).exists())) {
				continue
			}

			const resolvedTarget = resolveTargetPath(file.target, false, validationRoot)
			const targetPath = resolve(validationRoot, resolvedTarget)

			await mkdir(dirname(targetPath), { recursive: true })
			await Bun.write(targetPath, Bun.file(sourceFilePath))

			const normalizedRelativePath = relative(validationRoot, targetPath).replace(/\\/g, "/")
			stagedFileSet.add(resolve(targetPath))

			if (!componentOwnersByRelativePath.has(normalizedRelativePath)) {
				componentOwnersByRelativePath.set(normalizedRelativePath, new Set())
			}
			componentOwnersByRelativePath.get(normalizedRelativePath)?.add(component.name)
		}
	}

	const workspaceRoot = join(validationRoot, ".opencode")
	const fileBackedEntrypoints = await discoverFileBackedEntrypoints(workspaceRoot)

	return {
		stagedFileSet,
		componentOwnersByRelativePath,
		fileBackedEntrypoints,
		workspaceRoot,
	}
}

async function discoverFileBackedEntrypoints(workspaceRoot: string): Promise<string[]> {
	const entrypoints: string[] = []
	const pluginsDirectory = join(workspaceRoot, "plugins")

	try {
		await collectPluginEntrypointsRecursively(pluginsDirectory, pluginsDirectory, entrypoints)
	} catch {
		return entrypoints
	}

	return entrypoints.sort()
}

async function collectPluginEntrypointsRecursively(
	currentDirectory: string,
	pluginsRoot: string,
	entrypoints: string[],
): Promise<void> {
	const directoryEntries = await readdir(currentDirectory, { withFileTypes: true })

	for (const directoryEntry of directoryEntries) {
		const entryPath = join(currentDirectory, directoryEntry.name)

		if (directoryEntry.isDirectory()) {
			await collectPluginEntrypointsRecursively(entryPath, pluginsRoot, entrypoints)
			continue
		}

		if (!directoryEntry.isFile()) {
			continue
		}

		const extension = extname(directoryEntry.name).toLowerCase()
		if (!ENTRYPOINT_EXTENSIONS.has(extension)) {
			continue
		}

		const pluginRelativePath = relative(pluginsRoot, entryPath).replace(/\\/g, "/")
		entrypoints.push(`.opencode/plugins/${pluginRelativePath}`)
	}
}

async function analyzeEntrypointStaticImports(
	entrypointRelativePath: string,
	validationRoot: string,
	context: StaticAnalysisContext,
): Promise<void> {
	const entrypointAbsolutePath = resolve(validationRoot, entrypointRelativePath)
	const queue: string[] = [entrypointAbsolutePath]
	const visited = new Set<string>()

	while (queue.length > 0) {
		const currentPath = queue.shift()
		if (!currentPath || visited.has(currentPath)) {
			continue
		}
		visited.add(currentPath)

		const sourceFile = Bun.file(currentPath)
		if (!(await sourceFile.exists())) {
			context.issues.push(
				createIssue({
					code: "plugin_entrypoint_missing_file",
					severity: "error",
					message: `${entrypointRelativePath}: Missing file "${toRelativeStagedPath(currentPath)}"`,
					affectedComponents: getOwnersForAbsolutePath(
						currentPath,
						context.componentOwnersByRelativePath,
					),
					affectedEntrypoints: [entrypointRelativePath],
				}),
			)
			context.entrypointsBlockedFromRuntime.add(entrypointRelativePath)
			continue
		}

		const sourceContent = await sourceFile.text()
		const parseResult = parseStaticValueSpecifiers(currentPath, sourceContent)
		if (parseResult.parseError) {
			context.issues.push(
				createIssue({
					code: "plugin_entrypoint_syntax_error",
					severity: "error",
					message:
						`${entrypointRelativePath}: Invalid syntax in "${toRelativeStagedPath(currentPath)}" - ` +
						`${parseResult.parseError}`,
					affectedComponents: getOwnersForAbsolutePath(
						currentPath,
						context.componentOwnersByRelativePath,
					),
					affectedEntrypoints: [entrypointRelativePath],
				}),
			)
			context.entrypointsBlockedFromRuntime.add(entrypointRelativePath)
			continue
		}

		for (const specifier of parseResult.valueSpecifiers) {
			if (isRelativeSpecifier(specifier)) {
				const resolvedSpecifier = resolveRelativeSpecifier(
					currentPath,
					specifier,
					context.stagedFileSet,
				)
				if (!resolvedSpecifier) {
					context.issues.push(
						createIssue({
							code: "plugin_static_local_import_unresolved",
							severity: "error",
							message:
								`${entrypointRelativePath}: Cannot resolve static import "${specifier}" ` +
								`from "${toRelativeStagedPath(currentPath)}"`,
							affectedComponents: getOwnersForAbsolutePath(
								currentPath,
								context.componentOwnersByRelativePath,
							),
							affectedEntrypoints: [entrypointRelativePath],
						}),
					)
					context.entrypointsBlockedFromRuntime.add(entrypointRelativePath)
					continue
				}

				if (!visited.has(resolvedSpecifier)) {
					queue.push(resolvedSpecifier)
				}
				continue
			}

			const packageName = extractPackageNameFromImportSpecifier(specifier)
			if (!packageName) {
				continue
			}

			if (!context.externalImportsByPackage.has(packageName)) {
				context.externalImportsByPackage.set(packageName, {
					components: new Set(),
					entrypoints: new Set(),
				})
			}

			const usage = context.externalImportsByPackage.get(packageName)
			usage?.entrypoints.add(entrypointRelativePath)
			for (const owner of getOwnersForAbsolutePath(
				currentPath,
				context.componentOwnersByRelativePath,
			)) {
				usage?.components.add(owner)
			}
		}
	}
}

function parseStaticValueSpecifiers(
	filePath: string,
	content: string,
): { valueSpecifiers: string[]; parseError?: string } {
	const sourceFile = ts.createSourceFile(
		filePath,
		content,
		ts.ScriptTarget.Latest,
		true,
		getScriptKind(filePath),
	)

	const parseDiagnostics =
		(sourceFile as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ??
		[]
	if (parseDiagnostics.length > 0) {
		const firstDiagnostic = parseDiagnostics[0]
		if (firstDiagnostic) {
			return {
				valueSpecifiers: [],
				parseError: ts.flattenDiagnosticMessageText(firstDiagnostic.messageText, "\n"),
			}
		}
	}

	const valueSpecifiers: string[] = []
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			if (!hasRuntimeImportBinding(statement)) {
				continue
			}

			if (ts.isStringLiteral(statement.moduleSpecifier)) {
				valueSpecifiers.push(statement.moduleSpecifier.text)
			}
			continue
		}

		if (ts.isExportDeclaration(statement)) {
			if (!hasRuntimeReExportBinding(statement)) {
				continue
			}

			if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
				valueSpecifiers.push(statement.moduleSpecifier.text)
			}
			continue
		}

		if (ts.isImportEqualsDeclaration(statement)) {
			if ((statement as { isTypeOnly?: boolean }).isTypeOnly) {
				continue
			}

			if (ts.isExternalModuleReference(statement.moduleReference)) {
				const expression = statement.moduleReference.expression
				if (expression && ts.isStringLiteral(expression)) {
					valueSpecifiers.push(expression.text)
				}
			}
		}
	}

	return { valueSpecifiers }
}

function hasRuntimeImportBinding(importDeclaration: ts.ImportDeclaration): boolean {
	const importClause = importDeclaration.importClause
	if (!importClause) {
		return true
	}

	if (importClause.isTypeOnly) {
		return false
	}

	if (importClause.name) {
		return true
	}

	if (!importClause.namedBindings) {
		return false
	}

	if (ts.isNamespaceImport(importClause.namedBindings)) {
		return true
	}

	if (importClause.namedBindings.elements.length === 0) {
		return true
	}

	return importClause.namedBindings.elements.some((element) => !element.isTypeOnly)
}

function hasRuntimeReExportBinding(exportDeclaration: ts.ExportDeclaration): boolean {
	if (exportDeclaration.isTypeOnly) {
		return false
	}

	if (!exportDeclaration.exportClause) {
		return true
	}

	if (!ts.isNamedExports(exportDeclaration.exportClause)) {
		return true
	}

	if (exportDeclaration.exportClause.elements.length === 0) {
		return true
	}

	return exportDeclaration.exportClause.elements.some((element) => !element.isTypeOnly)
}

function getScriptKind(filePath: string): ts.ScriptKind {
	const extension = extname(filePath).toLowerCase()
	if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
		return ts.ScriptKind.JS
	}
	if (extension === ".jsx") {
		return ts.ScriptKind.JSX
	}
	if (extension === ".tsx") {
		return ts.ScriptKind.TSX
	}
	return ts.ScriptKind.TS
}

function resolveRelativeSpecifier(
	importerAbsolutePath: string,
	importSpecifier: string,
	stagedFileSet: Set<string>,
): string | null {
	const normalizedSpecifier = stripSpecifierQuery(importSpecifier)
	const candidateBasePath = resolve(dirname(importerAbsolutePath), normalizedSpecifier)
	const hasExplicitExtension = extname(normalizedSpecifier).length > 0

	if (hasExplicitExtension) {
		const explicitPath = resolve(candidateBasePath)
		return stagedFileSet.has(explicitPath) ? explicitPath : null
	}

	for (const extension of LOCAL_RESOLUTION_EXTENSIONS) {
		const candidatePath = resolve(`${candidateBasePath}${extension}`)
		if (stagedFileSet.has(candidatePath)) {
			return candidatePath
		}
	}

	for (const indexCandidate of INDEX_CANDIDATES) {
		const candidatePath = resolve(join(candidateBasePath, indexCandidate))
		if (stagedFileSet.has(candidatePath)) {
			return candidatePath
		}
	}

	return null
}

function stripSpecifierQuery(specifier: string): string {
	const queryIndex = specifier.indexOf("?")
	const hashIndex = specifier.indexOf("#")

	let endIndex = specifier.length
	if (queryIndex >= 0) {
		endIndex = Math.min(endIndex, queryIndex)
	}
	if (hashIndex >= 0) {
		endIndex = Math.min(endIndex, hashIndex)
	}

	return specifier.slice(0, endIndex)
}

function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith("./") || specifier.startsWith("../")
}

function extractPackageNameFromImportSpecifier(specifier: string): string | null {
	if (!specifier) {
		return null
	}

	const isNpmProtocolImport = specifier.startsWith("npm:")
	const normalizedSpecifier = stripSpecifierQuery(
		isNpmProtocolImport ? specifier.slice(4) : specifier,
	).trim()

	if (!normalizedSpecifier) {
		return null
	}

	if (
		normalizedSpecifier.startsWith("./") ||
		normalizedSpecifier.startsWith("../") ||
		normalizedSpecifier.startsWith("/") ||
		normalizedSpecifier.startsWith("node:") ||
		normalizedSpecifier.startsWith("bun:") ||
		normalizedSpecifier.startsWith("file:") ||
		normalizedSpecifier.startsWith("data:") ||
		normalizedSpecifier.startsWith("http:") ||
		normalizedSpecifier.startsWith("https:") ||
		normalizedSpecifier.startsWith("#")
	) {
		return null
	}

	if (isNpmProtocolImport) {
		return extractNpmProtocolPackageName(normalizedSpecifier)
	}

	if (normalizedSpecifier.startsWith("@")) {
		const segments = normalizedSpecifier.split("/")
		if (segments.length < 2) {
			return normalizedSpecifier
		}
		const packageName = `${segments[0]}/${segments[1]}`
		if (NODE_BUILTIN_PACKAGE_NAMES.has(packageName)) {
			return null
		}
		return packageName
	}

	const [packageName] = normalizedSpecifier.split("/")
	if (!packageName) {
		return null
	}

	if (NODE_BUILTIN_PACKAGE_NAMES.has(packageName)) {
		return null
	}

	return packageName ?? null
}

function extractNpmProtocolPackageName(specifier: string): string | null {
	if (specifier.startsWith("@")) {
		const segments = specifier.split("/")
		if (segments.length < 2 || !segments[0] || !segments[1]) {
			return null
		}

		const packageWithVersion = `${segments[0]}/${segments[1]}`
		return safelyParseDependencyName(packageWithVersion)
	}

	const [packageWithVersion] = specifier.split("/")
	if (!packageWithVersion) {
		return null
	}

	return safelyParseDependencyName(packageWithVersion)
}

function safelyParseDependencyName(specifier: string): string {
	try {
		return parseNpmDependencySpecifier(specifier).name
	} catch {
		return specifier
	}
}

async function writeValidationWorkspacePackageJson(
	workspaceRoot: string,
	manifestDependencies: Map<string, string>,
	manifestDevDependencies: Map<string, string>,
	packagePlugins: PackagePluginSpec[],
): Promise<void> {
	const dependencies = new Map(manifestDependencies)
	const devDependencies = new Map(manifestDevDependencies)

	for (const hostPackageName of Object.keys(HOST_RUNTIME_PACKAGES)) {
		dependencies.delete(hostPackageName)
		devDependencies.delete(hostPackageName)
	}

	for (const packagePlugin of packagePlugins) {
		if (!packagePlugin.deterministic || isHostRuntimePackage(packagePlugin.packageName)) {
			continue
		}
		dependencies.set(packagePlugin.packageName, packagePlugin.version)
	}

	const packageJson = {
		name: "ocx-plugin-validation-workspace",
		private: true,
		type: "module",
		dependencies: Object.fromEntries(dependencies),
		devDependencies: Object.fromEntries(devDependencies),
	}

	await mkdir(workspaceRoot, { recursive: true })
	await Bun.write(join(workspaceRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`)
}

function shouldHydrateManifestDependencies(
	manifestDependencies: Map<string, string>,
	manifestDevDependencies: Map<string, string>,
	packagePlugins: PackagePluginSpec[],
): boolean {
	for (const packageName of manifestDependencies.keys()) {
		if (!isHostRuntimePackage(packageName)) {
			return true
		}
	}

	for (const packageName of manifestDevDependencies.keys()) {
		if (!isHostRuntimePackage(packageName)) {
			return true
		}
	}

	for (const packagePlugin of packagePlugins) {
		if (packagePlugin.deterministic && !isHostRuntimePackage(packagePlugin.packageName)) {
			return true
		}
	}

	return false
}

async function hydrateWorkspaceDependencies(workspaceRoot: string): Promise<void> {
	const installProcess = Bun.spawn(["bun", "install", "--ignore-scripts"], {
		cwd: workspaceRoot,
		env: {
			...process.env,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	})

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(installProcess.stdout).text(),
		new Response(installProcess.stderr).text(),
		installProcess.exited,
	])

	if (exitCode === 0) {
		return
	}

	throw new PluginLoadabilityOperationalError(
		"Failed to hydrate plugin validation dependencies in isolated workspace",
		[
			`exitCode=${exitCode}`,
			...(stderr.trim() ? [stderr.trim()] : []),
			...(stdout.trim() ? [stdout.trim()] : []),
		],
	)
}

async function runRuntimeSmokeImports(
	workspaceRoot: string,
	targets: string[],
): Promise<Array<{ target: string; message: string }>> {
	if (targets.length === 0) {
		return []
	}

	const runtimeResultFilePath = join(
		workspaceRoot,
		`${RUNTIME_SMOKE_RESULT_FILE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
	)

	const runtimeScript = [
		"const targets = JSON.parse(process.env.OCX_PLUGIN_RUNTIME_TARGETS ?? '[]')",
		"const resultFilePath = process.env.OCX_PLUGIN_RUNTIME_RESULT_FILE",
		"if (!resultFilePath) {",
		"  throw new Error('Missing OCX_PLUGIN_RUNTIME_RESULT_FILE')",
		"}",
		"const failures = []",
		"for (const target of targets) {",
		"  try {",
		"    await import(target)",
		"  } catch (error) {",
		"    failures.push({",
		"      target,",
		"      message: error instanceof Error ? error.message : String(error),",
		"    })",
		"  }",
		"}",
		"await Bun.write(resultFilePath, JSON.stringify({ failures }))",
	].join("\n")

	const runtimeProcess = Bun.spawn(["bun", "--eval", runtimeScript], {
		cwd: workspaceRoot,
		env: {
			...process.env,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			OCX_PLUGIN_RUNTIME_TARGETS: JSON.stringify(targets),
			OCX_PLUGIN_RUNTIME_RESULT_FILE: runtimeResultFilePath,
		},
		stdout: "pipe",
		stderr: "pipe",
	})

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(runtimeProcess.stdout).text(),
		new Response(runtimeProcess.stderr).text(),
		runtimeProcess.exited,
	])

	try {
		if (exitCode !== 0) {
			throw new PluginLoadabilityOperationalError(
				"Failed to execute plugin runtime smoke imports in isolated workspace",
				[
					`exitCode=${exitCode}`,
					...(stderr.trim() ? [stderr.trim()] : []),
					...(stdout.trim() ? [stdout.trim()] : []),
				],
			)
		}

		const resultFile = Bun.file(runtimeResultFilePath)
		if (!(await resultFile.exists())) {
			throw new PluginLoadabilityOperationalError(
				"Plugin runtime smoke imports did not produce a result file",
				[
					`resultFile=${runtimeResultFilePath}`,
					...(stderr.trim() ? [stderr.trim()] : []),
					...(stdout.trim() ? [stdout.trim()] : []),
				],
			)
		}

		const parsedOutput = JSON.parse(await resultFile.text()) as {
			failures?: Array<{ target: string; message: string }>
		}
		return parsedOutput.failures ?? []
	} catch (error) {
		if (error instanceof PluginLoadabilityOperationalError) {
			throw error
		}

		throw new PluginLoadabilityOperationalError("Failed to parse plugin runtime smoke output", [
			`parseError=${error instanceof Error ? error.message : String(error)}`,
			`resultFile=${runtimeResultFilePath}`,
			...(stderr.trim() ? [stderr.trim()] : []),
			...(stdout.trim() ? [stdout.trim()] : []),
		])
	} finally {
		await rm(runtimeResultFilePath, { force: true }).catch(() => undefined)
	}
}

function toRelativeStagedPath(absolutePath: string): string {
	const normalized = absolutePath.replace(/\\/g, "/")
	const marker = normalized.lastIndexOf("/.opencode/")
	if (marker === -1) {
		return normalized
	}
	return normalized.slice(marker + 1)
}

function getOwnersForAbsolutePath(
	absPath: string,
	componentOwnersByRelativePath: Map<string, Set<string>>,
): string[] {
	return getOwnersForRelativePath(toRelativeStagedPath(absPath), componentOwnersByRelativePath)
}

function getOwnersForRelativePath(
	relativePath: string,
	componentOwnersByRelativePath: Map<string, Set<string>>,
): string[] {
	const owners = componentOwnersByRelativePath.get(relativePath)
	if (!owners) {
		return []
	}
	return Array.from(owners).sort()
}

function createIssue(issue: {
	code: PluginLoadabilityIssue["code"]
	severity: PluginLoadabilityIssue["severity"]
	message: string
	affectedComponents: string[]
	affectedEntrypoints: string[]
}): PluginLoadabilityIssue {
	return {
		kind: "plugin_loadability",
		code: issue.code,
		severity: issue.severity,
		message: issue.message,
		rendered: `Plugin loadability: ${issue.message}`,
		affectedComponents: issue.affectedComponents,
		affectedEntrypoints: issue.affectedEntrypoints,
	}
}
