--!strict
--[[
	WindowManager — owns the one shared ScreenGui ("HUD"), its layers and its responsive scale, and the window
	system on top of it: registry, open/close with a pop animation, dimmed backdrop, Escape / gamepad B, and the
	ProximityPrompts of the hub's ShopStand parts (spec §8, §14).

	WINDOWS
	    WindowManager.register({ id = "Shop", title = "Shop", icon = "🛒", order = 1, showInMenu = true,
	        size = Vector2.new(1400, 830)?,                 -- design px, default Theme.Size.Window
	        build = function(content, handle) ... end,      -- once, lazily, on first open; fill `content`
	        onOpen = function(args) ... end?, onClose = function() ... end?, badge = function() return 0 end? })
	    WindowManager.open("Shop", { tab = "gems" })        -- args go to onOpen; one window is open at a time
	    WindowManager.close()   WindowManager.toggle(id)   WindowManager.isOpen(id?)   WindowManager.getRegistered()
	    WindowManager.Opened / .Closed (id)   .Registered (id)   .Failed (id, title: its build function threw)
	  A build function that throws is reported (warning + error toast) and leaves the manager fully working.

	LAYERS — where feature code parents its GUI (all inside the shared ScreenGui, back to front):
	    WindowManager.getHudLayer()            HUD widgets (currency pills, menu, bars ...)
	    WindowManager.getWindowLayer()         the windows and their backdrop (managed here; do not parent to it)
	    WindowManager.getOverlayLayer()        full-screen feature overlays above windows (egg hatch, dialogs)
	    WindowManager.getNotificationLayer()   toasts, popups, banners (used by Core/Notifications)
	    WindowManager.getScreenGui()           the ScreenGui itself
	  The HUD, overlay and notification layers are full-screen Frames measured in DESIGN PIXELS: a UIScale makes
	  1 design px = 1/1080 of the screen height on a 16:9 screen (never below 0.5 real px, so phones get a
	  relatively bigger UI). Position with scale + offset as usual: UDim2.new(1, -20, 1, -20) is 20 design px from
	  the bottom-right corner. Window content frames are in design pixels too.
	    WindowManager.getScale()        current design-px → real-px factor
	    WindowManager.getDesignSize()   size of the full-screen layers in design px (changes with the aspect ratio)
	    WindowManager.getTopInset()     height of Roblox's own top bar in design px (keep the top-left corner clear)
	    WindowManager.isCompact()       true on phone-sized screens (the scale is at its minimum)
	    WindowManager.ScaleChanged      Signal (scale) after the viewport changed

	MODALS
	    local remove = WindowManager.pushModal(dismiss)   -- Escape / gamepad B call `dismiss` of the top-most
	    remove()                                          -- modal instead of closing the window

	SHOP STANDS — every part tagged "ShopStand" (attributes Window = window id, Label = action text) gets a
	ProximityPrompt that opens that window. Prompts use WindowManager.PromptKey (F) / PromptGamepadKey (Y)
	because E and gamepad X belong to "smash nearest crystal"; other world prompts should use the same keys.
]]

local CollectionService = game:GetService("CollectionService")
local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Signal = require(Shared:WaitForChild("Util"):WaitForChild("Signal"))

local Client = ReplicatedStorage:WaitForChild("Client")
local Theme = require(Client:WaitForChild("UI"):WaitForChild("Theme"))
local Kit = require(Client:WaitForChild("UI"):WaitForChild("Kit"))
local Sound = require(Client:WaitForChild("Core"):WaitForChild("Sound"))

export type WindowHandle = {
	id: string,
	frame: Frame, -- the whole window
	content: Frame, -- the area below the title bar that the feature fills
	setTitle: (string) -> (),
	close: () -> (),
}

export type WindowDef = {
	id: string,
	title: string,
	icon: string, -- emoji
	order: number, -- position in the HUD menu
	showInMenu: boolean,
	size: Vector2?, -- design px
	build: (content: Frame, handle: WindowHandle) -> (), -- called once, lazily, on first open
	onOpen: ((args: any?) -> ())?,
	onClose: (() -> ())?,
	badge: (() -> number)?, -- count for the red dot on the menu button
}

