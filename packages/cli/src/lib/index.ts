/**
 * OCX Library Exports
 *
 * Pure functions for programmatic use.
 */

export { ValidationFailedError } from "../utils/errors"
export {
	BuildRegistryError,
	type BuildRegistryOptions,
	type BuildRegistryResult,
	buildRegistry,
} from "./build-registry"
