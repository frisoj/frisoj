--[[
	RunService and the DataModel's own members.

	RunService: IsServer/IsClient/IsStudio..., frame events driven by the scheduler (render phase: BindToRenderStep
	callbacks in priority order, PreRender, RenderStepped; simulation phase: PreAnimation, PreSimulation, Stepped;
	after task.wait timers: PostSimulation, Heartbeat). RenderStepped/PreRender/BindToRenderStep refuse the server.

	DataModel: GetService/FindService, PlaceId/GameId/JobId/CreatorId (config), IsLoaded/Loaded, BindToClose
	(callbacks run by env.mocks.shutdown()).
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local Instances = H.instances
	local Enum = H.roblox.Enum
	local mocks = H.mocks

	config.isStudio = true -- RunService:IsStudio()
	config.placeId = 1001 -- non-zero like a published place; set 0 to simulate an unpublished one
	config.gameId = 2002
	config.jobId = "harness-job-0001"
	config.creatorId = 3003
	config.creatorType = Enum.CreatorType.User
	config.placeVersion = 1
	config.privateServerId = ""
	config.privateServerOwnerId = 0

	--------------------------------------------------------------------------------------------------------------
	-- RunService
	--------------------------------------------------------------------------------------------------------------
	local RunService = H.class("RunService")
	local renderBindings: { any } = {}

	function RunService.methods.IsServer(self: any): boolean
		return H.sideOf(self) == "server"
	end
	function RunService.methods.IsClient(self: any): boolean
		return H.sideOf(self) == "client"
	end
	function RunService.methods.IsStudio(_self: any): boolean
		return config.isStudio
	end
	function RunService.methods.IsRunning(_self: any): boolean
		return true
	end
	function RunService.methods.IsRunMode(_self: any): boolean
		return false
	end
	function RunService.methods.IsEdit(_self: any): boolean
		return false
	end

	local function clientOnlyEvent(name: string)
		RunService.props[name] = {
			get = function(self)
				if H.sideOf(self) ~= "client" then
					error(`{name} event can only be used from local scripts`, 3)
				end
				return H.signalOf(self, name)
			end,
		}
	end
	clientOnlyEvent("RenderStepped")
	clientOnlyEvent("PreRender")

	function RunService.methods.BindToRenderStep(self: any, name: string, priority: number, fn: (number) -> ())
		if H.sideOf(self) ~= "client" then
			error("RunService:BindToRenderStep can only be called from the client", 2)
		end
		if type(name) ~= "string" or type(priority) ~= "number" or type(fn) ~= "function" then
			error("RunService:BindToRenderStep expects (name: string, priority: number, function)", 2)
		end
		table.insert(renderBindings, { name = name, priority = priority, fn = fn, order = #renderBindings })
		table.sort(renderBindings, function(a, b)
			if a.priority == b.priority then
				return a.order < b.order
			end
			return a.priority < b.priority
		end)
	end

	function RunService.methods.UnbindFromRenderStep(_self: any, name: string)
		for position = #renderBindings, 1, -1 do
			if renderBindings[position].name == name then
				table.remove(renderBindings, position)
			end
		end
	end

	H.class("RunService").defaults.FrameNumber = 0

	local runService: any = nil
	sched.onStep(100, function(dt: number)
		if #renderBindings > 0 then
			for _, binding in table.clone(renderBindings) do
				sched.spawn(binding.fn, dt)
			end
		end
		H.fireExisting(runService, "PreRender", dt)
		H.fireExisting(runService, "RenderStepped", dt)
	end)
	sched.onStep(300, function(dt: number)
		H.fireExisting(runService, "PreAnimation", dt)
		H.fireExisting(runService, "PreSimulation", dt)
		H.fireExisting(runService, "Stepped", sched.frameTime(), dt)
	end)
	sched.onStep(500, function(dt: number)
		H.fireExisting(runService, "PostSimulation", dt)
		H.fireExisting(runService, "Heartbeat", dt)
	end)

	--------------------------------------------------------------------------------------------------------------
	-- DataModel
	--------------------------------------------------------------------------------------------------------------
	local DataModel = H.class("DataModel")
	local closeCallbacks: { () -> () } = {}

	function DataModel.methods.GetService(self: any, className: string): any
		return Instances.viewFor(Instances.getService(className, true), H.sideOf(self))
	end

	function DataModel.methods.FindService(self: any, className: string): any
		local service = Instances.getService(className, false)
		return service and Instances.viewFor(service, H.sideOf(self))
	end

	function DataModel.methods.IsLoaded(_self: any): boolean
		return true
	end

	function DataModel.signals.Loaded(_self: any)
		return { buffer = true }
	end

	function DataModel.methods.BindToClose(self: any, fn: () -> ())
		if H.sideOf(self) ~= "server" then
			error("BindToClose can only be called on the server", 2)
		end
		if type(fn) ~= "function" then
			error("BindToClose expects a function", 2)
		end
		table.insert(closeCallbacks, fn)
	end

	local function configProp(property: string, key: string)
		DataModel.props[property] = {
			get = function()
				return config[key]
			end,
		}
	end
	configProp("PlaceId", "placeId")
	configProp("GameId", "gameId")
	configProp("JobId", "jobId")
	configProp("CreatorId", "creatorId")
	configProp("CreatorType", "creatorType")
	configProp("PlaceVersion", "placeVersion")
	configProp("PrivateServerId", "privateServerId")
	configProp("PrivateServerOwnerId", "privateServerOwnerId")
	DataModel.props.Workspace = {
		get = function()
			return H.workspace
		end,
	}

	table.insert(H.bootHooks, function()
		runService = Instances.getService("RunService", true)
		H.fire(H.game, "Loaded") -- buffered: whoever waits for game.Loaded first gets it immediately
	end)

	-- test API -----------------------------------------------------------------------------------------------------

	-- shutdown(timeout?): simulate the server closing: run every game:BindToClose callback in parallel and wait
	-- (virtual time) until all returned, like Roblox does for up to 30 s. Returns true when all finished in time.
	function mocks.shutdown(timeout: number?): boolean
		local pending = #closeCallbacks
		for _, callback in closeCallbacks do
			sched.spawn(function()
				local ok, err = pcall(callback, Enum.CloseReason.Unknown)
				if not ok then
					H.reportError(err, "BindToClose callback")
				end
				pending -= 1
			end)
		end
		return sched.waitFor(function()
			return pending == 0
		end, timeout or 30) == true
	end

	return nil
end