type Entry = {
	def: WindowDef,
	frame: Frame?,
	scale: UIScale?,
	closeButton: Kit.Button?,
	building: boolean,
	token: number, -- bumped by every show/hide so a finished tween knows whether it is still current
	tween: Tween?, -- the running open/close tween of the window scale
}

type ScaledLayer = { frame: Frame, scale: UIScale }

local WindowManager = {}

local Opened: Signal.Signal<string> = Signal.new()
local Closed: Signal.Signal<string> = Signal.new()
local Registered: Signal.Signal<string> = Signal.new()
local Failed: Signal.Signal<string, string> = Signal.new()
local ScaleChanged: Signal.Signal<number> = Signal.new()

WindowManager.Opened = Opened -- (id)
WindowManager.Closed = Closed -- (id)
WindowManager.Registered = Registered -- (id) a window was registered (the HUD menu rebuilds on it)
WindowManager.Failed = Failed -- (id, title) the window's build function threw
WindowManager.ScaleChanged = ScaleChanged -- (scale)

-- Keys of world ProximityPrompts (E / gamepad X are taken by "smash nearest crystal").
WindowManager.PromptKey = Enum.KeyCode.F
WindowManager.PromptGamepadKey = Enum.KeyCode.ButtonY

local MIN_SCALE = 0.5 -- phones: UI is never smaller than half the design size
local MAX_SCALE = 2.5
local WINDOW_FIT_X = 0.94 -- a window never covers more than this share of the screen
local WINDOW_FIT_Y = 0.92
local WINDOW_MIN_BASE = 0.75 -- small screens: let windows grow up to this scale (nearly full-screen on phones)
local OPEN_TIME = 0.22
local CLOSE_TIME = 0.12
local STAND_TAG = "ShopStand"
local PROMPT_DISTANCE = 12

---------------------------------------------------------------------------------------------------
-- ScreenGui and layers

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "HUD"
screenGui.ResetOnSpawn = false
-- Full screen (the dim backdrop must cover the top bar too); HUD code keeps clear of the top bar itself.
screenGui.IgnoreGuiInset = true
screenGui.DisplayOrder = Theme.DisplayOrder
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

local scaledLayers: { ScaledLayer } = {}

local function newLayer(name: string, zIndex: number, scaled: boolean): Frame
	local frame = Instance.new("Frame")
	frame.Name = name
	frame.BackgroundTransparency = 1
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	frame.ZIndex = zIndex
	if scaled then
		local scale = Instance.new("UIScale")
		scale.Name = "LayerScale"
		scale.Parent = frame
		table.insert(scaledLayers, { frame = frame, scale = scale })
	end
	frame.Parent = screenGui
	return frame
end

local hudLayer = newLayer("HudLayer", Theme.Z.LayerHud, true)
local windowLayer = newLayer("WindowLayer", Theme.Z.LayerWindows, false)
local overlayLayer = newLayer("OverlayLayer", Theme.Z.LayerOverlay, true)
local notificationLayer = newLayer("NotificationLayer", Theme.Z.LayerNotifications, true)

local backdrop = Instance.new("TextButton")
backdrop.Name = "Backdrop"
backdrop.Text = ""
backdrop.AutoButtonColor = false
backdrop.Selectable = false
backdrop.BackgroundColor3 = Theme.Color.Backdrop
backdrop.BackgroundTransparency = 1
backdrop.BorderSizePixel = 0
backdrop.Size = UDim2.fromScale(1, 1)
backdrop.Visible = false
backdrop.Parent = windowLayer

---------------------------------------------------------------------------------------------------
-- State

local registered: { [string]: Entry } = {}
local current: Entry? = nil
local backdropToken = 0
local uiScale = 1
local topInsetPixels = 0
local compact = false

type Modal = { dismiss: () -> () }
local modals: { Modal } = {}

type StandRecord = { prompt: ProximityPrompt, connections: { RBXScriptConnection }, refresh: () -> () }
local stands: { [Instance]: StandRecord } = {}

local function traceback(message: any): string
	return debug.traceback(tostring(message), 2)
end

---------------------------------------------------------------------------------------------------
-- Responsive scale

