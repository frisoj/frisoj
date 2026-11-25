--[[
	User interface classes.

	Properties of UI instances are stored and validated like everything else. What the engine would compute is
	approximated just enough for UI code to run:
	  * AbsoluteSize / AbsolutePosition: from Size / Position / AnchorPoint relative to the parent (ScreenGui =
	    viewport size). Layout objects, constraints, UIScale, AutomaticSize and rotation are ignored.
	  * TextBounds: about half the text size per character, one line. TextFits is always true.
	  * UIListLayout / UIGridLayout.AbsoluteContentSize: summed from the visible sibling GuiObjects.
	  * ScrollingFrame.AbsoluteCanvasSize from CanvasSize.
	None of the computed properties fire change signals on their own (env.mocks.fireChanged does).

	Tests interact through env.mocks.click(button), env.mocks.typeText(textBox, text) and env.mocks.hover.
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local mocks = H.mocks
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Vector2, Vector3, Rect = roblox.Vector2, roblox.Vector3, roblox.Rect

	config.guiInset = Vector2.new(0, 36) -- GuiService:GetGuiInset() top-left inset (the Roblox top bar)
	config.setCoreFailures = 0 -- make the next N StarterGui:SetCore calls fail like before CoreScripts registered
	mocks.coreCalls = {} -- { { method = "SetCore"|"SetCoreGuiEnabled", name = any, value = any } }

	--------------------------------------------------------------------------------------------------------------
	-- layout approximation
	--------------------------------------------------------------------------------------------------------------
	local absoluteSize, absolutePosition

	local function parentBox(instance: any): (any, any)
		local parent = instance.Parent
		if parent and parent:IsA("GuiBase2d") then
			return absoluteSize(parent), absolutePosition(parent)
		end
		return Vector2.zero, Vector2.zero
	end

	absoluteSize = function(instance: any): any
		if instance:IsA("GuiObject") then
			local parentSize = parentBox(instance)
			local size = instance.Size
			return Vector2.new(
				math.max(size.X.Scale * parentSize.X + size.X.Offset, 0),
				math.max(size.Y.Scale * parentSize.Y + size.Y.Offset, 0)
			)
		elseif instance:IsA("BillboardGui") then
			local size = instance.Size
			return Vector2.new(size.X.Offset + size.X.Scale * 50, size.Y.Offset + size.Y.Scale * 50)
		elseif instance:IsA("SurfaceGui") then
			return instance.CanvasSize
		end
		return config.viewportSize -- ScreenGui and other layer collectors
	end

	absolutePosition = function(instance: any): any
		if instance:IsA("GuiObject") then
			local parentSize, parentPosition = parentBox(instance)
			local position, anchor, size = instance.Position, instance.AnchorPoint, absoluteSize(instance)
			return Vector2.new(
				parentPosition.X + position.X.Scale * parentSize.X + position.X.Offset - anchor.X * size.X,
				parentPosition.Y + position.Y.Scale * parentSize.Y + position.Y.Offset - anchor.Y * size.Y
			)
		end
		return Vector2.zero
	end

	local GuiBase2d = H.class("GuiBase2d")
	GuiBase2d.props.AbsoluteSize = { get = absoluteSize }
	GuiBase2d.props.AbsolutePosition = { get = absolutePosition }
	GuiBase2d.props.AbsoluteRotation = {
		get = function()
			return 0
		end,
	}

	local GuiObject = H.class("GuiObject")
	GuiObject.defaults.GuiState = Enum.GuiState.Idle
	H.class("UICorner").defaults.CornerRadius = roblox.UDim.new(0, 8)

	-- deprecated-in-practice tween helpers: apply the goal immediately
	local function tweenTo(self: any, position: any?, size: any?, callback: any?): boolean
		if position then
			self.Position = position
		end
		if size then
			self.Size = size
		end
		if type(callback) == "function" then
			sched.deferCall(callback, table.pack(Enum.TweenStatus.Completed))
		end
		return true
	end
	function GuiObject.methods.TweenPosition(self: any, position: any, _direction: any?, _style: any?, _time: number?, _override: boolean?, callback: any?)
		return tweenTo(self, position, nil, callback)
	end
	function GuiObject.methods.TweenSize(self: any, size: any, _direction: any?, _style: any?, _time: number?, _override: boolean?, callback: any?)
		return tweenTo(self, nil, size, callback)
	end
	function GuiObject.methods.TweenSizeAndPosition(self: any, size: any, position: any, _direction: any?, _style: any?, _time: number?, _override: boolean?, callback: any?)
		return tweenTo(self, position, size, callback)
	end

	-- text ------------------------------------------------------------------------------------------------------
	local function plainText(instance: any): string
		local text = instance.Text
		if instance.RichText then
			text = string.gsub(text, "<[^>]+>", "")
		end
		return text
	end

	local function textBounds(instance: any): any
		local text = plainText(instance)
		local size = instance.TextSize
		if instance.TextScaled then
			size = math.max(absoluteSize(instance).Y, 1)
		end
		return Vector2.new(utf8.len(text) and (utf8.len(text) :: number) * size * 0.5 or #text * size * 0.5, size)
	end

	for _, className in { "TextLabel", "TextButton", "TextBox" } do
		local class = H.class(className)
		class.props.TextBounds = { get = textBounds }
		class.props.TextFits = {
			get = function()
				return true
			end,
		}
		class.props.ContentText = { get = plainText }
		if className ~= "TextBox" then
			class.props.LocalizedText = {
				get = function(self)
					return self.Text
				end,
			}
		end
		class.defaults.OpenTypeFeaturesError = ""
	end

	for _, className in { "ImageLabel", "ImageButton" } do
		H.class(className).props.IsLoaded = {
			get = function()
				return true
			end,
		}
	end

	-- scrolling & layouts -----------------------------------------------------------------------------------------
	local ScrollingFrame = H.class("ScrollingFrame")
	ScrollingFrame.props.AbsoluteWindowSize = { get = absoluteSize }
	ScrollingFrame.props.AbsoluteCanvasSize = {
		get = function(self)
			local window = absoluteSize(self)
			local canvas = self.CanvasSize
			return Vector2.new(
				math.max(canvas.X.Scale * window.X + canvas.X.Offset, window.X),
				math.max(canvas.Y.Scale * window.Y + canvas.Y.Offset, window.Y)
			)
		end,
	}

	local function visibleSiblings(layout: any): { any }
		local items = {}
		local parent = layout.Parent
		if parent then
			for _, child in parent:GetChildren() do
				if child:IsA("GuiObject") and child.Visible then
					table.insert(items, child)
				end
			end
		end
		return items
	end

	local function udimPixels(udim: any, parentPixels: number): number
		return udim.Scale * parentPixels + udim.Offset
	end

	H.class("UIListLayout").props.AbsoluteContentSize = {
		get = function(self)
			local items = visibleSiblings(self)
			local parent = self.Parent
			local parentSize = if parent and parent:IsA("GuiBase2d") then absoluteSize(parent) else Vector2.zero
			local horizontal = self.FillDirection == Enum.FillDirection.Horizontal
			local along, across = 0, 0
			for _, item in items do
				local size = absoluteSize(item)
				along += if horizontal then size.X else size.Y
				across = math.max(across, if horizontal then size.Y else size.X)
			end
			if #items > 1 then
				along += udimPixels(self.Padding, if horizontal then parentSize.X else parentSize.Y) * (#items - 1)
			end
			return if horizontal then Vector2.new(along, across) else Vector2.new(across, along)
		end,
	}
	H.class("UIListLayout").methods.ApplyLayout = function() end
	H.class("UIGridStyleLayout").methods.ApplyLayout = function() end

	local function gridMetrics(self: any): (any, any, number)
		local parent = self.Parent
		local parentSize = if parent and parent:IsA("GuiBase2d") then absoluteSize(parent) else Vector2.zero
		local cell = Vector2.new(udimPixels(self.CellSize.X, parentSize.X), udimPixels(self.CellSize.Y, parentSize.Y))
		local padding = Vector2.new(udimPixels(self.CellPadding.X, parentSize.X), udimPixels(self.CellPadding.Y, parentSize.Y))
		local count = #visibleSiblings(self)
		local perLine = math.max(1, math.floor((parentSize.X + padding.X) / math.max(cell.X + padding.X, 1)))
		if self.FillDirectionMaxCells > 0 then
			perLine = math.min(perLine, self.FillDirectionMaxCells)
		end
		local columns = math.min(perLine, math.max(count, 1))
		local rows = math.ceil(count / perLine)
		return cell, padding, columns * 1000 + rows
	end
	local UIGridLayout = H.class("UIGridLayout")
	UIGridLayout.props.AbsoluteCellSize = {
		get = function(self)
			local cell = gridMetrics(self)
			return cell
		end,
	}
	UIGridLayout.props.AbsoluteCellCount = {
		get = function(self)
			local _, _, packed = gridMetrics(self)
			return Vector2.new(packed // 1000, packed % 1000)
		end,
	}
	UIGridLayout.props.AbsoluteContentSize = {
		get = function(self)
			local cell, padding, packed = gridMetrics(self)
			local columns, rows = packed // 1000, packed % 1000
			return Vector2.new(
				columns * cell.X + math.max(columns - 1, 0) * padding.X,
				rows * cell.Y + math.max(rows - 1, 0) * padding.Y
			)
		end,
	}
	H.class("UIPageLayout").defaults.AbsoluteContentSize = Vector2.zero
	H.class("UITableLayout").defaults.AbsoluteContentSize = Vector2.zero

	local UIPageLayout = H.class("UIPageLayout")
	local function jumpTo(self: any, page: any)
		if page and page ~= self.CurrentPage then
			local previous = self.CurrentPage
			H.rawset(self, "CurrentPage", page)
			if previous then
				H.fireExisting(self, "PageLeave", previous)
			end
			H.fireExisting(self, "PageEnter", page)
			H.fireExisting(self, "Stopped", page)
		end
	end
	local function stepPage(self: any, delta: number)
		local pages = visibleSiblings(self)
		if #pages == 0 then
			return
		end
		local current = table.find(pages, self.CurrentPage) or 1
		local target = current + delta
		if self.Circular then
			target = (target - 1) % #pages + 1
		end
		jumpTo(self, pages[math.clamp(target, 1, #pages)])
	end
	UIPageLayout.methods.JumpTo = jumpTo
	UIPageLayout.methods.JumpToIndex = function(self: any, index: number)
		jumpTo(self, visibleSiblings(self)[index + 1])
	end
	UIPageLayout.methods.Next = function(self: any)
		stepPage(self, 1)
	end
	UIPageLayout.methods.Previous = function(self: any)
		stepPage(self, -1)
	end

	H.class("BillboardGui").defaults.CurrentDistance = 0
	H.class("PlayerGui").defaults.CurrentScreenOrientation = Enum.ScreenOrientation.LandscapeLeft
	H.class("PlayerGui").methods.GetGuiObjectsAtPosition = function(_self: any, _x: number, _y: number)
		return {}
	end
	H.class("BasePlayerGui").methods.GetGuiObjectsAtPosition = function(_self: any, _x: number, _y: number)
		return {}
	end

	--------------------------------------------------------------------------------------------------------------
	-- TextBox focus
	--------------------------------------------------------------------------------------------------------------
	local TextBox = H.class("TextBox")
	TextBox.defaults.CursorPosition = -1
	TextBox.defaults.SelectionStart = -1
	local focusedTextBox: any = nil

	function TextBox.methods.CaptureFocus(self: any)
		if focusedTextBox == self then
			return
		end
		if focusedTextBox then
			focusedTextBox:ReleaseFocus(false)
		end
		focusedTextBox = self
		if self.ClearTextOnFocus then
			self.Text = ""
		end
		H.fireExisting(self, "Focused")
	end

	function TextBox.methods.ReleaseFocus(self: any, submitted: boolean?)
		if focusedTextBox == self then
			focusedTextBox = nil
			H.fireExisting(self, "FocusLost", submitted == true, nil)
		end
	end

	function TextBox.methods.IsFocused(self: any): boolean
		return focusedTextBox == self
	end

	function H.focusedTextBox(): any
		return focusedTextBox
	end

	--------------------------------------------------------------------------------------------------------------
	-- StarterGui / GuiService / TextService
	--------------------------------------------------------------------------------------------------------------
	local StarterGui = H.class("StarterGui")
	local coreValues: { [string]: any } = {}
	local coreGuiEnabled: { [any]: boolean } = {}

	function StarterGui.methods.SetCore(_self: any, name: string, value: any)
		if type(name) ~= "string" then
			error(`SetCore: name must be a string, got {H.typeof(name)}`, 2)
		end
		if config.setCoreFailures > 0 then
			config.setCoreFailures -= 1
			error(`SetCore: {name} has not been registered by the CoreScripts`, 2)
		end
		coreValues[name] = value
		table.insert(mocks.coreCalls, { method = "SetCore", name = name, value = value })
	end

	function StarterGui.methods.GetCore(_self: any, name: string): any
		if type(name) ~= "string" then
			error(`GetCore: name must be a string, got {H.typeof(name)}`, 2)
		end
		return coreValues[name]
	end

	function StarterGui.methods.SetCoreGuiEnabled(_self: any, coreGuiType: any, enabled: boolean)
		if typeof(coreGuiType) ~= "EnumItem" or coreGuiType.EnumType ~= Enum.CoreGuiType then
			error("SetCoreGuiEnabled expects an Enum.CoreGuiType", 2)
		end
		if type(enabled) ~= "boolean" then
			error("SetCoreGuiEnabled expects a boolean", 2)
		end
		if coreGuiType == Enum.CoreGuiType.All then
			for _, item in Enum.CoreGuiType:GetEnumItems() do
				coreGuiEnabled[item] = enabled
			end
		else
			coreGuiEnabled[coreGuiType] = enabled
		end
		table.insert(mocks.coreCalls, { method = "SetCoreGuiEnabled", name = coreGuiType, value = enabled })
	end

	function StarterGui.methods.GetCoreGuiEnabled(_self: any, coreGuiType: any): boolean
		return coreGuiEnabled[coreGuiType] ~= false
	end
	StarterGui.methods.RegisterSetCore = function() end
	StarterGui.methods.RegisterGetCore = function() end

	local GuiService = H.class("GuiService")
	GuiService.defaults.MenuIsOpen = false
	GuiService.defaults.AutoSelectGuiEnabled = true
	GuiService.defaults.GuiNavigationEnabled = true
	GuiService.defaults.TouchControlsEnabled = true
	GuiService.defaults.PreferredTransparency = 1
	GuiService.defaults.ReducedMotionEnabled = false
	GuiService.defaults.PreferredTextSize = Enum.PreferredTextSize.Medium
	GuiService.defaults.ViewportDisplaySize = Enum.DisplaySize.Large
	GuiService.props.TopbarInset = {
		get = function()
			return Rect.new(0, 0, config.viewportSize.X, config.guiInset.Y)
		end,
	}
	function GuiService.methods.GetGuiInset(_self: any): (any, any)
		return config.guiInset, Vector2.zero
	end
	function GuiService.methods.IsTenFootInterface(_self: any): boolean
		return false
	end
	function GuiService.methods.GetScreenResolution(_self: any): any
		return config.viewportSize
	end
	function GuiService.methods.Select(self: any, selectionParent: any)
		self.SelectedObject = selectionParent
	end
	GuiService.methods.AddSelectionParent = function() end
	GuiService.methods.AddSelectionTuple = function() end
	GuiService.methods.RemoveSelectionGroup = function() end
	GuiService.methods.SetGameplayPausedNotificationEnabled = function() end

	local TextService = H.class("TextService")
	function TextService.methods.GetTextSize(_self: any, text: string, fontSize: number, _font: any, frameSize: any): any
		if type(text) ~= "string" or type(fontSize) ~= "number" or typeof(frameSize) ~= "Vector2" then
			error("GetTextSize expects (text: string, fontSize: number, font: Enum.Font, frameSize: Vector2)", 2)
		end
		local width = (utf8.len(text) or #text) * fontSize * 0.5
		local lines = 1
		if frameSize.X > 0 and width > frameSize.X then
			lines = math.ceil(width / frameSize.X)
			width = frameSize.X
		end
		return Vector2.new(width, lines * fontSize)
	end
	function TextService.methods.GetTextBoundsAsync(self: any, params: any): any
		H.yield()
		return TextService.methods.GetTextSize(self, params.Text, params.Size, nil, Vector2.new(params.Width, 0))
	end
	H.class("GetTextBoundsParams").defaults.Width = 0

	local FilterResult = {}
	FilterResult.__index = FilterResult
	H.typeNames[FilterResult] = "Instance"
	local function filtered(self: any): string
		H.yield()
		return self._text
	end
	FilterResult.GetNonChatStringForBroadcastAsync = filtered
	FilterResult.GetNonChatStringForUserAsync = filtered
	FilterResult.GetChatForUserAsync = filtered
	-- config.textFilter(text, fromUserId) -> filtered text (default: unchanged)
	function TextService.methods.FilterStringAsync(_self: any, text: string, fromUserId: number, _context: any?): any
		if type(text) ~= "string" or type(fromUserId) ~= "number" then
			error("FilterStringAsync expects (text: string, fromUserId: number, context?)", 2)
		end
		H.yield()
		local result = if config.textFilter then config.textFilter(text, fromUserId) else text
		return setmetatable({ _text = result }, FilterResult)
	end

	--------------------------------------------------------------------------------------------------------------
	-- test API
	--------------------------------------------------------------------------------------------------------------
	-- Why a GuiObject cannot be interacted with (hidden / disabled somewhere up the tree), or nil.
	local function blockedReason(instance: any): string?
		local current = instance
		while current do
			if current:IsA("GuiObject") and not current.Visible then
				return `{current:GetFullName()} has Visible = false`
			elseif current:IsA("LayerCollector") and not current.Enabled then
				return `{current:GetFullName()} has Enabled = false`
			end
			current = current.Parent
		end
		return nil
	end

	local function inputObject(inputType: any, state: any, position: any?): any
		local object = H.create("InputObject")
		H.rawset(object, "UserInputType", inputType)
		H.rawset(object, "UserInputState", state)
		H.rawset(object, "Position", position or Vector3.zero)
		return object
	end
	H.newInputObject = inputObject

	-- click(button, options?): what a mouse click / tap on a GuiButton does: MouseButton1Down, MouseButton1Up,
	-- MouseButton1Click and Activated fire. Errors when the button could not be clicked in the real game (hidden,
	-- in a disabled ScreenGui, Active or Interactable false) unless options.force is set.
	function mocks.click(button: any, options: { [string]: any }?)
		if not (H.isInstance(button) and button:IsA("GuiButton")) then
			error(`env.mocks.click: expected a GuiButton, got {tostring(button)}`, 2)
		end
		if not (options and options.force) then
			local reason = blockedReason(button)
			if not reason and not button.Active then
				reason = "its Active property is false"
			elseif not reason and not button.Interactable then
				reason = "its Interactable property is false"
			end
			if reason then
				error(`env.mocks.click: {button:GetFullName()} cannot be clicked: {reason}`, 2)
			end
		end
		local position = absolutePosition(button) + absoluteSize(button) / 2
		H.fireExisting(button, "MouseButton1Down", position.X, position.Y)
		H.fireExisting(button, "MouseButton1Up", position.X, position.Y)
		H.fireExisting(button, "MouseButton1Click")
		local input = inputObject(Enum.UserInputType.MouseButton1, Enum.UserInputState.End, Vector3.new(position.X, position.Y, 0))
		H.fireExisting(button, "Activated", input, 1)
		sched.flush()
	end

	-- hover(guiObject, entering = true): fires MouseEnter (or MouseLeave when entering == false)
	function mocks.hover(guiObject: any, entering: boolean?)
		if not (H.isInstance(guiObject) and guiObject:IsA("GuiObject")) then
			error("env.mocks.hover: expected a GuiObject", 2)
		end
		local position = absolutePosition(guiObject) + absoluteSize(guiObject) / 2
		H.fireExisting(guiObject, if entering == false then "MouseLeave" else "MouseEnter", position.X, position.Y)
		sched.flush()
	end

	-- typeText(textBox, text, enterPressed = true): the player focuses the box, types `text` and leaves it
	-- (FocusLost(enterPressed)). Errors when the box is hidden or not editable.
	function mocks.typeText(textBox: any, text: string, enterPressed: boolean?)
		if not (H.isInstance(textBox) and textBox:IsA("TextBox")) then
			error("env.mocks.typeText: expected a TextBox", 2)
		end
		local reason = blockedReason(textBox)
		if not reason and not textBox.TextEditable then
			reason = "its TextEditable property is false"
		end
		if reason then
			error(`env.mocks.typeText: {textBox:GetFullName()} cannot be typed into: {reason}`, 2)
		end
		textBox:CaptureFocus()
		textBox.Text = text
		textBox:ReleaseFocus(enterPressed ~= false)
		sched.flush()
	end

	return nil
end
