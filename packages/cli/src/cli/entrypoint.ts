import { handleError } from "../utils/handle-error"
import { runCli } from "./bootstrap"

export async function runCliEntryPoint(argv: string[] = process.argv): Promise<void> {
	try {
		await runCli(argv)
	} catch (error) {
		handleError(error)
	}
}
