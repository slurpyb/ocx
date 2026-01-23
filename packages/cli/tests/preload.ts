import os from "os"
import path from "path"
import fs from "fs/promises"
import fsSync from "fs"
import { afterAll } from "bun:test"

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
