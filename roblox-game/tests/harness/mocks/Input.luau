--[[
	Player input: UserInputService, ContextActionService, ProximityPrompt(Service), haptics.

	Devices are configured with env.mocks.config.input ({ touch, keyboard, mouse, gamepad }); tests generate input
	with env.mocks.input(Enum.KeyCode.E) / inputBegan / inputEnded (also accepts Enum.UserInputType values such as
	MouseButton1 or Touch), env.mocks.triggerAction(name) and env.mocks.triggerPrompt(prompt, player).
	Input first goes to ContextActionService bindings (highest priority first, a handler returning
	Enum.ContextActionResult.Pass lets it continue), then to UserInputService.InputBegan/InputEnded with
	gameProcessedEvent = true when an action sank it or options.gameProcessed was set.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Vector2, Vector3 = roblox.Vector2, roblox.Vector3
	local Instances = H.instances

	config.input = { touch = false, keyboard = true, mouse = true, gamepad = false, vr = false }

	local userInputService: any = nil
	local function inputService(): any
		if not userInputService then
			userInputService = Instances.getService("UserInputService", true)
		end
		return userInputService
	end

	local keysDown: { [any]: boolean } = {} -- KeyCode / UserInputType items currently held
	local lastInputType: any = nil

	--------------------------------------------------------------------------------------------------------------
	-- UserInputService
	--------------------------------------------------------------------------------------------------------------
	local UserInputService = H.class("UserInputService")
	local function deviceProp(property: string, key: string)
		UserInputService.props[property] = {
			get = function()
				return config.input[key] == true
			end,
		}
	end
	deviceProp("TouchEnabled", "touch")
	deviceProp("KeyboardEnabled", "keyboard")
	deviceProp("MouseEnabled", "mouse")
	deviceProp("GamepadEnabled", "gamepad")
	deviceProp("VREnabled", "vr")
	UserInputService.defaults.AccelerometerEnabled = false
	UserInputService.defaults.GyroscopeEnabled = false
	UserInputService.defaults.OnScreenKeyboardVisible = false
	UserInputService.defaults.OnScreenKeyboardPosition = Vector2.zero
	UserInputService.defaults.OnScreenKeyboardSize = Vector2.zero
	UserInputService.defaults.MouseIconEnabled = true
	UserInputService.defaults.MouseDeltaSensitivity = 1
	UserInputService.props.PreferredInput = {
		get = function()
			local input = config.input
			if input.touch and not input.keyboard then
				return Enum.PreferredInput.Touch
			elseif input.gamepad and not input.keyboard then
				return Enum.PreferredInput.Gamepad
			end
			return Enum.PreferredInput.KeyboardAndMouse
		end,
	}

	function UserInputService.methods.GetMouseLocation(_self: any): any
		return Vector2.new(H.mouseState.X, H.mouseState.Y)
	end
	function UserInputService.methods.GetMouseDelta(_self: any): any
		return Vector2.zero
	end
	function UserInputService.methods.IsKeyDown(_self: any, keyCode: any): boolean
		return keysDown[keyCode] == true
	end
	function UserInputService.methods.IsMouseButtonPressed(_self: any, button: any): boolean
		return keysDown[button] == true
	end
	function UserInputService.methods.IsGamepadButtonDown(_self: any, _gamepad: any, keyCode: any): boolean
		return keysDown[keyCode] == true
	end
	function UserInputService.methods.GetKeysPressed(_self: any): { any }
		return {}
	end
	function UserInputService.methods.GetMouseButtonsPressed(_self: any): { any }
		return {}
	end
	function UserInputService.methods.GetLastInputType(_self: any): any
		if lastInputType then
			return lastInputType
		end
		local input = config.input
		if input.touch and not input.keyboard then
			return Enum.UserInputType.Touch
		elseif input.gamepad and not input.keyboard then
			return Enum.UserInputType.Gamepad1
		end
		return Enum.UserInputType.Keyboard
	end
	function UserInputService.methods.GetConnectedGamepads(_self: any): { any }
		return if config.input.gamepad then { Enum.UserInputType.Gamepad1 } else {}
	end
	function UserInputService.methods.GetNavigationGamepads(_self: any): { any }
		return if config.input.gamepad then { Enum.UserInputType.Gamepad1 } else {}
	end
	function UserInputService.methods.GetGamepadConnected(_self: any, gamepad: any): boolean
		return config.input.gamepad == true and gamepad == Enum.UserInputType.Gamepad1
	end
	function UserInputService.methods.GetGamepadState(_self: any, _gamepad: any): { any }
		return {}
	end
	function UserInputService.methods.GetSupportedGamepadKeyCodes(_self: any, _gamepad: any): { any }
		return {}
	end
	function UserInputService.methods.GamepadSupports(_self: any, _gamepad: any, _keyCode: any): boolean
		return config.input.gamepad == true
	end
	function UserInputService.methods.GetFocusedTextBox(_self: any): any
		return H.focusedTextBox()
	end
	function UserInputService.methods.GetStringForKeyCode(_self: any, keyCode: any): string
		return keyCode.Name
	end
	function UserInputService.methods.GetImageForKeyCode(_self: any, _keyCode: any): string
		return ""
	end

	--------------------------------------------------------------------------------------------------------------
	-- ContextActionService
	--------------------------------------------------------------------------------------------------------------
	local ContextActionService = H.class("ContextActionService")
	local actions: { [string]: any } = {} -- name -> { name, fn, priority, order, inputs = { [EnumItem] = true }, button }
	local actionOrder = 0

	local function bind(name: any, fn: any, createTouchButton: any, priority: number, inputs: { any })
		if type(name) ~= "string" or type(fn) ~= "function" then
			error("BindAction expects (actionName: string, functionToBind: function, createTouchButton: boolean, ...inputs)", 3)
		end
		actionOrder += 1
		local action = { name = name, fn = fn, priority = priority, order = actionOrder, inputs = {}, inputList = inputs, button = nil :: any }
		for _, input in inputs do
			if typeof(input) ~= "EnumItem" then
				error(`BindAction: inputs must be Enum.KeyCode / Enum.UserInputType items, got {H.typeof(input)}`, 3)
			end
			action.inputs[input] = true
		end
		if createTouchButton == true and config.input.touch then
			local button = H.datatypes.Instance.new("ImageButton")
			button.Name = name .. "Button"
			local title = H.datatypes.Instance.new("TextLabel")
			title.Name = "ActionTitle"
			title.Parent = button
			action.button = button
		end
		actions[name] = action
	end

	function ContextActionService.methods.BindAction(_self: any, name: string, fn: any, createTouchButton: boolean?, ...: any)
		bind(name, fn, createTouchButton, Enum.ContextActionPriority.Medium.Value, { ... })
	end
	function ContextActionService.methods.BindActionAtPriority(_self: any, name: string, fn: any, createTouchButton: boolean?, priority: number, ...: any)
		if type(priority) ~= "number" then
			error("BindActionAtPriority: priority must be a number", 2)
		end
		bind(name, fn, createTouchButton, priority, { ... })
	end
	function ContextActionService.methods.UnbindAction(_self: any, name: string)
		local action = actions[name]
		if action then
			actions[name] = nil
			if action.button then
				action.button:Destroy()
			end
			-- like Roblox, the handler is told the action was cancelled
			sched.spawn(action.fn, name, Enum.UserInputState.Cancel, H.newInputObject(Enum.UserInputType.None, Enum.UserInputState.Cancel))
		end
	end
	function ContextActionService.methods.UnbindAllActions(self: any)
		for name in table.clone(actions) do
			ContextActionService.methods.UnbindAction(self, name)
		end
	end
	function ContextActionService.methods.GetButton(_self: any, name: string): any
		local action = actions[name]
		return action and action.button
	end
	function ContextActionService.methods.GetBoundActionInfo(_self: any, name: string): any
		local action = actions[name]
		if not action then
			return {}
		end
		return { inputTypes = table.clone(action.inputList), priorityLevel = action.priority, createTouchButton = action.button ~= nil }
	end
	function ContextActionService.methods.GetAllBoundActionInfo(self: any): any
		local all = {}
		for name in actions do
			all[name] = ContextActionService.methods.GetBoundActionInfo(self, name)
		end
		return all
	end
	function ContextActionService.methods.SetTitle(_self: any, name: string, title: string)
		local action = actions[name]
		if action and action.button then
			action.button.ActionTitle.Text = title
		end
	end
	function ContextActionService.methods.SetImage(_self: any, name: string, image: string)
		local action = actions[name]
		if action and action.button then
			action.button.Image = image
		end
	end
	function ContextActionService.methods.SetPosition(_self: any, name: string, position: any)
		local action = actions[name]
		if action and action.button then
			action.button.Position = position
		end
	end
	ContextActionService.methods.SetDescription = function() end

	-- Offers an input to the bound actions. Returns true when one of them sank it.
	local function dispatchToActions(key: any, state: any, input: any): boolean
		local matching = {}
		for _, action in actions do
			if action.inputs[key] then
				table.insert(matching, action)
			end
		end
		table.sort(matching, function(a, b)
			if a.priority == b.priority then
				return a.order > b.order
			end
			return a.priority > b.priority
		end)
		for _, action in matching do
			local ok, result = sched.runToCompletion(5, action.fn, action.name, state, input)
			if not ok then
				H.reportError(result, `ContextActionService action "{action.name}"`)
			elseif result ~= Enum.ContextActionResult.Pass then
				return true
			end
		end
		return false
	end

	--------------------------------------------------------------------------------------------------------------
	-- ProximityPrompt
	--------------------------------------------------------------------------------------------------------------
	local ProximityPrompt = H.class("ProximityPrompt")

	local function triggerPrompt(prompt: any, player: any)
		local service = Instances.getService("ProximityPromptService", true)
		H.fireExisting(prompt, "Triggered", player)
		H.fireExisting(service, "PromptTriggered", prompt, player)
		H.fireExisting(prompt, "TriggerEnded", player)
		H.fireExisting(service, "PromptTriggerEnded", prompt, player)
	end

	function ProximityPrompt.methods.InputHoldBegin(self: any)
		local player = H.localPlayer
		if not player or not self.Enabled then
			return
		end
		local state = H.state(self)
		state.holdToken = (state.holdToken or 0) + 1
		local token = state.holdToken
		H.fireExisting(self, "PromptButtonHoldBegan", player)
		if self.HoldDuration <= 0 then
			triggerPrompt(self, player)
		else
			sched.delay(self.HoldDuration, function()
				if state.holdToken == token then
					triggerPrompt(self, player)
				end
			end)
		end
	end

	function ProximityPrompt.methods.InputHoldEnd(self: any)
		local state = H.state(self)
		state.holdToken = (state.holdToken or 0) + 1
		if H.localPlayer then
			H.fireExisting(self, "PromptButtonHoldEnded", H.localPlayer)
		end
	end

	--------------------------------------------------------------------------------------------------------------
	-- small device services
	--------------------------------------------------------------------------------------------------------------
	local HapticService = H.class("HapticService")
	HapticService.methods.IsVibrationSupported = function()
		return false
	end
	HapticService.methods.IsMotorSupported = function()
		return false
	end
	HapticService.methods.SetMotor = function() end
	HapticService.methods.GetMotor = function()
		return 0
	end
	H.class("VRService").defaults.VREnabled = false
	H.class("VRService").defaults.ThirdPersonFollowCamEnabled = false

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------
	local function makeInput(key: any, state: any, options: { [string]: any }?): any
		if typeof(key) ~= "EnumItem" or (key.EnumType ~= Enum.KeyCode and key.EnumType ~= Enum.UserInputType) then
			error("expected an Enum.KeyCode or Enum.UserInputType item", 3)
		end
		local isKeyCode = key.EnumType == Enum.KeyCode
		local inputType = key
		if isKeyCode then
			local value = key.Value
			-- gamepad buttons/thumbsticks have KeyCode values 1000..1017
			inputType = if value >= 1000 and value <= 1020 then Enum.UserInputType.Gamepad1 else Enum.UserInputType.Keyboard
		end
		local position = options and options.position
		if position == nil then
			position = Vector3.new(H.mouseState.X, H.mouseState.Y, 0)
		elseif typeof(position) == "Vector2" then
			position = Vector3.new(position.X, position.Y, 0)
		end
		local input = H.newInputObject(inputType, state, position)
		if isKeyCode then
			H.rawset(input, "KeyCode", key)
		end
		lastInputType = inputType
		return input
	end

	local function send(key: any, state: any, eventName: string, options: { [string]: any }?)
		local input = makeInput(key, state, options)
		local processed = options ~= nil and options.gameProcessed == true
		if not processed then
			processed = dispatchToActions(key, state, input)
		end
		local service = inputService()
		H.fireExisting(service, eventName, input, processed)
		if lastInputType then
			H.fireExisting(service, "LastInputTypeChanged", lastInputType)
		end
		sched.flush()
		return input
	end

	-- inputBegan(key, options?) / inputEnded(key, options?) / input(key, options?) (press and release).
	-- key: Enum.KeyCode.X or Enum.UserInputType.X. options: { gameProcessed = true, position = Vector2|Vector3 }.
	function mocks.inputBegan(key: any, options: { [string]: any }?): any
		keysDown[key] = true
		return send(key, Enum.UserInputState.Begin, "InputBegan", options)
	end
	function mocks.inputEnded(key: any, options: { [string]: any }?): any
		keysDown[key] = nil
		return send(key, Enum.UserInputState.End, "InputEnded", options)
	end
	function mocks.input(key: any, options: { [string]: any }?)
		mocks.inputBegan(key, options)
		mocks.inputEnded(key, options)
	end

	-- triggerAction(name, state = Enum.UserInputState.Begin): calls the function bound with
	-- ContextActionService:BindAction(name, ...) as if its input (or touch button) was pressed
	function mocks.triggerAction(name: string, state: any?)
		local action = actions[name]
		if not action then
			error(`env.mocks.triggerAction: no action named "{name}" is bound`, 2)
		end
		local inputState = state or Enum.UserInputState.Begin
		local key = action.inputList[1] or Enum.UserInputType.Touch
		local ok, err = sched.runToCompletion(5, action.fn, name, inputState, makeInput(key, inputState, nil))
		if not ok then
			H.reportError(err, `ContextActionService action "{name}"`)
		end
		sched.flush()
	end

	-- triggerPrompt(prompt, player?): the player (default: the local player) activated a ProximityPrompt.
	-- Errors when the prompt is disabled or not in the Workspace, because the player could not have used it.
	function mocks.triggerPrompt(prompt: any, player: any?)
		if not (H.isInstance(prompt) and prompt:IsA("ProximityPrompt")) then
			error("env.mocks.triggerPrompt: expected a ProximityPrompt", 2)
		end
		local who = player or H.localPlayer
		if not who then
			error("env.mocks.triggerPrompt: pass a player or set a local player first", 2)
		end
		if not prompt.Enabled then
			error(`env.mocks.triggerPrompt: {prompt:GetFullName()} is disabled`, 2)
		end
		if not prompt:IsDescendantOf(H.workspace) then
			error(`env.mocks.triggerPrompt: {prompt:GetFullName()} is not in the Workspace`, 2)
		end
		triggerPrompt(prompt, who)
		sched.flush()
	end

	return nil
end
