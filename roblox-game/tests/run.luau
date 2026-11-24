--[[
	Test runner.  Usage (from anywhere):  lune run <project>/tests/run.luau [filter ...]

	Discovers every `*.spec.luau` under tests/unit and tests/smoke. A spec file runs INSIDE the headless Roblox
	environment (see harness/Env.luau) — it can use `game`, `require(ModuleScript)`, `task`, datatypes … exactly
	like game code — and must return `function(t)`.  Test API:

		t.test(name, fn)            register a test (fn may yield)
		t.equal(actual, expected, message?)       deep equality for tables
		t.near(actual, expected, epsilon?, message?)
		t.truthy(value, message?) / t.falsy(value, message?)
		t.throws(fn, message?)      fn must error
		t.fail(message)
		t.env                       the Env object (t.env.game, t.env:runScript(...), mocks when installed)

	Each spec file gets a fresh environment. Exit code 1 when any test fails.
]]
local fs = require("@lune/fs")
local process = require("@lune/process")
local stdio = require("@lune/stdio")
local task = require("@lune/task")

-- Locate the project root from this file's location: <root>/tests/run.luau
local scriptPath = debug.info(1, "s")
local testsDir = string.match(scriptPath, '^%[string "(.*)/run"%]$')
	or string.match(scriptPath, "^(.*)/run%.luau$")
	or string.match(scriptPath, "^(.*)/run$")
if not testsDir then
	testsDir = process.cwd .. "tests"
end
if string.sub(testsDir, 1, 1) ~= "/" then
	testsDir = process.cwd .. testsDir
end
local projectRoot = string.gsub(testsDir, "/tests/?$", "")

local Env = require("./harness/Env")

local filters = process.args

local function matchesFilter(path: string): boolean
	if #filters == 0 then
		return true
	end
	for _, filter in filters do
		if string.find(path, filter, 1, true) then
			return true
		end
	end
	return false
end

local function collect(dir: string, out: { string })
	if not fs.isDir(dir) then
		return
	end
	local entries = fs.readDir(dir)
	table.sort(entries)
	for _, entry in entries do
		local full = dir .. "/" .. entry
		if fs.isDir(full) then
			collect(full, out)
		elseif string.sub(entry, -10) == ".spec.luau" then
			table.insert(out, full)
		end
	end
end

local function deepEqual(a: any, b: any): boolean
	if a == b then
		return true
	end
	if type(a) ~= "table" or type(b) ~= "table" then
		return false
	end
	for k, v in a do
		if not deepEqual(v, b[k]) then
			return false
		end
	end
	for k in b do
		if a[k] == nil then
			return false
		end
	end
	return true
end

local function show(value: any, depth: number?): string
	local d = depth or 0
	if type(value) == "table" then
		if d > 2 then
			return "{...}"
		end
		local parts = {}
		local n = 0
		for k, v in value do
			n += 1
			if n > 12 then
				table.insert(parts, "...")
				break
			end
			table.insert(parts, tostring(k) .. "=" .. show(v, d + 1))
		end
		return "{" .. table.concat(parts, ", ") .. "}"
	elseif type(value) == "string" then
		return string.format("%q", value)
	end
	return tostring(value)
end

local specFiles = {}
collect(testsDir .. "/unit", specFiles)
collect(testsDir .. "/smoke", specFiles)

local totalPassed, totalFailed = 0, 0
local failures = {}
local TEST_TIMEOUT = 30

for _, specPath in specFiles do
	local relative = string.sub(specPath, #projectRoot + 2)
	if not matchesFilter(relative) then
		continue
	end
	local tests = {}
	local t = {}
	function t.test(name: string, fn: () -> ())
		table.insert(tests, { name = name, fn = fn })
	end
	function t.fail(message: string)
		error(message, 2)
	end
	function t.equal(actual: any, expected: any, message: string?)
		if not deepEqual(actual, expected) then
			error(`{message or "values differ"}: expected {show(expected)}, got {show(actual)}`, 2)
		end
	end
	function t.near(actual: number, expected: number, epsilon: number?, message: string?)
		local eps = epsilon or 1e-6
		if type(actual) ~= "number" or math.abs(actual - expected) > eps then
			error(`{message or "not close"}: expected {expected} ± {eps}, got {tostring(actual)}`, 2)
		end
	end
	function t.truthy(value: any, message: string?)
		if not value then
			error(message or `expected a truthy value, got {tostring(value)}`, 2)
		end
	end
	function t.falsy(value: any, message: string?)
		if value then
			error(message or `expected a falsy value, got {show(value)}`, 2)
		end
	end
	function t.throws(fn: () -> (), message: string?)
		local ok = pcall(fn)
		if ok then
			error(message or "expected the function to throw", 2)
		end
	end

	local okEnv, envOrError = pcall(Env.new, projectRoot)
	if not okEnv then
		totalFailed += 1
		table.insert(failures, `{relative}: could not create environment: {tostring(envOrError)}`)
		continue
	end
	local env = envOrError
	t.env = env

	local okLoad, loadError = pcall(function()
		local chunk = env:loadString(fs.readFile(specPath), relative)
		local register = chunk()
		assert(type(register) == "function", "spec file must return function(t)")
		register(t)
	end)
	if not okLoad then
		totalFailed += 1
		table.insert(failures, `{relative}: failed to load: {tostring(loadError)}`)
		env:destroy()
		continue
	end

	local passed, failed = 0, 0
	for _, case in tests do
		local done, ok, err = false, false, nil
		local thread = task.spawn(function()
			ok, err = xpcall(case.fn, function(e)
				return tostring(e) .. "\n" .. debug.traceback()
			end)
			done = true
		end)
		local started = os.clock()
		while not done and os.clock() - started < TEST_TIMEOUT do
			task.wait(0.01)
		end
		if not done then
			pcall(task.cancel, thread)
			ok, err = false, `timed out after {TEST_TIMEOUT}s`
		end
		if ok then
			passed += 1
		else
			failed += 1
			table.insert(failures, `{relative} › {case.name}\n    {string.gsub(tostring(err), "\n", "\n    ")}`)
		end
	end
	env:destroy()
	totalPassed += passed
	totalFailed += failed
	local mark = if failed == 0 then "ok  " else "FAIL"
	stdio.write(`{mark} {relative}  ({passed} passed, {failed} failed)\n`)
end

if #failures > 0 then
	stdio.write("\nFailures:\n")
	for _, failure in failures do
		stdio.write("  ✗ " .. failure .. "\n")
	end
end
stdio.write(`\n{totalPassed} passed, {totalFailed} failed\n`)
process.exit(if totalFailed > 0 then 1 else 0)
