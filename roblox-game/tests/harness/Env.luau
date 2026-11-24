--[[
	Headless Roblox environment for running the game's Luau code under Lune (https://lune-org.github.io/docs).

	Env.new() builds a fresh DataModel from ../default.project.json (same mapping Rojo uses) using Lune's
	built-in `roblox` library, which gives real Instances with validated properties and real datatypes.
	Scripts are executed with an environment that provides the Roblox globals (`game`, `script`, `require`,
	`task`, `Instance`, `Enum`, datatypes ...). `require(ModuleScript)` works like in Roblox (cached per Env).

	Anything Lune does not provide (events, WaitForChild, services' methods, Random, TweenInfo ...) is supplied by
	harness/Mocks.luau, which Env loads when present.
]]
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")
local roblox = require("@lune/roblox")
local serde = require("@lune/serde")
local task = require("@lune/task")

local Env = {}
Env.__index = Env

local HARNESS_DIR = (function()
	-- tests/harness/ relative to the cwd-independent project root passed in by run.luau
	return nil
end)()

export type ScriptInfo = { path: string, source: string, kind: "Module" | "Server" | "Client" }

local function readJson(path: string): any
	return serde.decode("json", fs.readFile(path))
end

local function stripSuffix(name: string, suffix: string): string?
	if #name > #suffix and string.sub(name, -#suffix) == suffix then
		return string.sub(name, 1, -#suffix - 1)
	end
	return nil
end

-- Maps a file name to (instanceName, className) following Rojo's conventions. Returns nil for non-script files.
local function classify(fileName: string): (string?, string?)
	for _, ext in { ".luau", ".lua" } do
		local base = stripSuffix(fileName, ".server" .. ext)
		if base then
			return base, "Script"
		end
		base = stripSuffix(fileName, ".client" .. ext)
		if base then
			return base, "LocalScript"
		end
		base = stripSuffix(fileName, ext)
		if base then
			return base, "ModuleScript"
		end
	end
	return nil, nil
end

function Env.new(projectRoot: string, options: { [string]: any }?)
	local self = setmetatable({}, Env)
	self.projectRoot = projectRoot
	self.options = options or {}
	self.game = roblox.Instance.new("DataModel")
	self.scripts = {} :: { [any]: ScriptInfo } -- Instance -> info
	self.moduleCache = {} :: { [any]: { loaded: boolean, value: any, loading: boolean } }
	self.globals = {} :: { [string]: any } -- extra globals injected into every script environment
	self.cleanups = {} :: { () -> () }
	self.errors = {} :: { string } -- errors raised inside spawned threads / signal handlers (filled by Mocks)

	local project = readJson(projectRoot .. "/default.project.json")
	self:_buildNode(self.game, project.tree, true)

	local mocksPath = projectRoot .. "/tests/harness/Mocks.luau"
	if fs.isFile(mocksPath) then
		local chunk = luau.load(fs.readFile(mocksPath), { debugName = "tests/harness/Mocks" })
		local Mocks = chunk()
		Mocks.install(self)
	else
		self:_installMinimalGlobals()
	end
	return self
end

function Env:_newScript(className: string, name: string, path: string): any
	local inst = roblox.Instance.new(className)
	inst.Name = name
	local kind = if className == "ModuleScript" then "Module" elseif className == "Script" then "Server" else "Client"
	self.scripts[inst] = { path = path, source = fs.readFile(path), kind = kind }
	return inst
end

function Env:_buildDir(dirPath: string, name: string, forcedClass: string?, existing: any?): any
	local entries = fs.readDir(dirPath)
	table.sort(entries)
	local container = existing
	if not container then
		-- a directory with an init file becomes that script
		for _, entry in entries do
			local base, className = classify(entry)
			if base == "init" and className then
				container = self:_newScript(className, name, dirPath .. "/" .. entry)
				break
			end
		end
		if not container then
			container = roblox.Instance.new(forcedClass or "Folder")
			container.Name = name
		end
	end
	for _, entry in entries do
		local full = dirPath .. "/" .. entry
		if fs.isDir(full) then
			local child = self:_buildDir(full, entry, nil, nil)
			child.Parent = container
		else
			local base, className = classify(entry)
			if base and className and base ~= "init" then
				local child = self:_newScript(className, base, full)
				child.Parent = container
			end
		end
	end
	return container
end

function Env:_buildNode(inst: any, node: any, isRoot: boolean)
	if node["$properties"] then
		for key, value in node["$properties"] do
			-- best effort: only simple scalar properties are applied; enums given as names are skipped
			pcall(function()
				inst[key] = value
			end)
		end
	end
	if node["$path"] then
		self:_buildDir(self.projectRoot .. "/" .. node["$path"], inst.Name, nil, inst)
	end
	for key, child in node do
		if string.sub(key, 1, 1) ~= "$" then
			local childInst
			if child["$className"] then
				local ok, service = pcall(function()
					return if isRoot then self.game:GetService(child["$className"]) else nil
				end)
				if ok and service then
					childInst = service
				else
					childInst = inst:FindFirstChild(key)
					if not childInst then
						childInst = roblox.Instance.new(child["$className"])
						childInst.Name = key
						childInst.Parent = inst
					end
				end
				self:_buildNode(childInst, child, false)
			elseif child["$path"] then
				local full = self.projectRoot .. "/" .. child["$path"]
				if fs.isDir(full) then
					childInst = self:_buildDir(full, key, nil, nil)
				else
					local _, className = classify(child["$path"])
					childInst = self:_newScript(className or "ModuleScript", key, full)
				end
				childInst.Parent = inst
				-- nested non-$ keys under a $path node are not used by this project
			end
		end
	end
end

function Env:_installMinimalGlobals()
	-- Used only when Mocks.luau is missing: enough for pure Shared modules.
	roblox.implementMethod("Instance", "WaitForChild", function(inst: any, name: string)
		local child = inst:FindFirstChild(name)
		if not child then
			error(`WaitForChild: "{name}" not found in {inst:GetFullName()}`, 2)
		end
		return child
	end)
	local g = self.globals
	g.game = self.game
	g.workspace = self.game:GetService("Workspace")
	g.task = task
	g.Instance = roblox.Instance
	g.Enum = roblox.Enum
	for _, name in
		{
			"Vector3", "Vector2", "CFrame", "Color3", "UDim", "UDim2", "NumberSequence", "NumberSequenceKeypoint",
			"ColorSequence", "ColorSequenceKeypoint", "NumberRange", "Rect", "Ray", "BrickColor", "Font",
			"PhysicalProperties", "Region3", "Vector3int16", "Vector2int16", "Axes", "Faces",
		}
	do
		g[name] = (roblox :: any)[name]
	end
	g.tick = os.clock
	g.time = os.clock
	g.warn = function(...)
		print("[warn]", ...)
	end
end

-- Builds the global environment table for one script.
function Env:makeEnvironment(scriptInstance: any?): { [string]: any }
	local env = {}
	for key, value in self.globals do
		env[key] = value
	end
	env.script = scriptInstance
	env.require = function(target: any)
		return self:require(target)
	end
	return env
end

function Env:require(target: any): any
	if typeof(target) ~= "Instance" then
		error("require: expected a ModuleScript Instance, got " .. typeof(target), 2)
	end
	local info = self.scripts[target]
	if not info or info.kind ~= "Module" then
		error("require: " .. target:GetFullName() .. " is not a ModuleScript", 2)
	end
	local entry = self.moduleCache[target]
	if entry then
		if entry.loading then
			error("require: cyclic require detected at " .. target:GetFullName(), 2)
		end
		return entry.value
	end
	entry = { loaded = false, loading = true, value = nil }
	self.moduleCache[target] = entry
	local chunk = luau.load(info.source, {
		debugName = info.path,
		environment = self:makeEnvironment(target),
	})
	local value = chunk()
	entry.value = value
	entry.loading = false
	entry.loaded = true
	return value
end

-- Runs a Script/LocalScript instance (returns immediately if it yields).
function Env:runScript(scriptInstance: any)
	local info = self.scripts[scriptInstance]
	assert(info, "runScript: unknown script")
	local chunk = luau.load(info.source, {
		debugName = info.path,
		environment = self:makeEnvironment(scriptInstance),
	})
	return task.spawn(chunk)
end

-- Loads an arbitrary source string (used for spec files) inside this environment.
function Env:loadString(source: string, debugName: string): () -> ...any
	return luau.load(source, { debugName = debugName, environment = self:makeEnvironment(nil) })
end

function Env:findFirstScript(className: string, parent: any): any?
	for _, child in parent:GetDescendants() do
		if child.ClassName == className then
			return child
		end
	end
	return nil
end

function Env:destroy()
	for _, fn in self.cleanups do
		pcall(fn)
	end
	table.clear(self.cleanups)
end

Env.process = process

return Env
