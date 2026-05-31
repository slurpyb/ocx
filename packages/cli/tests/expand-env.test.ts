import { expect, test } from "bun:test"
import { expandEnvVars } from "../src/utils/expand-env"

// Build the placeholder by concatenation so the literal "${" sequence never
// appears in this source (which biome's noTemplateCurlyInString rule forbids).
// ref("FOO") returns the string "${FOO}", exactly as a registry config holds it.
const ref = (name: string): string => `$\{${name}}`

test("expands a placeholder from process.env", () => {
	process.env.OCX_TEST_TOKEN = "secret-123"
	const out = expandEnvVars({ "CF-Access-Client-Id": ref("OCX_TEST_TOKEN") })
	expect(out).toEqual({ "CF-Access-Client-Id": "secret-123" })
	delete process.env.OCX_TEST_TOKEN
})

test("expands multiple references within one value", () => {
	process.env.OCX_A = "a"
	process.env.OCX_B = "b"
	expect(expandEnvVars({ Combo: `${ref("OCX_A")}-${ref("OCX_B")}` })).toEqual({ Combo: "a-b" })
	delete process.env.OCX_A
	delete process.env.OCX_B
})

test("passes through values without placeholders", () => {
	expect(expandEnvVars({ "X-Plain": "literal" })).toEqual({ "X-Plain": "literal" })
})

test("returns an empty object unchanged", () => {
	expect(expandEnvVars({})).toEqual({})
})

test("throws a clear error when a referenced env var is unset", () => {
	delete process.env.OCX_DEFINITELY_UNSET
	expect(() => expandEnvVars({ Authorization: ref("OCX_DEFINITELY_UNSET") })).toThrow(
		/OCX_DEFINITELY_UNSET/,
	)
})