local function viewportSize(): Vector2
	local size = screenGui.AbsoluteSize
	if size.X > 0 and size.Y > 0 then
		return size
	end
	local camera = workspace.CurrentCamera
	if camera then
		local viewport = camera.ViewportSize
		if viewport.X > 0 and viewport.Y > 0 then
			return viewport
		end
	end
	return Vector2.new(1280, 720)
end

local function baseScale(viewport: Vector2): number
	local reference = Theme.Size.Reference
	return math.min(viewport.X / reference.X, viewport.Y / reference.Y)
end

-- Scale of a window of the given design size: the design scale on big screens, as large as fits on small ones.
local function windowScaleFor(size: Vector2): number
	local viewport = viewportSize()
	local fit = math.min(viewport.X * WINDOW_FIT_X / size.X, viewport.Y * WINDOW_FIT_Y / size.Y)
	return math.max(math.min(fit, math.max(baseScale(viewport), WINDOW_MIN_BASE)), 0.05)
end

local function windowSize(entry: Entry): Vector2
	return entry.def.size or Theme.Size.Window
end

local function refreshScale()
	local viewport = viewportSize()
	local base = baseScale(viewport)
	local scale = math.clamp(base, MIN_SCALE, MAX_SCALE)
	compact = base < MIN_SCALE

	local okInset, inset = pcall(function(): Vector2
		local topLeft = GuiService:GetGuiInset()
		return topLeft
	end)
	topInsetPixels = if okInset and typeof(inset) == "Vector2" then inset.Y else 0

	for _, layer in scaledLayers do
		layer.scale.Scale = scale
		-- The UIScale shrinks the frame itself too; oversize it so it still covers the screen.
		layer.frame.Size = UDim2.fromScale(1 / scale, 1 / scale)
	end
	for _, entry in registered do
		local windowScale = entry.scale
		if windowScale and entry == current then
			-- A running pop tween would end on the old size; snap to the new one instead.
			local tween = entry.tween
			if tween then
				tween:Cancel()
				entry.tween = nil
			end
			windowScale.Scale = windowScaleFor(windowSize(entry))
		end
	end
	if scale ~= uiScale then
		uiScale = scale
		ScaleChanged:Fire(scale)
	end
end

---------------------------------------------------------------------------------------------------
-- Window chrome

local function buildChrome(entry: Entry): (Frame, Frame, UIScale, TextLabel, Kit.Button)
	local def = entry.def
	local size = windowSize(entry)

	local frame = Instance.new("Frame")
	frame.Name = "Window_" .. def.id
	frame.AnchorPoint = Vector2.new(0.5, 0.5)
	frame.Position = UDim2.fromScale(0.5, 0.5)
	frame.Size = UDim2.fromOffset(size.X, size.Y)
	frame.BackgroundColor3 = Theme.Color.White
	frame.BorderSizePixel = 0
	frame.Visible = false
	-- Sinks clicks on the window itself; otherwise they would fall through to the backdrop and close it.
	frame.Active = true
	Kit.corner(frame, Theme.Corner.Window)
	Kit.stroke(frame, Theme.Stroke.Thick)
	Kit.gradient(frame, Theme.Gradient.Panel)

	local scale = Instance.new("UIScale")
	scale.Name = "WindowScale"
	scale.Scale = windowScaleFor(size)
	scale.Parent = frame

	local _, titleLabel = Kit.titleBar({ text = `{def.icon} {def.title}`, parent = frame })

	-- Red round close button, overlapping the top-right corner.
	local closeButton = Kit.button({
		text = "X",
		style = "danger",
		corner = Theme.Corner.Pill,
		textSize = 40,
		sound = "",
		size = UDim2.fromOffset(Theme.Size.CloseButton, Theme.Size.CloseButton),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.new(1, -18, 0, 16),
		zIndex = Theme.Z.Top,
		name = "Close",
		parent = frame,
		onClick = function()
			if current == entry then
				WindowManager.close()
			end
		end,
	})

	local padding = Theme.Size.WindowPadding
	local top = Theme.Size.TitleBar + padding - 4
	local content = Instance.new("Frame")
	content.Name = "Content"
	content.BackgroundTransparency = 1
	content.BorderSizePixel = 0
	content.Position = UDim2.fromOffset(padding, top)
	content.Size = UDim2.new(1, -padding * 2, 1, -(top + padding))
	content.Parent = frame

	return frame, content, scale, titleLabel, closeButton
