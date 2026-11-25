--[[
	TweenService and Debris.

	Tweens really interpolate: while a tween plays, its goal properties are updated every scheduler frame with the
	requested easing style/direction (so Changed listeners and count-up animations see intermediate values), and
	Completed fires when the virtual time is up. DelayTime, RepeatCount (-1 = forever) and Reverses are honoured.
	Fast-forwarding with env.mocks.advance finishes tweens instantly.
	Numbers, Vector2/3, Color3, UDim, UDim2 and CFrame are interpolated; other types switch to the goal at the end.
]]
return function(H)
	local sched = H.sched
	local roblox = H.roblox
	local Enum = roblox.Enum

	--------------------------------------------------------------------------------------------------------------
	-- easing
	--------------------------------------------------------------------------------------------------------------
	local function bounceOut(t: number): number
		if t < 1 / 2.75 then
			return 7.5625 * t * t
		elseif t < 2 / 2.75 then
			t -= 1.5 / 2.75
			return 7.5625 * t * t + 0.75
		elseif t < 2.5 / 2.75 then
			t -= 2.25 / 2.75
			return 7.5625 * t * t + 0.9375
		end
		t -= 2.625 / 2.75
		return 7.5625 * t * t + 0.984375
	end

	-- "in" curves f(t) on [0, 1]; Out and InOut are derived from them
	local easeIn: { [string]: (number) -> number } = {
		Linear = function(t)
			return t
		end,
		Quad = function(t)
			return t * t
		end,
		Cubic = function(t)
			return t * t * t
		end,
		Quart = function(t)
			return t * t * t * t
		end,
		Quint = function(t)
			return t * t * t * t * t
		end,
		Sine = function(t)
			return 1 - math.cos(t * math.pi / 2)
		end,
		Exponential = function(t)
			return if t == 0 then 0 else 2 ^ (10 * (t - 1))
		end,
		Circular = function(t)
			return 1 - math.sqrt(1 - t * t)
		end,
		Back = function(t)
			local s = 1.70158
			return t * t * ((s + 1) * t - s)
		end,
		Elastic = function(t)
			if t == 0 or t == 1 then
				return t
			end
			return -(2 ^ (10 * (t - 1))) * math.sin((t - 1.075) * (2 * math.pi) / 0.3)
		end,
		Bounce = function(t)
			return 1 - bounceOut(1 - t)
		end,
	}

	local function ease(alpha: number, style: any, direction: any): number
		local curve = easeIn[style.Name] or easeIn.Linear
		local name = direction.Name
		if name == "In" then
			return curve(alpha)
		elseif name == "Out" then
			return 1 - curve(1 - alpha)
		elseif alpha < 0.5 then
			return curve(alpha * 2) / 2
		end
		return 1 - curve((1 - alpha) * 2) / 2
	end

	local function lerp(from: any, to: any, alpha: number): any
		local kind = typeof(from)
		if kind == "number" then
			return from + (to - from) * alpha
		elseif kind == "Vector3" or kind == "Vector2" or kind == "Color3" or kind == "UDim2" or kind == "CFrame" then
			return from:Lerp(to, alpha)
		elseif kind == "UDim" then
			return roblox.UDim.new(from.Scale + (to.Scale - from.Scale) * alpha, math.round(from.Offset + (to.Offset - from.Offset) * alpha))
		end
		return if alpha >= 1 then to else from
	end

	--------------------------------------------------------------------------------------------------------------
	-- tweens
	--------------------------------------------------------------------------------------------------------------
	local TweenService = H.class("TweenService")
	local TweenBase = H.class("TweenBase")
	local active: { any } = {} -- playing tweens

	TweenBase.props.PlaybackState = {
		get = function(self)
			return H.state(self).playback or Enum.PlaybackState.Begin
		end,
	}

	local function setPlayback(tween: any, playback: any)
		local state = H.state(tween)
		if state.playback ~= playback then
			state.playback = playback
			H.notify(tween, "PlaybackState")
		end
	end

	local function deactivate(tween: any)
		local position = table.find(active, tween)
		if position then
			table.remove(active, position)
		end
	end

	local function apply(tween: any, alpha: number)
		local state = H.state(tween)
		local target = state.instance
		for property, goal in state.goals do
			local ok, err = pcall(function()
				target[property] = lerp(state.start[property], goal, alpha)
			end)
			if not ok then
				H.reportError(err, `Tween on {target:GetFullName()}.{property}`)
			end
		end
	end

	local function finish(tween: any, playback: any)
		deactivate(tween)
		setPlayback(tween, playback)
		H.fireExisting(tween, "Completed", playback)
	end

	local function update(tween: any, dt: number)
		local state = H.state(tween)
		local info = state.info
		if H.isDestroyed(state.instance) then
			deactivate(tween)
			setPlayback(tween, Enum.PlaybackState.Cancelled)
			return
		end
		state.elapsed += dt
		local t = state.elapsed - info.DelayTime
		if t < 0 then
			setPlayback(tween, Enum.PlaybackState.Delayed)
			return
		end
		if not state.start then
			state.start = {}
			for property in state.goals do
				state.start[property] = state.instance[property]
			end
		end
		setPlayback(tween, Enum.PlaybackState.Playing)
		local duration = math.max(info.Time, 0)
		local cycle = duration * (if info.Reverses then 2 else 1)
		local cycles = if info.RepeatCount < 0 then math.huge else info.RepeatCount + 1
		if duration <= 0 or t >= cycle * cycles then
			apply(tween, if info.Reverses then 0 else 1)
			finish(tween, Enum.PlaybackState.Completed)
			return
		end
		local alpha = (t % cycle) / duration
		if alpha > 1 then
			alpha = 2 - alpha
		end
		apply(tween, ease(alpha, info.EasingStyle, info.EasingDirection))
	end

	sched.onStep(200, function(dt: number)
		if #active > 0 then
			for _, tween in table.clone(active) do
				if table.find(active, tween) then
					update(tween, dt)
				end
			end
		end
	end)

	function TweenService.methods.Create(_self: any, instance: any, tweenInfo: any, goals: any): any
		if not H.isInstance(instance) then
			error(`TweenService:Create: argument 1 must be an Instance, got {H.typeof(instance)}`, 2)
		end
		if H.typeof(tweenInfo) ~= "TweenInfo" then
			error(`TweenService:Create: argument 2 must be a TweenInfo, got {H.typeof(tweenInfo)}`, 2)
		end
		if type(goals) ~= "table" then
			error(`TweenService:Create: argument 3 must be a table of property goals, got {H.typeof(goals)}`, 2)
		end
		local copied = {}
		for property, goal in goals do
			local ok, current = pcall(function()
				return instance[property]
			end)
			if not ok or type(property) ~= "string" or H.typeof(current) == "RBXScriptSignal" or type(current) == "function" then
				error(`TweenService:Create no property named '{tostring(property)}' for object '{instance.Name}'`, 2)
			end
			if typeof(current) ~= typeof(goal) then
				error(
					`TweenService:Create property named '{property}' cannot be tweened due to type mismatch (property is a '{H.typeof(current)}', but given type is '{H.typeof(goal)}')`,
					2
				)
			end
			copied[property] = goal
		end
		local tween = H.create("Tween")
		H.rawset(tween, "Instance", instance)
		H.rawset(tween, "TweenInfo", tweenInfo)
		local state = H.state(tween)
		state.instance = instance
		state.info = tweenInfo
		state.goals = copied
		state.elapsed = 0
		return tween
	end

	function TweenService.methods.GetValue(_self: any, alpha: number, style: any, direction: any): number
		return ease(math.clamp(alpha, 0, 1), style, direction)
	end

	function TweenBase.methods.Play(self: any)
		local state = H.state(self)
		if not state.info then
			error("Play: this tween was not created by TweenService:Create", 2)
		end
		if H.isDestroyed(self) or table.find(active, self) then
			return
		end
		if state.playback ~= Enum.PlaybackState.Paused then
			-- (re)start from the current property values
			state.elapsed = 0
			state.start = nil
		end
		table.insert(active, self)
		setPlayback(self, if state.info.DelayTime > 0 then Enum.PlaybackState.Delayed else Enum.PlaybackState.Playing)
	end

	function TweenBase.methods.Pause(self: any)
		if table.find(active, self) then
			deactivate(self)
			setPlayback(self, Enum.PlaybackState.Paused)
		end
	end

	function TweenBase.methods.Cancel(self: any)
		local state = H.state(self)
		if table.find(active, self) or state.playback == Enum.PlaybackState.Paused then
			finish(self, Enum.PlaybackState.Cancelled)
		end
		state.elapsed = 0
		state.start = nil
	end

	TweenBase.destroyed = function(self)
		deactivate(self)
	end

	--------------------------------------------------------------------------------------------------------------
	-- Debris
	--------------------------------------------------------------------------------------------------------------
	local Debris = H.class("Debris")
	function Debris.methods.AddItem(_self: any, item: any, lifetime: number?)
		if not H.isInstance(item) then
			error(`Debris:AddItem: Instance expected, got {H.typeof(item)}`, 2)
		end
		if lifetime ~= nil and type(lifetime) ~= "number" then
			error(`Debris:AddItem: lifetime must be a number, got {H.typeof(lifetime)}`, 2)
		end
		sched.delay(lifetime or 10, function()
			if not H.isDestroyed(item) then
				item:Destroy()
			end
		end)
	end

	return nil
end
