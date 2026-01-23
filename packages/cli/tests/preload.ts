import { afterAll } from "bun:test"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const dir = path.join(os.tmpdir(), "ocx-test-data-" + process.pid)
await fs.mkdir(dir, { recursive: true })

afterAll(() => {
	fsSync.rmSync(dir, { recursive: true, force: true })
})

// Set test home directory
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["HOME"] = testHome

// Set XDG directories for complete isolation
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