end

-- Builds the window on first use. Returns false when it cannot be shown (its build function threw, or it is
-- being built right now by an earlier call).
local function ensureBuilt(entry: Entry): boolean
	if entry.frame then
		return true
	end
	if entry.building then
		return false
	end
	entry.building = true
	local def = entry.def
	local frame, content, scale, titleLabel, closeButton = buildChrome(entry)
	local handle: WindowHandle = {
		id = def.id,
		frame = frame,
		content = content,
		setTitle = function(title: string)
			titleLabel.Text = `{def.icon} {title}`
		end,
		close = function()
			if current == entry then
				WindowManager.close()
			end
		end,
	}
	-- Parented (still hidden) before building so the feature sees real sizes.
	frame.Parent = windowLayer
	local ok, message = xpcall(def.build :: (...any) -> ...any, traceback, content, handle)
	entry.building = false
	if not ok then
		warn(`[WindowManager] window "{def.id}" failed to build: {tostring(message)}`)
		frame:Destroy()
		Failed:Fire(def.id, def.title)
		return false
	end
	entry.frame = frame
	entry.scale = scale
	entry.closeButton = closeButton
	return true
end

local function setBackdrop(visible: boolean)
	backdropToken += 1
	local token = backdropToken
	if visible then
		backdrop.Visible = true
		-- Frees the mouse while a window is open (first person / shift lock).
		backdrop.Modal = true
		Kit.tween(backdrop, OPEN_TIME, { BackgroundTransparency = Theme.BackdropTransparency })
	else
		backdrop.Modal = false
		local tween = Kit.tween(backdrop, CLOSE_TIME, { BackgroundTransparency = 1 })
		tween.Completed:Connect(function()
			if backdropToken == token then
				backdrop.Visible = false
			end
		end)
	end
end

local function setPromptsEnabled(enabled: boolean)
	for _, record in stands do
		record.prompt.Enabled = enabled
	end
end

local function showWindow(entry: Entry)
	local frame, scale = entry.frame, entry.scale
	if not frame or not scale then
		return
	end
	entry.token += 1
	local running = entry.tween
	if running then
		running:Cancel()
	end
	local target = windowScaleFor(windowSize(entry))
	scale.Scale = target * 0.7
	frame.Visible = true
	entry.tween = Kit.tween(scale, OPEN_TIME, { Scale = target }, Enum.EasingStyle.Back)
	if string.sub(UserInputService:GetLastInputType().Name, 1, 7) == "Gamepad" then
		local closeButton = entry.closeButton
		if closeButton then
			GuiService.SelectedObject = closeButton.instance
		end
	end
end

local function hideWindow(entry: Entry, instant: boolean)
	local frame, scale = entry.frame, entry.scale
	if not frame or not scale then
		return
	end
	entry.token += 1
	local token = entry.token
	local selected = GuiService.SelectedObject
	if selected and selected:IsDescendantOf(frame) then
		GuiService.SelectedObject = nil
	end
	local running = entry.tween
	if running then
		running:Cancel()
		entry.tween = nil
	end
	if instant then
		frame.Visible = false
		return
	end
	local goal = windowScaleFor(windowSize(entry)) * 0.8
	local tween = Kit.tween(scale, CLOSE_TIME, { Scale = goal }, Enum.EasingStyle.Quad, Enum.EasingDirection.In)
	entry.tween = tween
	tween.Completed:Connect(function()
		if entry.token == token then
			frame.Visible = false
		end
	end)
end

local function runCallback(entry: Entry, name: string, callback: ((...any) -> ...any)?, ...: any)
	if callback then
		local ok, message = xpcall(callback, traceback, ...)
		if not ok then
			warn(`[WindowManager] {name} of window "{entry.def.id}" failed: {tostring(message)}`)
		end
	end
end

-- Hides the open window and runs its close hooks. `switching` = another window opens right away.
local function closeCurrent(switching: boolean)
	local entry = current
	if not entry then
		return
	end
	current = nil
	hideWindow(entry, switching)
	if not switching then
		setBackdrop(false)
		setPromptsEnabled(true)
		Sound.play("Close")
	end
	runCallback(entry, "onClose", entry.def.onClose :: any)
	Closed:Fire(entry.def.id)
