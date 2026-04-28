#!/usr/bin/env -S bun --no-env-file

import { handleError } from "../utils/handle-error"
import { runCli } from "./bootstrap"

try {
	await runCli(process.argv)
} catch (error) {
	handleError(error)
}
