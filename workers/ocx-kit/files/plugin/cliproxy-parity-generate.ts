import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildCliproxyParityOracle } from "./cliproxy-parity-oracle"

const generated = buildCliproxyParityOracle()

// Manual-reviewed workflow:
// 1) Generate cliproxy.parity.generated.json
// 2) Review diff against cliproxy.parity.goldens.json
// 3) Copy into goldens only after explicit reviewer approval
const outputPath = path.join(import.meta.dir, "cliproxy.parity.generated.json")
writeFileSync(outputPath, `${JSON.stringify(generated, null, "\t")}\n`)
console.log(`[cliproxy] parity artifact generated at ${outputPath}`)