end

---------------------------------------------------------------------------------------------------
-- Public API: windows

-- Registers a window (windows call this from their Init). The window is built lazily on its first open.
function WindowManager.register(def: WindowDef)
	if type(def) ~= "table" or type(def.id) ~= "string" or def.id == "" then
		error("WindowManager.register: def.id must be a non-empty string", 2)
	end
	if type(def.build) ~= "function" then
		error(`WindowManager.register: window "{def.id}" needs a build function`, 2)
	end
	if registered[def.id] then
		warn(`[WindowManager] window "{def.id}" is already registered; ignoring the second registration`)
		return
	end
	registered[def.id] =
		{ def = def, frame = nil, scale = nil, closeButton = nil, building = false, token = 0, tween = nil }
	for _, record in stands do
		record.refresh()
	end
	Registered:Fire(def.id)
end

-- Opens a window (closing the one that is open). `args` is passed to the window's onOpen; opening the window
-- that is already open just calls onOpen again (e.g. to switch tab). Unknown ids only warn.
function WindowManager.open(id: string, args: any?)
	local entry = registered[id]
	if not entry then
		warn(`[WindowManager] cannot open unknown window "{tostring(id)}"`)
		return
	end
	if current == entry then
		runCallback(entry, "onOpen", entry.def.onOpen :: any, args)
		return
	end
	if not ensureBuilt(entry) then
		return
	end
	if current == entry then
		return -- opened by a nested call while it was building
	end
	local switching = current ~= nil
	if switching then
		closeCurrent(true)
	end
	current = entry
	if not switching then
		setBackdrop(true)
		setPromptsEnabled(false)
	end
	showWindow(entry)
	Sound.play("Open")
	runCallback(entry, "onOpen", entry.def.onOpen :: any, args)
	Opened:Fire(id)
end

-- Closes the open window, if any.
function WindowManager.close()
	closeCurrent(false)
end

-- Opens the window, or closes it when it is the open one.
function WindowManager.toggle(id: string)
	local entry = current
	if entry and entry.def.id == id then
		WindowManager.close()
	else
		WindowManager.open(id)
	end
end

-- isOpen("Shop"): is that window open?  isOpen(): is any window open?
function WindowManager.isOpen(id: string?): boolean
	local entry = current
	if not entry then
		return false
	end
	return id == nil or entry.def.id == id
end

-- Id of the open window, or nil.
function WindowManager.getOpenId(): string?
	local entry = current
	return if entry then entry.def.id else nil
end

-- All registered window definitions, sorted by `order` (then id). A fresh array on every call.
function WindowManager.getRegistered(): { WindowDef }
	local list: { WindowDef } = {}
	for _, entry in registered do
		table.insert(list, entry.def)
	end
	table.sort(list, function(a: WindowDef, b: WindowDef): boolean
		if a.order ~= b.order then
			return a.order < b.order
		end
		return a.id < b.id
	end)
	return list
end

---------------------------------------------------------------------------------------------------
-- Public API: layers and scale

-- The shared ScreenGui ("HUD": ResetOnSpawn off, full screen, ZIndexBehavior Sibling).
function WindowManager.getScreenGui(): ScreenGui
	return screenGui
end

-- Full-screen design-pixel Frame for HUD widgets (behind windows).
function WindowManager.getHudLayer(): Frame
	return hudLayer
end

-- The Frame that holds the backdrop and the windows. Managed by WindowManager; exposed for tests and tools.
function WindowManager.getWindowLayer(): Frame
	return windowLayer
end

-- Full-screen design-pixel Frame above the windows, for feature overlays (egg hatch) and dialogs.
function WindowManager.getOverlayLayer(): Frame
	return overlayLayer
end

-- Full-screen design-pixel Frame above everything, for toasts / popups / banners.
function WindowManager.getNotificationLayer(): Frame
	return notificationLayer
end

-- Real pixels per design pixel in the HUD / overlay / notification layers.
function WindowManager.getScale(): number
	return uiScale
end

-- Size of the full-screen layers in design pixels (1920x1080 on a 16:9 screen; wider or taller otherwise).
function WindowManager.getDesignSize(): Vector2
	local viewport = viewportSize()
	return Vector2.new(viewport.X / uiScale, viewport.Y / uiScale)
end

-- Height of Roblox's top bar in design pixels. Its buttons sit top-left; keep that corner clear.
function WindowManager.getTopInset(): number
	return topInsetPixels / uiScale
end

-- True on phone-sized screens, where the UI scale is clamped to its minimum and space is tight.
function WindowManager.isCompact(): boolean
	return compact
end

---------------------------------------------------------------------------------------------------
-- Public API: modals

-- Registers `dismiss` as the top-most modal: Escape / gamepad B call it instead of closing the window.
-- Returns a function that unregisters it (call it when the modal goes away, however it was closed).
function WindowManager.pushModal(dismiss: () -> ()): () -> ()
	local modal: Modal = { dismiss = dismiss }
	table.insert(modals, modal)
	return function()
		local index = table.find(modals, modal)
		if index then
			table.remove(modals, index)
		end
	end
end

UserInputService.InputBegan:Connect(function(input: InputObject)
	if input.KeyCode ~= Enum.KeyCode.ButtonB and input.KeyCode ~= Enum.KeyCode.Escape then
		return
	end
	if UserInputService:GetFocusedTextBox() then
		return -- the key belongs to the text box
	end
	local modal = modals[#modals]
	if modal then
		local ok, message = xpcall(modal.dismiss :: (...any) -> ...any, traceback)
		if not ok then
			warn(`[WindowManager] modal dismiss failed: {tostring(message)}`)
		end
	elseif current then
		WindowManager.close()
	end
end)

backdrop.Activated:Connect(function()
	WindowManager.close()
end)

---------------------------------------------------------------------------------------------------
-- ShopStand prompts

local function attachStand(stand: Instance)
	if stands[stand] then
		return
	end
	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "WindowPrompt"
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = PROMPT_DISTANCE
	prompt.RequiresLineOfSight = false
	prompt.ClickablePrompt = true
	prompt.KeyboardKeyCode = WindowManager.PromptKey
	prompt.GamepadKeyCode = WindowManager.PromptGamepadKey
	prompt.Enabled = current == nil

	local function refresh()
		local label = stand:GetAttribute("Label")
		local windowId = stand:GetAttribute("Window")
		prompt.ActionText = if type(label) == "string" and label ~= "" then label else "Open"
		if type(windowId) == "string" then
			local entry = registered[windowId]
			prompt.ObjectText = if entry then entry.def.title else windowId
		else
			prompt.ObjectText = ""
		end
	end
	refresh()

	local connections = {
		stand:GetAttributeChangedSignal("Label"):Connect(refresh),
		stand:GetAttributeChangedSignal("Window"):Connect(refresh),
		prompt.Triggered:Connect(function()
			local windowId = stand:GetAttribute("Window")
			if type(windowId) == "string" then
				WindowManager.open(windowId)
			end
		end),
	}
	stands[stand] = { prompt = prompt, connections = connections, refresh = refresh }
	prompt.Parent = stand
end

local function detachStand(stand: Instance)
	local record = stands[stand]
	if not record then
		return
	end
	stands[stand] = nil
	for _, connection in record.connections do
		connection:Disconnect()
	end
	record.prompt:Destroy()
end

CollectionService:GetInstanceAddedSignal(STAND_TAG):Connect(attachStand)
CollectionService:GetInstanceRemovedSignal(STAND_TAG):Connect(detachStand)
for _, stand in CollectionService:GetTagged(STAND_TAG) do
	attachStand(stand)
end

---------------------------------------------------------------------------------------------------
-- Boot

local function watchCamera()
	local camera = workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(refreshScale)
	end
	refreshScale()
end

Kit.setHost({ overlay = overlayLayer, pushModal = WindowManager.pushModal })
screenGui.Parent = playerGui
screenGui:GetPropertyChangedSignal("AbsoluteSize"):Connect(refreshScale)
workspace:GetPropertyChangedSignal("CurrentCamera"):Connect(watchCamera)
watchCamera()

return WindowManager
