--!strict
--[[
	Kit — the UI component library. Every window and HUD widget is built from these builders so the whole game
	shares one chunky cartoon style (spec §14; all numbers come from UI/Theme).

	    local Kit = require(Client:WaitForChild("UI"):WaitForChild("Kit"))

	RULES OF THE KIT
	  * Units are DESIGN PIXELS (1920x1080 reference). Everything you build sits under a UIScale owned by
	    WindowManager (window content frames and the HUD / overlay layers), so never compute screen scale yourself.
	  * Every builder takes ONE props table. All of them accept the same layout fields:
	        parent, name, size (UDim2), position (UDim2), anchor (Vector2), layoutOrder, zIndex, visible
	    `parent` is applied last, so the instance appears fully built.
	  * Static pieces return the Instance (label, panel, divider, scrollList ...). Stateful components return a
	    HANDLE: a table with `.instance` (the root GuiObject) and methods called with a COLON:
	        button:setText("Buy")     bar:set(0.5, "5 / 10")     tabs:select("gems")
	    Methods that set a value from code (toggle:set, slider:set, ...) never call your onChange callback;
	    callbacks only run for the player's own input. (tabs:select is the exception, see Kit.tabs.)
	  * Buttons work with mouse, touch and gamepad (they use Activated) and play the "Click" sound themselves.
	  * Destroy what you build with instance:Destroy() (or Kit.clear(parent)); the Kit cleans its own state up.

	INDEX
	  Building blocks
	    Kit.create(className, props?, children?)     any Instance from a property table
	    Kit.frame(props?)                            transparent container Frame
	    Kit.row(props?) / Kit.column(props?)         container Frame with a horizontal / vertical UIListLayout
	    Kit.corner(parent, radius?)                  UICorner            Kit.stroke(parent, thickness?, color?)  outline
	    Kit.textStroke(label, thickness?, color?)    text outline        Kit.gradient(parent, colors, rotation?)
	    Kit.padding(parent, vertical, horizontal?)   UIPadding           Kit.listLayout(parent, props?) / Kit.gridLayout
	    Kit.clear(parent)                            destroy all child GuiObjects (keeps layouts and decorations)
	  Text
	    Kit.label(props)                             TextLabel in a text style ("title", "heading", "body" ...)
	    Kit.icon(props)                              emoji icon
	    Kit.measureText(text, textSize, font?)       width a text needs, in design px
	    Kit.priceTag(props) -> PriceTag              "🪙 12.5K" / "💎 340" / "R$ 399"; Kit.priceText(currency, amount)
	  Surfaces
	    Kit.panel(props)                             dark rounded panel with the thick outline
	    Kit.titleBar(props) -> bar, label            gold title bar capping a window / popup
	    Kit.card(props) -> Card                      card with outline that can show rarity / highlight / selection
	    Kit.divider(props)                           thin separator line
	    Kit.ribbon(props)                            "BEST VALUE" corner ribbon
	    Kit.badge(props) -> Badge                    red notification dot with a count
	    Kit.emptyState(props)                        centred icon + text (+ button) for empty lists
	  Controls
	    Kit.button(props) -> Button                  the button (styles, icon, disabled state, hold-to-repeat)
	    Kit.toggle(props) -> Toggle                  on/off switch
	    Kit.slider(props) -> Slider                  draggable value
	    Kit.tabs(props) -> Tabs                      pill tabs that can show/hide pages
	    Kit.textInput(props) -> TextInput            text box
	    Kit.progressBar(props) -> ProgressBar        bar:set(fraction, text?)
	    Kit.scrollList(props) / Kit.scrollGrid(props)   ScrollingFrame with a list / grid layout
	    Kit.viewport(model, props?) -> Viewport      3D preview of a Model, optional slow spin
	    Kit.confirm(title, text, onYes, options?)    modal yes/no dialog
	  Motion and feedback
	    Kit.tween(instance, time, goals, style?, direction?)   play a tween
	    Kit.pop(instance, from?, duration?)          one bouncy scale-in
	    Kit.pulse(instance, options?) -> stop        looping "look at me" pulse
	    Kit.feedback(button, options?)               hover / press feedback + click sound for ANY GuiButton
	    Kit.rainbow(gradient) -> stop                animated rainbow on a UIGradient
	  Rarity
	    Kit.rarityColor(rarity)   Kit.rarityGradient(rarity)   Kit.applyRarity(stroke, rarity)

	WORKED EXAMPLE — a window with two tabs, a grid of cards (3D preview, text, buy button) and a progress bar:

	    WindowManager.register({
	        id = "Hammers", title = "Hammers", icon = "🔨", order = 3, showInMenu = true,
	        build = function(content, handle)            -- content: empty Frame filling the window below the title
	            local pageSize = UDim2.new(1, 0, 1, -(Theme.Size.TabBar + Theme.Size.Gap))
	            local pagePosition = UDim2.fromOffset(0, Theme.Size.TabBar + Theme.Size.Gap)
	            local shopPage = Kit.scrollGrid({ columns = 4, cellHeight = 300, size = pageSize,
	                position = pagePosition, parent = content })
	            local statsPage = Kit.frame({ size = pageSize, position = pagePosition, parent = content })
	            Kit.tabs({
	                tabs = {
	                    { id = "shop", text = "Shop", icon = "🛒", page = shopPage },    -- pages are shown/hidden for you
	                    { id = "stats", text = "Stats", icon = "📊", page = statsPage },
	                },
	                parent = content,
	            })

	            for order, def in Config.Hammers.list do
	                local card = Kit.card({ layoutOrder = order, parent = shopPage })
	                Kit.viewport(HammerVisuals.buildModel(def.id), { size = UDim2.new(1, 0, 0, 130), parent = card.instance })
	                Kit.label({ text = def.name, style = "heading", size = UDim2.new(1, 0, 0, 36),
	                    position = UDim2.fromOffset(0, 136), parent = card.instance })
	                Kit.label({ text = "Damage " .. NumberFormat.abbreviate(def.damage), color = Theme.Color.TextMuted,
	                    size = UDim2.new(1, 0, 0, 28), position = UDim2.fromOffset(0, 174), parent = card.instance })
	                local buy: Kit.Button
	                buy = Kit.button({
	                    text = Kit.priceText("coins", def.cost), style = "success",
	                    size = UDim2.new(1, 0, 0, 56), anchor = Vector2.new(0, 1), position = UDim2.fromScale(0, 1),
	                    parent = card.instance,
	                    onClick = function()
	                        local ok, message = Net.request("BuyHammer", def.id)
	                        if ok then
	                            buy:setText("OWNED")
	                            buy:setStyle("neutral")
	                            card:setHighlight(Theme.Color.Success)
	                        else
	                            Notifications.toast("error", message)
	                        end
	                    end,
	                })
	            end

	            local bar = Kit.progressBar({ fraction = 0.4, text = "4 / 10 hammers", size = UDim2.new(1, 0, 0, 36),
	                parent = statsPage })
	            bar:set(0.5, "5 / 10 hammers")               -- animates to the new value
	        end,
	    })
]]

local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TextService = game:GetService("TextService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))

local Client = ReplicatedStorage:WaitForChild("Client")
local Theme = require(Client:WaitForChild("UI"):WaitForChild("Theme"))
local Sound = require(Client:WaitForChild("Core"):WaitForChild("Sound"))

local Kit = {}

export type ButtonStyle = Theme.ButtonStyle
export type TextStyle = Theme.TextStyle
export type Currency = Theme.Currency
export type AlignX = "left" | "center" | "right"
export type AlignY = "top" | "center" | "bottom"

local TEXT_X: { [string]: Enum.TextXAlignment } = {
	left = Enum.TextXAlignment.Left,
	center = Enum.TextXAlignment.Center,
	right = Enum.TextXAlignment.Right,
}
local TEXT_Y: { [string]: Enum.TextYAlignment } = {
	top = Enum.TextYAlignment.Top,
	center = Enum.TextYAlignment.Center,
	bottom = Enum.TextYAlignment.Bottom,
}
local LAYOUT_X: { [string]: Enum.HorizontalAlignment } = {
	left = Enum.HorizontalAlignment.Left,
	center = Enum.HorizontalAlignment.Center,
	right = Enum.HorizontalAlignment.Right,
}
local LAYOUT_Y: { [string]: Enum.VerticalAlignment } = {
	top = Enum.VerticalAlignment.Top,
	center = Enum.VerticalAlignment.Center,
	bottom = Enum.VerticalAlignment.Bottom,
}

local WHITE = Color3.new(1, 1, 1)
local MIN_TEXT_SIZE = 8

-- Applies the layout fields every props table shares. Called last by each builder so Parent is set last.
local function place(object: GuiObject, props: any, defaultName: string?)
	if props.name ~= nil then
		object.Name = props.name
	elseif defaultName then
		object.Name = defaultName
	end
	if props.size ~= nil then
		object.Size = props.size
	end
	if props.position ~= nil then
		object.Position = props.position
	end
	if props.anchor ~= nil then
		object.AnchorPoint = props.anchor
	end
	if props.layoutOrder ~= nil then
		object.LayoutOrder = props.layoutOrder
	end
	if props.zIndex ~= nil then
		object.ZIndex = props.zIndex
	end
	if props.visible ~= nil then
		object.Visible = props.visible
	end
	if props.parent ~= nil then
		object.Parent = props.parent
	end
end

local function isGamepadActive(): boolean
	local last = UserInputService:GetLastInputType()
	return string.sub(last.Name, 1, 7) == "Gamepad"
end

local function isPressInput(input: InputObject): boolean
	return input.UserInputType == Enum.UserInputType.MouseButton1
		or input.UserInputType == Enum.UserInputType.Touch
		or input.KeyCode == Enum.KeyCode.ButtonA
end

---------------------------------------------------------------------------------------------------
-- Building blocks

-- Generic constructor. `props` maps property names to values ("Parent" is applied last); a function value is
-- connected to the event of that name. `children` are parented to the new instance. Returns Instance — cast it:
--     local frame = Kit.create("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1 }) :: Frame
--     Kit.create("TextButton", { Text = "Hi", Activated = function() print("clicked") end, Parent = frame })
function Kit.create(className: string, props: { [string]: any }?, children: { Instance }?): Instance
	local instance = Instance.new(className)
	local dynamic = instance :: any
	local parent: Instance? = nil
	if props then
		for key, value in props do
			if key == "Parent" then
				parent = value
			elseif type(value) == "function" then
				dynamic[key]:Connect(value)
			else
				dynamic[key] = value
			end
		end
	end
	if children then
		for _, child in children do
			child.Parent = instance
		end
	end
	if parent then
		instance.Parent = parent
	end
	return instance
end

-- Rounded corners. `radius` in design px (default Theme.Corner.Card); Theme.Corner.Pill (or any value >= 1000)
-- makes a full pill / circle.
--     Kit.corner(frame, Theme.Corner.Button)
function Kit.corner(parent: Instance, radius: number?): UICorner
	local corner = Instance.new("UICorner")
	local pixels = radius or Theme.Corner.Card
	corner.CornerRadius = if pixels >= 1000 then UDim.new(1, 0) else UDim.new(0, pixels)
	corner.Parent = parent
	return corner
end

-- The dark outline around a frame or button (border stroke). Defaults: Theme.Stroke.Thick, Theme.Color.Outline.
--     Kit.stroke(frame)      Kit.stroke(chip, Theme.Stroke.Thin, Theme.Color.Gems)
function Kit.stroke(parent: Instance, thickness: number?, color: Color3?): UIStroke
	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.LineJoinMode = Enum.LineJoinMode.Round
	stroke.Thickness = thickness or Theme.Stroke.Thick
	stroke.Color = color or Theme.Color.Outline
	stroke.Parent = parent
	return stroke
end

-- Dark outline around the TEXT of a TextLabel / TextButton / TextBox (Kit.label adds one itself for display
-- styles). Defaults: Theme.Stroke.Text, Theme.Color.Outline.
function Kit.textStroke(label: Instance, thickness: number?, color: Color3?): UIStroke
	local stroke = Instance.new("UIStroke")
	stroke.Name = "TextStroke"
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual
	stroke.LineJoinMode = Enum.LineJoinMode.Round
	stroke.Thickness = thickness or Theme.Stroke.Text
	stroke.Color = color or Theme.Color.Outline
	stroke.Parent = label
	return stroke
end

-- UIGradient; `rotation` defaults to 90 (top → bottom). The parent's BackgroundColor3 should be white.
--     Kit.gradient(frame, Theme.Gradient.Gold)      Kit.gradient(bar, Theme.vertical(top, bottom))
function Kit.gradient(parent: Instance, colors: ColorSequence, rotation: number?): UIGradient
	local gradient = Instance.new("UIGradient")
	gradient.Color = colors
	gradient.Rotation = rotation or 90
	gradient.Parent = parent
	return gradient
end

-- UIPadding: Kit.padding(frame, 12) pads all sides; Kit.padding(frame, 8, 20) = 8 top/bottom, 20 left/right.
function Kit.padding(parent: Instance, vertical: number, horizontal: number?): UIPadding
	local padding = Instance.new("UIPadding")
	local sides = horizontal or vertical
	padding.PaddingTop = UDim.new(0, vertical)
	padding.PaddingBottom = UDim.new(0, vertical)
	padding.PaddingLeft = UDim.new(0, sides)
	padding.PaddingRight = UDim.new(0, sides)
	padding.Parent = parent
	return padding
end

export type ListLayoutProps = {
	horizontal: boolean?, -- default false (vertical)
	gap: number?, -- px between items, default Theme.Size.Gap
	alignX: AlignX?, -- default "center"
	alignY: AlignY?, -- default "top" (vertical lists) / "center" (horizontal lists)
	wraps: boolean?, -- wrap onto new lines when full
}

-- UIListLayout sorted by LayoutOrder.
--     Kit.listLayout(column, { gap = 8, alignX = "left" })     Kit.listLayout(rowFrame, { horizontal = true })
function Kit.listLayout(parent: Instance, props: ListLayoutProps?): UIListLayout
	local options: ListLayoutProps = props or {}
	local horizontal = options.horizontal == true
	local layout = Instance.new("UIListLayout")
	layout.FillDirection = if horizontal then Enum.FillDirection.Horizontal else Enum.FillDirection.Vertical
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Padding = UDim.new(0, options.gap or Theme.Size.Gap)
	layout.HorizontalAlignment = LAYOUT_X[options.alignX or "center"]
	layout.VerticalAlignment = LAYOUT_Y[options.alignY or (if horizontal then "center" else "top")]
	layout.Wraps = options.wraps == true
	layout.Parent = parent
	return layout
end

export type GridLayoutProps = {
	cellSize: UDim2,
	gap: number?, -- px between cells, default Theme.Size.Gap
	alignX: AlignX?, -- default "left"
	alignY: AlignY?, -- default "top"
	maxPerLine: number?, -- FillDirectionMaxCells
}

-- UIGridLayout sorted by LayoutOrder (Kit.scrollGrid is usually what you want).
--     Kit.gridLayout(frame, { cellSize = UDim2.fromOffset(120, 120), gap = 10 })
function Kit.gridLayout(parent: Instance, props: GridLayoutProps): UIGridLayout
	local gap = props.gap or Theme.Size.Gap
	local layout = Instance.new("UIGridLayout")
	layout.CellSize = props.cellSize
	layout.CellPadding = UDim2.fromOffset(gap, gap)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.HorizontalAlignment = LAYOUT_X[props.alignX or "left"]
	layout.VerticalAlignment = LAYOUT_Y[props.alignY or "top"]
	if props.maxPerLine then
		layout.FillDirectionMaxCells = props.maxPerLine
	end
	layout.Parent = parent
	return layout
end

export type FrameProps = {
	color: Color3?, -- background colour; omitted = transparent
	transparency: number?,
	corner: number?,
	clips: boolean?, -- ClipsDescendants
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Plain container Frame: transparent and filling its parent unless told otherwise.
--     local page = Kit.frame({ parent = content })
--     local chip = Kit.frame({ color = Theme.Color.Inset, corner = Theme.Corner.Small, size = UDim2.fromOffset(90, 30) })
function Kit.frame(props: FrameProps): Frame
	local options: FrameProps = props
	local frame = Instance.new("Frame")
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	if options.color then
		frame.BackgroundColor3 = options.color
		frame.BackgroundTransparency = options.transparency or 0
	else
		frame.BackgroundTransparency = 1
	end
	if options.clips then
		frame.ClipsDescendants = true
	end
	if options.corner then
		Kit.corner(frame, options.corner)
	end
	place(frame, options, "Frame")
	return frame
end

export type StackProps = {
	gap: number?,
	alignX: AlignX?,
	alignY: AlignY?,
	wraps: boolean?,
	parent: Instance?,
	name: string?,
	size: UDim2?,
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

local function stack(props: StackProps, horizontal: boolean): Frame
	local options: StackProps = props
	local frame = Instance.new("Frame")
	frame.BackgroundTransparency = 1
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	Kit.listLayout(frame, {
		horizontal = horizontal,
		gap = options.gap,
		alignX = options.alignX,
		alignY = options.alignY,
		wraps = options.wraps,
	})
	place(frame, options, if horizontal then "Row" else "Column")
	return frame
end

-- Transparent Frame whose children line up left → right (UIListLayout, sorted by LayoutOrder).
--     local row = Kit.row({ gap = 10, alignX = "right", size = UDim2.new(1, 0, 0, 60), parent = content })
function Kit.row(props: StackProps): Frame
	return stack(props, true)
end

-- Transparent Frame whose children stack top → bottom.
--     local column = Kit.column({ gap = 8, parent = card.instance })
function Kit.column(props: StackProps): Frame
	return stack(props, false)
end

-- Destroys every child GuiObject of `parent` (layouts, paddings, corners and strokes stay). Use it before
-- re-filling a list.
function Kit.clear(parent: Instance)
	for _, child in parent:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end
end

---------------------------------------------------------------------------------------------------
-- Motion: one shared animator drives every scale effect (hover/press feedback, pop, pulse), so they compose
-- instead of cancelling each other, and nothing runs while nothing is animating.

type ScaleEntry = {
	scale: UIScale,
	goal: number, -- feedback goal: 1 idle, > 1 hover, < 1 pressed
	value: number, -- smoothed feedback value
	pulseAmount: number, -- 0 = not pulsing
	pulsePeriod: number,
	pulseClock: number,
	popFrom: number,
	popDuration: number, -- 0 = no pop running
	popElapsed: number,
	active: boolean,
	dead: boolean,
}

local SCALE_NAME = "KitScale"
local FEEDBACK_SPEED = 22
local BACK_OVERSHOOT = 1.70158

local scaleEntries: { [GuiObject]: ScaleEntry } = {}
local activeScales: { ScaleEntry } = {}
local scaleConnection: RBXScriptConnection? = nil

local function backOut(alpha: number): number
	local u = alpha - 1
	return 1 + (BACK_OVERSHOOT + 1) * u * u * u + BACK_OVERSHOOT * u * u
end

local function stepScales(dt: number)
	for index = #activeScales, 1, -1 do
		local entry = activeScales[index]
		local busy = false
		if not entry.dead then
			local difference = entry.goal - entry.value
			if math.abs(difference) > 0.002 then
				entry.value += difference * math.min(1, dt * FEEDBACK_SPEED)
				busy = true
			else
				entry.value = entry.goal
			end
			local factor = entry.value
			if entry.pulseAmount > 0 then
				entry.pulseClock += dt
				local phase = entry.pulseClock / entry.pulsePeriod * 2 * math.pi
				factor *= 1 + entry.pulseAmount * 0.5 * (1 - math.cos(phase))
				busy = true
			end
			if entry.popDuration > 0 then
				entry.popElapsed += dt
				local alpha = entry.popElapsed / entry.popDuration
				if alpha >= 1 then
					entry.popDuration = 0
				else
					factor *= entry.popFrom + (1 - entry.popFrom) * backOut(alpha)
					busy = true
				end
			end
			entry.scale.Scale = factor
		end
		if not busy then
			entry.active = false
			local last = #activeScales
			activeScales[index] = activeScales[last]
			activeScales[last] = nil
		end
	end
	if #activeScales == 0 and scaleConnection then
		scaleConnection:Disconnect()
		scaleConnection = nil
	end
end

local function scaleEntryFor(target: GuiObject): ScaleEntry
	local existing = scaleEntries[target]
	if existing then
		return existing
	end
	local found = target:FindFirstChild(SCALE_NAME)
	local scale: UIScale
	if found and found:IsA("UIScale") then
		scale = found
	else
		scale = Instance.new("UIScale")
		scale.Name = SCALE_NAME
		scale.Parent = target
	end
	local entry: ScaleEntry = {
		scale = scale,
		goal = 1,
		value = 1,
		pulseAmount = 0,
		pulsePeriod = 1,
		pulseClock = 0,
		popFrom = 1,
		popDuration = 0,
		popElapsed = 0,
		active = false,
		dead = false,
	}
	scaleEntries[target] = entry
	target.Destroying:Connect(function()
		scaleEntries[target] = nil
		entry.dead = true
	end)
	return entry
end

local function wakeScale(entry: ScaleEntry)
	if entry.active or entry.dead then
		return
	end
	entry.active = true
	table.insert(activeScales, entry)
	if not scaleConnection then
		scaleConnection = RunService.Heartbeat:Connect(stepScales)
	end
end

local function startPop(target: GuiObject, from: number, duration: number)
	local entry = scaleEntryFor(target)
	entry.popFrom = from
	entry.popDuration = math.max(duration, 0.01)
	entry.popElapsed = 0
	entry.scale.Scale = entry.value * from
	wakeScale(entry)
end

-- Creates and plays a tween. Default easing: Quad Out.
--     Kit.tween(frame, 0.2, { BackgroundTransparency = 0.5 })
--     Kit.tween(label, 0.4, { Position = UDim2.fromScale(0.5, 0.2) }, Enum.EasingStyle.Back)
function Kit.tween(
	instance: Instance,
	time: number,
	goals: { [string]: any },
	style: Enum.EasingStyle?,
	direction: Enum.EasingDirection?
): Tween
	local info = TweenInfo.new(time, style or Enum.EasingStyle.Quad, direction or Enum.EasingDirection.Out)
	local tween = TweenService:Create(instance, info, goals)
	tween:Play()
	return tween
end

-- One bouncy scale-in: the instance grows from `from` (default 0.6) to full size in `duration` (default 0.25 s)
-- with a little overshoot. Scales around the instance's AnchorPoint via a UIScale child named "KitScale"
-- (do not use on an instance that has its own UIScale).
--     Kit.pop(rewardCard)        Kit.pop(icon, 0.3, 0.4)
function Kit.pop(instance: GuiObject, from: number?, duration: number?)
	startPop(instance, from or 0.6, duration or 0.25)
end

export type PulseOptions = {
	amount: number?, -- extra scale at the peak, default 0.08 (= 108%)
	period: number?, -- seconds per pulse, default 0.9
}

-- Looping attention animation: the instance gently grows and shrinks until the returned function is called
-- (or the instance is destroyed). Composes with Kit.feedback and Kit.pop on the same instance. Inside a
-- UIListLayout the neighbours move with it, so pulse an inner, centre-anchored element there
-- (for Kit buttons simply use button:pulse(true)).
--     local stop = Kit.pulse(claimIcon)   ...   stop()
function Kit.pulse(instance: GuiObject, options: PulseOptions?): () -> ()
	local entry = scaleEntryFor(instance)
	entry.pulseAmount = math.max((options and options.amount) or 0.08, 0.001)
	entry.pulsePeriod = math.max((options and options.period) or 0.9, 0.05)
	entry.pulseClock = 0
	wakeScale(entry)
	return function()
		entry.pulseAmount = 0
		wakeScale(entry) -- one more step so the scale settles back to its resting value
	end
end

export type FeedbackOptions = {
	target: GuiObject?, -- what scales (default: the button itself). Pass a centre-anchored child to keep layouts still
	sound: string?, -- Config.Sounds name played on click, default "Click"; "" = silent
	hoverScale: number?, -- default 1.04
	pressScale: number?, -- default 0.94
}

-- Wires hover / press / gamepad-selection feedback. Returns a function that drops the hover/press state.
local function attachFeedback(button: GuiButton, target: GuiObject, hoverScale: number, pressScale: number): () -> ()
	local entry = scaleEntryFor(target)
	local hovering = false
	local pressing = false
	local function update()
		entry.goal = if pressing then pressScale elseif hovering then hoverScale else 1
		wakeScale(entry)
	end
	button.MouseEnter:Connect(function()
		hovering = true
		if button.Interactable and UserInputService:GetLastInputType() == Enum.UserInputType.MouseMovement then
			Sound.play("Hover")
		end
		update()
	end)
	button.MouseLeave:Connect(function()
		hovering = false
		pressing = false
		update()
	end)
	button.SelectionGained:Connect(function()
		hovering = true
		update()
	end)
	button.SelectionLost:Connect(function()
		hovering = false
		pressing = false
		update()
	end)
	button.MouseButton1Down:Connect(function()
		pressing = true
		update()
	end)
	button.MouseButton1Up:Connect(function()
		pressing = false
		-- A finger leaves no hover behind (MouseLeave is unreliable on touch screens).
		if UserInputService:GetLastInputType() == Enum.UserInputType.Touch then
			hovering = false
		end
		update()
	end)
	return function()
		hovering = false
		pressing = false
		update()
	end
end

-- Gives ANY GuiButton (TextButton / ImageButton you built yourself) the standard feel: grows a little on hover
-- and gamepad selection, shrinks while pressed, plays the click sound on Activated. Kit.button, Kit.tabs,
-- Kit.toggle ... already have it. The scale is applied around the target's AnchorPoint; inside a UIListLayout
-- pass `target` = an inner centre-anchored child so the neighbours do not move.
--     Kit.feedback(menuButton)      Kit.feedback(hit, { target = icon, sound = "Equip" })
function Kit.feedback(button: GuiButton, options: FeedbackOptions?)
	local target: GuiObject = (options and options.target) or button
	local soundName = if options and options.sound ~= nil then options.sound else "Click"
	button.AutoButtonColor = false
	attachFeedback(button, target, (options and options.hoverScale) or 1.04, (options and options.pressScale) or 0.94)
	if soundName ~= "" then
		button.Activated:Connect(function()
			Sound.play(soundName)
		end)
	end
end

-- Animates `gradient` as a rotating rainbow (used for Exclusive rarity). Returns a stop function; stops by
-- itself when the gradient is destroyed.
--     local stop = Kit.rainbow(Kit.gradient(stroke, Theme.Gradient.Rainbow))
function Kit.rainbow(gradient: UIGradient): () -> ()
	gradient.Color = Theme.Gradient.Rainbow
	local info = TweenInfo.new(4, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1)
	local tween = TweenService:Create(gradient, info, { Rotation = gradient.Rotation + 360 })
	tween:Play()
	local stopped = false
	local function stop()
		if not stopped then
			stopped = true
			tween:Cancel()
			tween:Destroy()
		end
	end
	gradient.Destroying:Connect(stop)
	return stop
end

---------------------------------------------------------------------------------------------------
-- Rarity

-- Colour of a rarity id ("Common" ... "Exclusive"); unknown ids get the Common grey.
function Kit.rarityColor(rarity: string): Color3
	return Theme.rarityColor(rarity)
end

-- Gradient for a rarity-coloured surface (rainbow for Exclusive). Use with Kit.gradient(frame, ...).
function Kit.rarityGradient(rarity: string): ColorSequence
	return Theme.rarityGradient(rarity)
end

local RARITY_GRADIENT_NAME = "RarityGradient"

-- Colours a UIStroke by rarity; Exclusive gets the animated rainbow. Safe to call again with another rarity.
--     Kit.applyRarity(Kit.stroke(petIcon, Theme.Stroke.Medium), petDef.rarity)
function Kit.applyRarity(stroke: UIStroke, rarity: string)
	local old = stroke:FindFirstChild(RARITY_GRADIENT_NAME)
	if old then
		old:Destroy()
	end
	if Theme.isRainbow(rarity) then
		stroke.Color = WHITE
		local gradient = Instance.new("UIGradient")
		gradient.Name = RARITY_GRADIENT_NAME
		gradient.Rotation = 0
		gradient.Parent = stroke
		Kit.rainbow(gradient)
	else
		stroke.Color = Theme.rarityColor(rarity)
	end
end

---------------------------------------------------------------------------------------------------
-- Text

export type LabelProps = {
	text: string?,
	style: TextStyle?, -- "title" | "heading" | "button" | "number" (display) | "body" | "small"; default "body"
	color: Color3?, -- default white
	textSize: number?, -- design px; default from the style
	font: Enum.Font?,
	stroke: boolean?, -- dark text outline; default true for display styles, false for body/small
	scaled: boolean?, -- shrink to fit the label (never grows past textSize); default true for display styles
	wrap: boolean?, -- wrap lines (only when not scaled); default true
	alignX: AlignX?, -- default "center"
	alignY: AlignY?, -- default "center"
	rich: boolean?, -- RichText
	autoSize: Enum.AutomaticSize?,
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: full width, one line high
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Text in one of the Theme text styles. Display styles (title/heading/button/number) use FredokaOne, a dark
-- outline and shrink-to-fit; body/small use Gotham and wrap.
--     Kit.label({ text = "Sunny Meadow", style = "heading", parent = card.instance })
--     Kit.label({ text = "Double all coins, forever", color = Theme.Color.TextMuted, size = UDim2.new(1, 0, 0, 48) })
--     Kit.label({ text = "12.5K", style = "number", color = Theme.Color.Coins, alignX = "left" })
function Kit.label(props: LabelProps): TextLabel
	local style: string = props.style or "body"
	local font, defaultSize = Theme.textStyle(style)
	local textSize = props.textSize or defaultSize
	local display = style ~= "body" and style ~= "small"

	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.BorderSizePixel = 0
	label.Font = props.font or font
	label.Text = props.text or ""
	label.TextColor3 = props.color or Theme.Color.Text
	label.TextSize = textSize
	label.TextXAlignment = TEXT_X[props.alignX or "center"]
	label.TextYAlignment = TEXT_Y[props.alignY or "center"]
	label.RichText = props.rich == true
	label.Size = UDim2.new(1, 0, 0, math.ceil(textSize * 1.4))

	local scaled = if props.scaled ~= nil then props.scaled else display
	if scaled then
		label.TextScaled = true
		local limit = Instance.new("UITextSizeConstraint")
		limit.MaxTextSize = math.max(1, math.floor(textSize))
		limit.MinTextSize = math.min(MIN_TEXT_SIZE, math.max(1, math.floor(textSize)))
		limit.Parent = label
	else
		label.TextWrapped = props.wrap ~= false
	end
	if props.autoSize then
		label.AutomaticSize = props.autoSize
	end
	local outlined = if props.stroke ~= nil then props.stroke else display
	if outlined then
		Kit.textStroke(label, if textSize >= 24 then Theme.Stroke.Text else Theme.Stroke.TextThin)
	end
	place(label, props, "Label")
	return label
end

-- Width in design px that `text` needs on one line (an estimate when the engine cannot measure it).
-- `font` defaults to Theme.Font.Title.
--     local width = Kit.measureText("Sunny Meadow", Theme.TextSize.Heading) + 40
function Kit.measureText(text: string, textSize: number, font: Enum.Font?): number
	local ok, size = pcall(function(): Vector2
		return TextService:GetTextSize(text, textSize, font or Theme.Font.Title, Vector2.new(4000, 200))
	end)
	if ok and typeof(size) == "Vector2" then
		return size.X
	end
	return (utf8.len(text) or #text) * textSize * 0.55
end

export type IconProps = {
	icon: string, -- an emoji
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default 56x56
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Emoji icon that fills its box (change it later with label.Text = "🎁").
--     Kit.icon({ icon = "👑", size = UDim2.fromOffset(80, 80), anchor = Vector2.new(0.5, 0), position = UDim2.fromScale(0.5, 0), parent = card.instance })
function Kit.icon(props: IconProps): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.BorderSizePixel = 0
	label.Font = Theme.Font.Body
	label.Text = props.icon
	label.TextColor3 = WHITE
	label.TextScaled = true
	label.Size = UDim2.fromOffset(56, 56)
	place(label, props, "Icon")
	return label
end

-- "🪙 12.5K", "💎 340" or "R$ 1,999": the text Kit.priceTag shows; handy as a button text.
--     Kit.button({ text = Kit.priceText("gems", 30), style = "success" })
function Kit.priceText(currency: Currency, amount: number): string
	local icon = Theme.currencyIcon(currency)
	local value = if currency == "robux" then NumberFormat.commas(amount) else NumberFormat.abbreviate(amount)
	return if icon ~= "" then `{icon} {value}` else value
end

export type PriceTagProps = {
	currency: Currency, -- "coins" | "gems" | "robux"
	amount: number,
	textSize: number?, -- default Theme.TextSize.Number
	alignX: AlignX?,
	parent: Instance?,
	name: string?,
	size: UDim2?,
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type PriceTag = {
	instance: TextLabel,
	set: (self: PriceTag, amount: number) -> (),
	setAffordable: (self: PriceTag, affordable: boolean) -> (), -- false tints the price red
}

-- Currency amount in the currency's colour with its icon: 🪙 coins (yellow), 💎 gems (cyan), "R$" Robux (white).
--     local price = Kit.priceTag({ currency = "coins", amount = def.cost, parent = card.instance })
--     price:set(2500)     price:setAffordable(state.coins >= 2500)
function Kit.priceTag(props: PriceTagProps): PriceTag
	local currency: Currency = props.currency
	local label = Kit.label({
		text = Kit.priceText(currency, props.amount),
		style = "number",
		textSize = props.textSize,
		color = Theme.currencyColor(currency),
		alignX = props.alignX,
	})
	place(label, props, "PriceTag")
	local handle: PriceTag = {
		instance = label,
		set = function(_: any, amount: number)
			label.Text = Kit.priceText(currency, amount)
		end,
		setAffordable = function(_: any, affordable: boolean)
			label.TextColor3 = if affordable then Theme.currencyColor(currency) else Theme.Color.Error
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Surfaces

export type PanelProps = {
	inset: boolean?, -- dark "well" look (footers, slots) instead of the raised panel
	corner: number?, -- default Theme.Corner.Panel
	stroke: number?, -- outline thickness, 0 = none; default Theme.Stroke.Thick (inset: Thin)
	strokeColor: Color3?,
	gradient: ColorSequence?, -- default Theme.Gradient.Panel
	padding: number?, -- inner padding on all sides
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- The dark indigo rounded panel with the thick outline (HUD pills, popups, sections).
--     local pill = Kit.panel({ size = UDim2.fromOffset(220, 62), corner = Theme.Corner.Pill, parent = hudLayer })
--     local footer = Kit.panel({ inset = true, size = UDim2.new(1, 0, 0, 56), padding = 10, parent = content })
function Kit.panel(props: PanelProps): Frame
	local options: PanelProps = props
	local inset = options.inset == true
	local frame = Instance.new("Frame")
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	Kit.corner(frame, options.corner or Theme.Corner.Panel)
	if inset and not options.gradient then
		frame.BackgroundColor3 = Theme.Color.Inset
	else
		frame.BackgroundColor3 = WHITE
		Kit.gradient(frame, options.gradient or Theme.Gradient.Panel)
	end
	local thickness = options.stroke or (if inset then Theme.Stroke.Thin else Theme.Stroke.Thick)
	if thickness > 0 then
		Kit.stroke(frame, thickness, options.strokeColor)
	end
	if options.padding then
		Kit.padding(frame, options.padding)
	end
	place(frame, options, "Panel")
	return frame
end

export type TitleBarProps = {
	text: string, -- "🛒 Shop"
	height: number?, -- default Theme.Size.TitleBar
	corner: number?, -- radius of the top corners = radius of the surface it caps, default Theme.Corner.Window
	textSize: number?, -- default Theme.TextSize.Title
	sideSpace: number?, -- px kept free left and right of the title (close button), default 110
	parent: Instance?,
	name: string?,
	zIndex: number?,
}

-- The gold title bar that caps a window or popup: rounded top corners, dark line below, big outlined title.
-- Parent it to the rounded surface (which must not have padding). Returns the bar and its title label.
--     local bar, title = Kit.titleBar({ text = "🎁 Daily Reward", parent = popup })
--     title.Text = "🎁 Day 3"
function Kit.titleBar(props: TitleBarProps): (Frame, TextLabel)
	local height = props.height or Theme.Size.TitleBar
	local radius = props.corner or Theme.Corner.Window
	local sideSpace = props.sideSpace or 110

	local bar = Instance.new("Frame")
	bar.BackgroundTransparency = 1
	bar.BorderSizePixel = 0
	bar.ClipsDescendants = true
	bar.Size = UDim2.new(1, 0, 0, height)

	-- The fill is taller than the bar and clipped, so only its top corners are rounded.
	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.BackgroundColor3 = WHITE
	fill.BorderSizePixel = 0
	fill.Size = UDim2.new(1, 0, 1, radius)
	fill.Parent = bar
	Kit.corner(fill, radius)
	Kit.gradient(fill, Theme.Gradient.TitleBar)

	local line = Instance.new("Frame")
	line.Name = "Line"
	line.BackgroundColor3 = Theme.Color.Outline
	line.BorderSizePixel = 0
	line.AnchorPoint = Vector2.new(0, 1)
	line.Position = UDim2.fromScale(0, 1)
	line.Size = UDim2.new(1, 0, 0, Theme.Stroke.Thick)
	line.ZIndex = Theme.Z.Content
	line.Parent = bar

	local title = Kit.label({
		text = props.text,
		style = "title",
		textSize = props.textSize,
		size = UDim2.new(1, -sideSpace * 2, 1, -22),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.47),
		zIndex = Theme.Z.Content,
		name = "Title",
		parent = bar,
	})

	place(bar, props, "TitleBar")
	return bar, title
end

export type CardProps = {
	rarity: string?, -- outline in this rarity's colour (rainbow for Exclusive)
	highlight: Color3?, -- outline colour (owned = Theme.Color.Success, best value = Theme.Color.GoldTop ...)
	selected: boolean?, -- white outline
	onClick: (() -> ())?, -- makes the whole card clickable (buttons on the card keep working)
	padding: number?, -- default Theme.Size.Padding
	corner: number?, -- default Theme.Corner.Card
	gradient: ColorSequence?, -- default Theme.Gradient.Card
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent / grid cell
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Card = {
	instance: Frame, -- parent your content here (it is already padded)
	stroke: UIStroke,
	setHighlight: (self: Card, color: Color3?) -> (), -- nil removes the highlight
	setRarity: (self: Card, rarity: string?) -> (),
	setSelected: (self: Card, selected: boolean) -> (),
	setOnClick: (self: Card, onClick: (() -> ())?) -> (),
}

-- Card: rounded, outlined, padded surface for grid/list items. The outline shows, in priority order,
-- selection (white) → highlight colour → rarity colour → the normal dark outline.
--     local card = Kit.card({ rarity = petDef.rarity, onClick = function() select(pet) end, parent = grid })
--     Kit.icon({ icon = "👑", parent = card.instance })
--     card:setSelected(true)      card:setHighlight(Theme.Color.Success)
function Kit.card(props: CardProps): Card
	local options: CardProps = props
	local padding = options.padding or Theme.Size.Padding
	local radius = options.corner or Theme.Corner.Card

	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = WHITE
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	Kit.corner(frame, radius)
	Kit.gradient(frame, options.gradient or Theme.Gradient.Card)
	local stroke = Kit.stroke(frame, Theme.Stroke.Thick)
	if padding > 0 then
		Kit.padding(frame, padding)
	end

	-- Hit area and hover glow cover the whole card, so they reach out over the padding.
	local hit = Instance.new("TextButton")
	hit.Name = "Hit"
	hit.Text = ""
	hit.AutoButtonColor = false
	hit.BackgroundTransparency = 1
	hit.BorderSizePixel = 0
	hit.Position = UDim2.fromOffset(-padding, -padding)
	hit.Size = UDim2.new(1, padding * 2, 1, padding * 2)
	hit.Visible = false
	hit.Parent = frame

	local glow = Instance.new("Frame")
	glow.Name = "Glow"
	glow.BackgroundColor3 = WHITE
	glow.BackgroundTransparency = 0.9
	glow.BorderSizePixel = 0
	glow.Position = hit.Position
	glow.Size = hit.Size
	glow.Visible = false
	glow.Parent = frame
	Kit.corner(glow, radius)

	local rarity: string? = options.rarity
	local highlight: Color3? = options.highlight
	local selected = options.selected == true
	local onClick = options.onClick

	local function refresh()
		local old = stroke:FindFirstChild(RARITY_GRADIENT_NAME)
		if old then
			old:Destroy()
		end
		if selected then
			stroke.Color = Theme.Color.Selected
		elseif highlight then
			stroke.Color = highlight
		elseif rarity then
			Kit.applyRarity(stroke, rarity)
		else
			stroke.Color = Theme.Color.Outline
		end
	end
	refresh()

	local function setClickable(callback: (() -> ())?)
		onClick = callback
		hit.Visible = callback ~= nil
		if callback == nil then
			glow.Visible = false
		end
	end
	setClickable(onClick)

	hit.MouseEnter:Connect(function()
		glow.Visible = true
	end)
	hit.MouseLeave:Connect(function()
		glow.Visible = false
	end)
	hit.SelectionGained:Connect(function()
		glow.Visible = true
	end)
	hit.SelectionLost:Connect(function()
		glow.Visible = false
	end)
	hit.Activated:Connect(function()
		local callback = onClick
		if callback then
			Sound.play("Click")
			callback()
		end
	end)

	place(frame, options, "Card")

	local handle: Card = {
		instance = frame,
		stroke = stroke,
		setHighlight = function(_: any, color: Color3?)
			highlight = color
			refresh()
		end,
		setRarity = function(_: any, newRarity: string?)
			rarity = newRarity
			refresh()
		end,
		setSelected = function(_: any, isSelected: boolean)
			selected = isSelected
			refresh()
		end,
		setOnClick = function(_: any, callback: (() -> ())?)
			setClickable(callback)
		end,
	}
	return handle
end

export type DividerProps = {
	vertical: boolean?, -- default false (a horizontal line)
	thickness: number?, -- default 3
	color: Color3?,
	parent: Instance?,
	name: string?,
	size: UDim2?,
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Thin rounded separator line: full width (or full height with vertical = true).
--     Kit.divider({ parent = column })      Kit.divider({ vertical = true, size = UDim2.new(0, 3, 0.6, 0), parent = row })
function Kit.divider(props: DividerProps): Frame
	local options: DividerProps = props
	local thickness = options.thickness or 3
	local line = Instance.new("Frame")
	line.BackgroundColor3 = options.color or Theme.Color.Outline
	line.BorderSizePixel = 0
	line.Size = if options.vertical then UDim2.new(0, thickness, 1, 0) else UDim2.new(1, 0, 0, thickness)
	Kit.corner(line, Theme.Corner.Pill)
	place(line, options, "Divider")
	return line
end

export type RibbonProps = {
	text: string?, -- default "BEST VALUE"
	gradient: ColorSequence?, -- default Theme.Gradient.Gold
	flat: boolean?, -- true: a horizontal pill on the top edge instead of the diagonal corner ribbon
	extent: number?, -- side of the corner square the diagonal ribbon covers, default 150
	inset: number?, -- padding of the parent, so the ribbon reaches its real corner; default Theme.Size.Padding
	corner: number?, -- corner radius of the surface it sits on, default Theme.Corner.Card
	parent: Instance?,
	name: string?,
	zIndex: number?,
	visible: boolean?,
}

-- "BEST VALUE" ribbon across the top-right corner of its parent. Made for Kit.card: parent it to card.instance
-- (pass `inset` only if the card uses a non-default padding; inset = 0 for a parent without padding).
-- Only use it where it is true: the shop shows it for products with bestValue set and nowhere else.
--     Kit.ribbon({ parent = card.instance })      Kit.ribbon({ text = "NEW", flat = true, parent = card.instance })
function Kit.ribbon(props: RibbonProps): GuiObject
	local options: RibbonProps = props
	local text = options.text or "BEST VALUE"
	local colors = options.gradient or Theme.Gradient.Gold
	local inset = options.inset or Theme.Size.Padding
	local layout = { name = options.name, zIndex = options.zIndex or Theme.Z.Raised, visible = options.visible }

	if options.flat then
		local pill = Instance.new("Frame")
		pill.AnchorPoint = Vector2.new(0.5, 0.5)
		pill.Position = UDim2.new(0.5, 0, 0, -inset)
		pill.Size = UDim2.fromOffset(170, 34)
		pill.BackgroundColor3 = WHITE
		pill.BorderSizePixel = 0
		Kit.corner(pill, Theme.Corner.Pill)
		Kit.gradient(pill, colors)
		Kit.stroke(pill, Theme.Stroke.Medium)
		Kit.label({
			text = text,
			style = "button",
			textSize = 18,
			size = UDim2.new(1, -16, 1, -6),
			anchor = Vector2.new(0.5, 0.5),
			position = UDim2.fromScale(0.5, 0.5),
			parent = pill,
		})
		place(pill, layout, "Ribbon")
		pill.Parent = options.parent
		return pill
	end

	-- A CanvasGroup clips the rotated band to the (rounded) corner; plain ClipsDescendants ignores rotation.
	local extent = options.extent or 150
	local clip = Instance.new("CanvasGroup")
	clip.AnchorPoint = Vector2.new(1, 0)
	clip.Position = UDim2.new(1, inset, 0, -inset)
	clip.Size = UDim2.fromOffset(extent, extent)
	clip.BackgroundTransparency = 1
	clip.BorderSizePixel = 0
	Kit.corner(clip, options.corner or Theme.Corner.Card)

	local band = Instance.new("Frame")
	band.Name = "Band"
	band.AnchorPoint = Vector2.new(0.5, 0.5)
	band.Position = UDim2.fromScale(0.64, 0.36)
	band.Size = UDim2.fromOffset(extent * 1.6, math.floor(extent * 0.24))
	band.Rotation = 45
	band.BackgroundColor3 = WHITE
	band.BorderSizePixel = 0
	band.Parent = clip
	Kit.gradient(band, colors)
	Kit.stroke(band, Theme.Stroke.Medium)
	Kit.label({
		text = text,
		style = "button",
		textSize = 18,
		color = Theme.Color.TextDark,
		stroke = false,
		size = UDim2.new(0.62, 0, 1, -6),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		parent = band,
	})

	place(clip, layout, "Ribbon")
	clip.Parent = options.parent
	return clip
end

export type BadgeProps = {
	count: number?, -- default 0 (hidden)
	parent: Instance?, -- the button it decorates; it sits on the parent's top-right corner
	name: string?,
	position: UDim2?,
	anchor: Vector2?,
	zIndex: number?,
}

export type Badge = {
	instance: Frame,
	set: (self: Badge, count: number) -> (), -- 0 or less hides the badge; more than 99 shows "99+"
	get: (self: Badge) -> number,
}

-- Red notification dot with a count, pinned to the top-right corner of its parent. Hidden while the count is 0.
--     local badge = Kit.badge({ parent = menuButton, count = def.badge and def.badge() or 0 })
--     badge:set(3)
function Kit.badge(props: BadgeProps): Badge
	local options: BadgeProps = props
	local dot = Instance.new("Frame")
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Position = UDim2.new(1, -6, 0, 6)
	dot.Size = UDim2.fromOffset(32, 32)
	dot.BackgroundColor3 = Theme.Color.Badge
	dot.BorderSizePixel = 0
	dot.ZIndex = Theme.Z.Raised
	Kit.corner(dot, Theme.Corner.Pill)
	Kit.stroke(dot, Theme.Stroke.Thin)
	local label = Kit.label({
		text = "",
		style = "number",
		textSize = 20,
		size = UDim2.new(1, -6, 1, -4),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		parent = dot,
	})

	local count = 0
	local function set(value: number)
		count = if value == value then math.max(0, math.floor(value)) else 0
		dot.Visible = count > 0
		label.Text = if count > 99 then "99+" else tostring(count)
		dot.Size = UDim2.fromOffset(if count > 99 then 52 elseif count > 9 then 42 else 32, 32)
	end
	set(options.count or 0)
	place(dot, options, "Badge")

	local handle: Badge = {
		instance = dot,
		set = function(_: any, value: number)
			local before = count
			set(value)
			if count > before then
				startPop(dot, 0.5, 0.25)
			end
		end,
		get = function(_: any): number
			return count
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Button

export type ButtonProps = {
	text: string?,
	icon: string?, -- emoji shown before the text
	style: ButtonStyle?, -- "primary" (blue, default) | "success" (green) | "danger" (red) | "robux" (green) |
	-- "gold" | "neutral" (grey) | "tab" (muted indigo)
	onClick: (() -> ())?,
	enabled: boolean?, -- default true; a disabled button is grey and ignores input
	holdRepeat: boolean?, -- keep firing onClick while the button is held down (buy x many)
	textSize: number?, -- largest text size, default Theme.TextSize.Button (text shrinks to fit)
	corner: number?, -- default Theme.Corner.Button; Theme.Corner.Pill for round buttons
	sound: string?, -- click sound name, default "Click"; "" = silent
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default 220x60
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Button = {
	instance: TextButton, -- the clickable root: size / position / parent this
	body: Frame, -- the coloured visual inside (centre-anchored; it is what animates)
	label: TextLabel,
	setText: (self: Button, text: string) -> (),
	setIcon: (self: Button, icon: string?) -> (),
	setStyle: (self: Button, style: ButtonStyle) -> (),
	setEnabled: (self: Button, enabled: boolean) -> (),
	isEnabled: (self: Button) -> boolean,
	setOnClick: (self: Button, onClick: (() -> ())?) -> (),
	pulse: (self: Button, on: boolean) -> (), -- looping attention pulse (tutorial hints, claimable rewards)
	destroy: (self: Button) -> (),
}

local HOLD_DELAY = 0.4 -- seconds a hold-repeat button must be held before it starts repeating
local HOLD_INTERVAL = 0.14
local HOLD_MIN_INTERVAL = 0.05
local HOLD_MOVE_TOLERANCE = 24 -- px a finger may drift before the hold counts as a scroll gesture

-- The button. Chunky gradient body, dark outline, white outlined text; grows on hover, shrinks on press, plays
-- the click sound; works with mouse, touch and gamepad.
--     local buy = Kit.button({ text = "Buy", icon = "🛒", style = "success", parent = card.instance,
--         onClick = function() ... end })
--     buy:setText(Kit.priceText("coins", 500))    buy:setStyle("neutral")    buy:setEnabled(false)
--     Kit.button({ text = "+1 Level", holdRepeat = true, onClick = buyOne })     -- hold to buy repeatedly
function Kit.button(props: ButtonProps): Button
	local style: string = props.style or "primary"
	local enabled = props.enabled ~= false
	local text = props.text or ""
	local icon: string? = props.icon
	local onClick = props.onClick
	local soundName = if props.sound ~= nil then props.sound else "Click"

	local button = Instance.new("TextButton")
	button.Text = ""
	button.AutoButtonColor = false
	button.BackgroundTransparency = 1
	button.BorderSizePixel = 0
	button.Size = UDim2.fromOffset(Theme.Size.Button.X, Theme.Size.Button.Y)

	local body = Instance.new("Frame")
	body.Name = "Body"
	body.AnchorPoint = Vector2.new(0.5, 0.5)
	body.Position = UDim2.fromScale(0.5, 0.5)
	body.Size = UDim2.fromScale(1, 1)
	body.BackgroundColor3 = WHITE
	body.BorderSizePixel = 0
	body.Parent = button
	Kit.corner(body, props.corner or Theme.Corner.Button)
	Kit.stroke(body, Theme.Stroke.Medium)
	local bodyGradient = Kit.gradient(body, Theme.buttonGradient(style))

	-- The label sits slightly above centre because the gradient's dark lip takes the bottom of the body.
	local label = Kit.label({
		text = "",
		style = "button",
		textSize = props.textSize,
		size = UDim2.new(1, -20, 0.7, 0),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.46),
		parent = body,
	})

	local function refreshText()
		label.Text = if icon and icon ~= "" then (if text ~= "" then `{icon} {text}` else icon) else text
	end
	local function refreshLook()
		bodyGradient.Color = Theme.buttonGradient(if enabled then style else "neutral")
		label.TextTransparency = if enabled then 0 else 0.35
		button.Interactable = enabled
		button.Selectable = enabled
	end
	refreshText()
	refreshLook()

	local resetFeedback = attachFeedback(button, body, 1.04, 0.94)
	local suppressClickUntil = 0

	local function fireClick()
		if soundName ~= "" then
			Sound.play(soundName)
		end
		startPop(body, 0.93, 0.16)
		local callback = onClick
		if callback then
			callback()
		end
	end

	button.Activated:Connect(function()
		if not enabled then
			return
		end
		if os.clock() < suppressClickUntil then
			-- The release that ends a hold-repeat run; its clicks were already delivered.
			suppressClickUntil = 0
			return
		end
		fireClick()
	end)

	local stopPulse: (() -> ())? = nil
	local stopHold: (() -> ())? = nil

	if props.holdRepeat then
		local holdToken = 0
		local repeated = false
		local releaseConnection: RBXScriptConnection? = nil

		local function endHold()
			holdToken += 1
			if releaseConnection then
				releaseConnection:Disconnect()
				releaseConnection = nil
			end
			if repeated then
				repeated = false
				suppressClickUntil = os.clock() + 0.15
			end
		end
		stopHold = endHold

		button.InputBegan:Connect(function(input: InputObject)
			if not enabled or not isPressInput(input) then
				return
			end
			endHold()
			local token = holdToken
			local startPosition = input.Position
			releaseConnection = UserInputService.InputEnded:Connect(function(ended: InputObject)
				if isPressInput(ended) then
					endHold()
				end
			end)
			task.delay(HOLD_DELAY, function()
				local interval = HOLD_INTERVAL
				while holdToken == token and enabled and button.Parent ~= nil do
					if (input.Position - startPosition).Magnitude > HOLD_MOVE_TOLERANCE then
						endHold()
						break
					end
					repeated = true
					task.spawn(fireClick)
					task.wait(interval)
					interval = math.max(HOLD_MIN_INTERVAL, interval * 0.85)
				end
			end)
		end)
		button.MouseLeave:Connect(endHold)
		button.Destroying:Connect(endHold)
	end

	place(button, props, "Button")

	local handle: Button
	handle = {
		instance = button,
		body = body,
		label = label,
		setText = function(_: any, newText: string)
			text = newText
			refreshText()
		end,
		setIcon = function(_: any, newIcon: string?)
			icon = newIcon
			refreshText()
		end,
		setStyle = function(_: any, newStyle: ButtonStyle)
			style = newStyle
			refreshLook()
		end,
		setEnabled = function(_: any, isEnabled: boolean)
			if enabled == isEnabled then
				return
			end
			enabled = isEnabled
			if not enabled then
				resetFeedback()
				if stopHold then
					stopHold()
				end
			end
			refreshLook()
		end,
		isEnabled = function(_: any): boolean
			return enabled
		end,
		setOnClick = function(_: any, callback: (() -> ())?)
			onClick = callback
		end,
		pulse = function(_: any, on: boolean)
			if stopPulse then
				stopPulse()
				stopPulse = nil
			end
			if on then
				stopPulse = Kit.pulse(body)
			end
		end,
		destroy = function(_: any)
			button:Destroy()
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Toggle and slider

export type ToggleProps = {
	value: boolean?, -- default false
	onChange: ((value: boolean) -> ())?, -- called when the PLAYER flips it
	enabled: boolean?,
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default 104x52
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Toggle = {
	instance: TextButton,
	set: (self: Toggle, value: boolean) -> (), -- updates the switch, does NOT call onChange
	get: (self: Toggle) -> boolean,
	setEnabled: (self: Toggle, enabled: boolean) -> (),
}

-- On/off switch (green = on). The label next to it is yours to add.
--     local toggle = Kit.toggle({ value = settings.lowDetail, parent = row,
--         onChange = function(on) Net.request("SetSetting", "lowDetail", on) end })
--     toggle:set(true)
function Kit.toggle(props: ToggleProps): Toggle
	local options: ToggleProps = props
	local value = options.value == true
	local enabled = options.enabled ~= false
	local onChange = options.onChange

	local button = Instance.new("TextButton")
	button.Text = ""
	button.AutoButtonColor = false
	button.BackgroundTransparency = 1
	button.BorderSizePixel = 0
	button.Size = UDim2.fromOffset(104, 52)

	local track = Instance.new("Frame")
	track.Name = "Track"
	track.AnchorPoint = Vector2.new(0.5, 0.5)
	track.Position = UDim2.fromScale(0.5, 0.5)
	track.Size = UDim2.fromScale(1, 1)
	track.BorderSizePixel = 0
	track.Parent = button
	Kit.corner(track, Theme.Corner.Pill)
	Kit.stroke(track, Theme.Stroke.Medium)
	Kit.gradient(track, Theme.Gradient.Shine)

	local knob = Instance.new("Frame")
	knob.Name = "Knob"
	knob.AnchorPoint = Vector2.new(0.5, 0.5)
	knob.Size = UDim2.fromScale(1, 0.74)
	knob.BackgroundColor3 = WHITE
	knob.BorderSizePixel = 0
	knob.Parent = track
	Kit.corner(knob, Theme.Corner.Pill)
	Kit.stroke(knob, Theme.Stroke.Thin)
	local square = Instance.new("UIAspectRatioConstraint")
	square.AspectRatio = 1
	square.DominantAxis = Enum.DominantAxis.Height
	square.Parent = knob

	local function apply(animate: boolean)
		local color = if not enabled
			then Theme.Color.TabBottom
			elseif value then Theme.Color.GreenBottom
			else Theme.Color.NeutralBottom
		local position = UDim2.fromScale(if value then 0.73 else 0.27, 0.5)
		if animate then
			Kit.tween(track, Theme.Time.Fast, { BackgroundColor3 = color })
			Kit.tween(knob, Theme.Time.Fast, { Position = position })
		else
			track.BackgroundColor3 = color
			knob.Position = position
		end
		knob.BackgroundTransparency = if enabled then 0 else 0.4
		button.Interactable = enabled
		button.Selectable = enabled
	end
	apply(false)

	attachFeedback(button, track, 1.05, 0.95)
	button.Activated:Connect(function()
		if not enabled then
			return
		end
		value = not value
		Sound.play("Click")
		apply(true)
		if onChange then
			onChange(value)
		end
	end)

	place(button, options, "Toggle")

	local handle: Toggle = {
		instance = button,
		set = function(_: any, newValue: boolean)
			if value ~= newValue then
				value = newValue
				apply(true)
			end
		end,
		get = function(_: any): boolean
			return value
		end,
		setEnabled = function(_: any, isEnabled: boolean)
			enabled = isEnabled
			apply(false)
		end,
	}
	return handle
end

export type SliderProps = {
	value: number?, -- default min
	min: number?, -- default 0
	max: number?, -- default 1
	step: number?, -- snap to multiples of this (default: continuous)
	onChange: ((value: number) -> ())?, -- while the player drags
	onRelease: ((value: number) -> ())?, -- once when the drag ends: the place to send the value to the server
	gradient: ColorSequence?, -- fill colour, default Theme.Gradient.Blue
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: full width, 48 high
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Slider = {
	instance: Frame,
	set: (self: Slider, value: number) -> (), -- moves the knob, does NOT call the callbacks
	get: (self: Slider) -> number,
}

-- Draggable value slider (mouse, touch; gamepad d-pad left/right while selected).
--     local slider = Kit.slider({ value = settings.music, parent = row,
--         onChange = function(v) previewVolume(v) end,
--         onRelease = function(v) Net.request("SetSetting", "music", v) end })
function Kit.slider(props: SliderProps): Slider
	local options: SliderProps = props
	local minimum = options.min or 0
	local maximum = math.max(options.max or 1, minimum + 1e-6)
	local step = options.step
	local onChange = options.onChange
	local onRelease = options.onRelease
	local knobSize = 38

	local root = Instance.new("Frame")
	root.BackgroundTransparency = 1
	root.BorderSizePixel = 0
	root.Size = UDim2.new(1, 0, 0, 48)

	local hit = Instance.new("TextButton")
	hit.Name = "Hit"
	hit.Text = ""
	hit.AutoButtonColor = false
	hit.BackgroundTransparency = 1
	hit.BorderSizePixel = 0
	hit.Size = UDim2.fromScale(1, 1)
	hit.Parent = root

	local track = Instance.new("Frame")
	track.Name = "Track"
	track.AnchorPoint = Vector2.new(0, 0.5)
	track.Position = UDim2.new(0, knobSize / 2, 0.5, 0)
	track.Size = UDim2.new(1, -knobSize, 0, 18)
	track.BackgroundColor3 = Theme.Color.Inset
	track.BorderSizePixel = 0
	track.Parent = root
	Kit.corner(track, Theme.Corner.Pill)
	Kit.stroke(track, Theme.Stroke.Medium)

	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.BackgroundColor3 = WHITE
	fill.BorderSizePixel = 0
	fill.Parent = track
	Kit.corner(fill, Theme.Corner.Pill)
	Kit.gradient(fill, options.gradient or Theme.vertical(Theme.Color.BlueTop, Theme.Color.BlueBottom))

	local knob = Instance.new("Frame")
	knob.Name = "Knob"
	knob.AnchorPoint = Vector2.new(0.5, 0.5)
	knob.Size = UDim2.fromOffset(knobSize, knobSize)
	knob.BackgroundColor3 = WHITE
	knob.BorderSizePixel = 0
	knob.Parent = track
	Kit.corner(knob, Theme.Corner.Pill)
	Kit.stroke(knob, Theme.Stroke.Medium)
	Kit.gradient(knob, Theme.Gradient.Shine)

	local value = minimum

	local function snap(raw: number): number
		local clamped = if raw == raw then math.clamp(raw, minimum, maximum) else minimum
		if step and step > 0 then
			clamped = math.clamp(minimum + math.round((clamped - minimum) / step) * step, minimum, maximum)
		end
		return clamped
	end

	local function render()
		local fraction = (value - minimum) / (maximum - minimum)
		fill.Size = UDim2.fromScale(fraction, 1)
		fill.Visible = fraction > 0
		knob.Position = UDim2.fromScale(fraction, 0.5)
	end

	-- Returns true when the value changed.
	local function assign(raw: number): boolean
		local snapped = snap(raw)
		if snapped == value then
			return false
		end
		value = snapped
		render()
		return true
	end

	value = snap(options.value or minimum)
	render()

	local function setFromScreenX(x: number)
		local width = track.AbsoluteSize.X
		if width <= 0 then
			return
		end
		local fraction = math.clamp((x - track.AbsolutePosition.X) / width, 0, 1)
		if assign(minimum + fraction * (maximum - minimum)) and onChange then
			onChange(value)
		end
	end

	local dragConnections: { RBXScriptConnection } = {}
	local dragging = false

	local function endDrag()
		if not dragging then
			return
		end
		dragging = false
		for _, connection in dragConnections do
			connection:Disconnect()
		end
		table.clear(dragConnections)
		if onRelease then
			onRelease(value)
		end
	end

	hit.InputBegan:Connect(function(input: InputObject)
		if input.KeyCode == Enum.KeyCode.DPadLeft or input.KeyCode == Enum.KeyCode.DPadRight then
			local direction = if input.KeyCode == Enum.KeyCode.DPadLeft then -1 else 1
			local amount = step or (maximum - minimum) / 10
			if assign(value + direction * amount) then
				if onChange then
					onChange(value)
				end
				if onRelease then
					onRelease(value)
				end
			end
			return
		end
		if
			input.UserInputType ~= Enum.UserInputType.MouseButton1
			and input.UserInputType ~= Enum.UserInputType.Touch
		then
			return
		end
		if dragging then
			return
		end
		dragging = true
		setFromScreenX(input.Position.X)
		table.insert(
			dragConnections,
			UserInputService.InputChanged:Connect(function(moved: InputObject)
				if
					moved.UserInputType == Enum.UserInputType.MouseMovement
					or moved.UserInputType == Enum.UserInputType.Touch
				then
					setFromScreenX(moved.Position.X)
				end
			end)
		)
		table.insert(
			dragConnections,
			UserInputService.InputEnded:Connect(function(ended: InputObject)
				if
					ended.UserInputType == Enum.UserInputType.MouseButton1
					or ended.UserInputType == Enum.UserInputType.Touch
				then
					endDrag()
				end
			end)
		)
	end)
	root.Destroying:Connect(function()
		onRelease = nil
		endDrag()
	end)

	place(root, options, "Slider")

	local handle: Slider = {
		instance = root,
		set = function(_: any, newValue: number)
			assign(newValue)
		end,
		get = function(_: any): number
			return value
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Tabs

export type TabDef = {
	id: string,
	text: string,
	icon: string?, -- emoji
	page: GuiObject?, -- shown while this tab is selected, hidden otherwise
}

export type TabsProps = {
	tabs: { TabDef },
	selected: string?, -- id selected at the start, default the first tab
	onSelect: ((id: string) -> ())?, -- called whenever the selected tab changes (by click or tabs:select)
	fill: boolean?, -- true: equal-width tabs across the whole bar; default: each tab as wide as its text
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: full width, Theme.Size.TabBar high
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Tabs = {
	instance: Frame,
	select: (self: Tabs, id: string) -> (), -- switches tab + page and calls onSelect if the tab changed
	getSelected: (self: Tabs) -> string,
	setBadge: (self: Tabs, id: string, count: number) -> (), -- red count dot on a tab
	setTabVisible: (self: Tabs, id: string, visible: boolean) -> (),
	getButton: (self: Tabs, id: string) -> Button?,
}

-- Row of pill tabs under a window's title bar: the selected tab is blue, the others muted. Give each tab a
-- `page` and the Kit shows the selected page and hides the rest; onSelect is for lazy work.
--     local tabs = Kit.tabs({
--         tabs = { { id = "passes", text = "Passes", icon = "🎟️", page = passesPage },
--                  { id = "gems", text = "Gems", icon = "💎", page = gemsPage } },
--         onSelect = function(id) refresh(id) end,
--         parent = content,
--     })
--     tabs:select("gems")       tabs:setBadge("passes", 2)
function Kit.tabs(props: TabsProps): Tabs
	local gap = 12
	local bar = Instance.new("Frame")
	bar.BackgroundTransparency = 1
	bar.BorderSizePixel = 0
	bar.Size = UDim2.new(1, 0, 0, Theme.Size.TabBar)
	Kit.listLayout(bar, { horizontal = true, gap = gap, alignX = "left", alignY = "center" })

	local defs = props.tabs
	local count = math.max(#defs, 1)
	local onSelect = props.onSelect
	local buttons: { [string]: Button } = {}
	local badges: { [string]: Badge } = {}
	local pages: { [string]: GuiObject } = {}
	local selected = ""

	local function show(id: string)
		selected = id
		for tabId, button in buttons do
			button:setStyle(if tabId == id then "primary" else "tab")
		end
		for tabId, page in pages do
			page.Visible = tabId == id
		end
	end

	local function select(id: string)
		if buttons[id] == nil or id == selected then
			return
		end
		show(id)
		if onSelect then
			onSelect(id)
		end
	end

	for order, def in defs do
		local id = def.id
		local content = if def.icon then `{def.icon} {def.text}` else def.text
		local size = if props.fill
			then UDim2.new(1 / count, -math.ceil(gap * (count - 1) / count), 1, -4)
			else UDim2.new(
				0,
				math.ceil(Kit.measureText(content, Theme.TextSize.Button, Theme.Font.Button)) + 52,
				1,
				-4
			)
		buttons[id] = Kit.button({
			text = def.text,
			icon = def.icon,
			style = "tab",
			corner = Theme.Corner.Pill,
			size = size,
			layoutOrder = order,
			name = "Tab_" .. id,
			parent = bar,
			onClick = function()
				select(id)
			end,
		})
		if def.page then
			pages[id] = def.page
		end
	end

	local initial = props.selected
	if initial == nil or buttons[initial] == nil then
		initial = if defs[1] then defs[1].id else ""
	end
	show(initial :: string)

	place(bar, props, "Tabs")

	local handle: Tabs = {
		instance = bar,
		select = function(_: any, id: string)
			select(id)
		end,
		getSelected = function(_: any): string
			return selected
		end,
		setBadge = function(_: any, id: string, badgeCount: number)
			local button = buttons[id]
			if not button then
				return
			end
			local badge = badges[id]
			if not badge then
				badge = Kit.badge({ parent = button.instance })
				badges[id] = badge
			end
			badge:set(badgeCount)
		end,
		setTabVisible = function(_: any, id: string, visible: boolean)
			local button = buttons[id]
			if button then
				button.instance.Visible = visible
			end
		end,
		getButton = function(_: any, id: string): Button?
			return buttons[id]
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Text input

export type TextInputProps = {
	text: string?,
	placeholder: string?,
	maxLength: number?, -- characters; default 50
	upper: boolean?, -- force upper case (promo codes)
	onSubmit: ((text: string) -> ())?, -- Enter / Done pressed
	onChange: ((text: string) -> ())?,
	textSize: number?, -- default 24
	alignX: AlignX?, -- default "left"
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: full width, 60 high
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type TextInput = {
	instance: Frame,
	box: TextBox,
	get: (self: TextInput) -> string,
	set: (self: TextInput, text: string) -> (),
	focus: (self: TextInput) -> (),
}

local function sanitizeText(text: string, maxLength: number, upper: boolean): string
	local cleaned = string.gsub(text, "[\r\n\t]", "")
	if upper then
		cleaned = string.upper(cleaned)
	end
	local length = utf8.len(cleaned)
	if length == nil then
		return string.sub(cleaned, 1, maxLength)
	end
	if length > maxLength then
		local cut = utf8.offset(cleaned, maxLength + 1)
		if cut then
			cleaned = string.sub(cleaned, 1, cut - 1)
		end
	end
	return cleaned
end

-- Single-line text box in a dark rounded well. The text is limited to maxLength characters while typing.
--     local input = Kit.textInput({ placeholder = "Enter code", upper = true, maxLength = 24, parent = content,
--         onSubmit = function(code) redeem(code) end })
--     input:get()     input:set("")     input:focus()
function Kit.textInput(props: TextInputProps): TextInput
	local options: TextInputProps = props
	local maxLength = math.max(1, math.floor(options.maxLength or 50))
	local upper = options.upper == true
	local onSubmit = options.onSubmit
	local onChange = options.onChange

	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = Theme.Color.Inset
	frame.BorderSizePixel = 0
	frame.Size = UDim2.new(1, 0, 0, 60)
	Kit.corner(frame, Theme.Corner.Button)
	local stroke = Kit.stroke(frame, Theme.Stroke.Medium)

	local box = Instance.new("TextBox")
	box.Name = "Box"
	box.BackgroundTransparency = 1
	box.BorderSizePixel = 0
	box.Position = UDim2.fromOffset(16, 0)
	box.Size = UDim2.new(1, -32, 1, 0)
	box.Font = Theme.Font.Body
	box.TextSize = options.textSize or 24
	box.TextColor3 = Theme.Color.Text
	box.PlaceholderColor3 = Theme.Color.TextDim
	box.PlaceholderText = options.placeholder or ""
	box.Text = sanitizeText(options.text or "", maxLength, upper)
	box.TextXAlignment = TEXT_X[options.alignX or "left"]
	box.ClearTextOnFocus = false
	box.MultiLine = false
	box.TextTruncate = Enum.TextTruncate.AtEnd
	box.Parent = frame

	box:GetPropertyChangedSignal("Text"):Connect(function()
		local current = box.Text
		local cleaned = sanitizeText(current, maxLength, upper)
		if cleaned ~= current then
			box.Text = cleaned -- fires this handler again with the cleaned text
			return
		end
		if onChange then
			onChange(cleaned)
		end
	end)
	box.Focused:Connect(function()
		stroke.Color = Theme.Color.BlueTop
	end)
	box.FocusLost:Connect(function(enterPressed: boolean)
		stroke.Color = Theme.Color.Outline
		if enterPressed and onSubmit then
			onSubmit(box.Text)
		end
	end)

	place(frame, options, "TextInput")

	local handle: TextInput = {
		instance = frame,
		box = box,
		get = function(_: any): string
			return box.Text
		end,
		set = function(_: any, text: string)
			box.Text = sanitizeText(text, maxLength, upper)
		end,
		focus = function(_: any)
			box:CaptureFocus()
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Progress bar

export type ProgressBarProps = {
	fraction: number?, -- 0..1, default 0
	text: string?, -- centred on the bar
	gradient: ColorSequence?, -- fill colour, default Theme.Gradient.XP (green)
	textSize: number?, -- default 20
	corner: number?, -- default pill
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: full width, 34 high
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type ProgressBar = {
	instance: Frame,
	set: (self: ProgressBar, fraction: number, text: string?) -> (), -- animates; text stays when omitted
	get: (self: ProgressBar) -> number,
	setGradient: (self: ProgressBar, colors: ColorSequence) -> (),
}

-- Rounded progress bar with an optional centred text.
--     local bar = Kit.progressBar({ fraction = xp / needed, text = "1,240 / 3,000 XP", parent = hud })
--     bar:set(0.75)                      -- animates the fill
--     bar:set(1, "Ready to claim!")      Kit.progressBar({ gradient = Theme.Gradient.Blue, ... })
function Kit.progressBar(props: ProgressBarProps): ProgressBar
	local options: ProgressBarProps = props
	local radius = options.corner or Theme.Corner.Pill

	local track = Instance.new("Frame")
	track.BackgroundColor3 = Theme.Color.Inset
	track.BorderSizePixel = 0
	track.Size = UDim2.new(1, 0, 0, 34)
	Kit.corner(track, radius)
	Kit.stroke(track, Theme.Stroke.Medium)

	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.BackgroundColor3 = WHITE
	fill.BorderSizePixel = 0
	fill.Parent = track
	Kit.corner(fill, radius)
	local fillGradient = Kit.gradient(fill, options.gradient or Theme.Gradient.XP)

	local label = Kit.label({
		text = options.text or "",
		style = "number",
		textSize = options.textSize or 20,
		size = UDim2.new(1, -16, 1, -4),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		zIndex = Theme.Z.Content,
		name = "Text",
		parent = track,
	})

	local fraction = 0
	local running: Tween? = nil

	local function clampFraction(value: number): number
		return if value == value then math.clamp(value, 0, 1) else 0
	end

	local function apply(value: number, animate: boolean)
		fraction = clampFraction(value)
		if running then
			running:Cancel()
			running = nil
		end
		local goal = UDim2.fromScale(fraction, 1)
		if fraction > 0 then
			fill.Visible = true
		end
		if animate then
			local tween = Kit.tween(fill, Theme.Time.Normal, { Size = goal })
			running = tween
			tween.Completed:Connect(function()
				if running == tween then
					running = nil
					fill.Visible = fraction > 0
				end
			end)
		else
			fill.Size = goal
			fill.Visible = fraction > 0
		end
	end
	apply(options.fraction or 0, false)

	place(track, options, "ProgressBar")

	local handle: ProgressBar = {
		instance = track,
		set = function(_: any, value: number, text: string?)
			if text ~= nil then
				label.Text = text
			end
			if clampFraction(value) ~= fraction then
				apply(value, true)
			end
		end,
		get = function(_: any): number
			return fraction
		end,
		setGradient = function(_: any, colors: ColorSequence)
			fillGradient.Color = colors
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Scrolling containers

-- Product of every UIScale between `instance` and the ScreenGui: absolute sizes are real pixels, offsets are
-- design pixels, and this is the factor between them.
local function effectiveScale(instance: Instance): number
	local scale = 1
	local current: Instance? = instance
	while current do
		local uiScale = current:FindFirstChildOfClass("UIScale")
		if uiScale then
			scale *= uiScale.Scale
		end
		current = current.Parent
	end
	return scale
end

local function newScroll(horizontal: boolean, inset: number): ScrollingFrame
	local scroll = Instance.new("ScrollingFrame")
	scroll.BackgroundTransparency = 1
	scroll.BorderSizePixel = 0
	scroll.Size = UDim2.fromScale(1, 1)
	scroll.CanvasSize = UDim2.fromOffset(0, 0)
	scroll.AutomaticCanvasSize = if horizontal then Enum.AutomaticSize.X else Enum.AutomaticSize.Y
	scroll.ScrollingDirection = if horizontal then Enum.ScrollingDirection.X else Enum.ScrollingDirection.Y
	scroll.ScrollBarThickness = Theme.Size.ScrollBar
	scroll.ScrollBarImageColor3 = Theme.Color.NeutralTop
	scroll.VerticalScrollBarInset = Enum.ScrollBarInset.ScrollBar
	scroll.HorizontalScrollBarInset = Enum.ScrollBarInset.ScrollBar
	scroll.ElasticBehavior = Enum.ElasticBehavior.WhenScrollable
	scroll.Selectable = false
	-- Room for the outlines of the items, which would otherwise be cut off at the frame's edge.
	Kit.padding(scroll, inset)
	return scroll
end

-- AutomaticCanvasSize has a history of mis-measuring content under a UIScale, so the canvas is also sized by
-- hand from the layout's content size (the larger of the two wins).
local function trackCanvas(scroll: ScrollingFrame, layout: UIGridStyleLayout, horizontal: boolean, inset: number)
	local function update()
		local scale = math.max(effectiveScale(scroll), 0.01)
		local content = layout.AbsoluteContentSize
		if horizontal then
			scroll.CanvasSize = UDim2.fromOffset(math.ceil(content.X / scale) + inset * 2, 0)
		else
			scroll.CanvasSize = UDim2.fromOffset(0, math.ceil(content.Y / scale) + inset * 2)
		end
	end
	layout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(update)
	update()
end

export type ScrollListProps = {
	gap: number?, -- px between items, default Theme.Size.Gap
	inset: number?, -- padding around the content, default 6 (keeps item outlines visible)
	horizontal: boolean?, -- scroll sideways instead of down
	alignX: AlignX?,
	alignY: AlignY?,
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Scrolling list: parent your rows to the returned ScrollingFrame; they stack by LayoutOrder and the canvas
-- grows with them.
--     local list = Kit.scrollList({ gap = 10, parent = page })
--     Kit.card({ size = UDim2.new(1, 0, 0, 90), layoutOrder = index, parent = list })
function Kit.scrollList(props: ScrollListProps): ScrollingFrame
	local options: ScrollListProps = props
	local horizontal = options.horizontal == true
	local inset = options.inset or 6
	local scroll = newScroll(horizontal, inset)
	local layout = Kit.listLayout(scroll, {
		horizontal = horizontal,
		gap = options.gap,
		alignX = options.alignX or (if horizontal then "left" else "center"),
		alignY = options.alignY or (if horizontal then "center" else "top"),
	})
	trackCanvas(scroll, layout, horizontal, inset)
	place(scroll, options, "ScrollList")
	return scroll
end

export type ScrollGridProps = {
	columns: number?, -- cells per row, default 4 (ignored when cellSize is given)
	cellHeight: number?, -- px, default 220 (ignored when cellSize or cellAspect is given)
	cellAspect: number?, -- width / height of a cell instead of a fixed height (1 = square)
	cellSize: UDim2?, -- explicit cell size, e.g. UDim2.fromOffset(150, 150): as many per row as fit
	gap: number?, -- px between cells, default Theme.Size.Gap
	inset: number?, -- padding around the content, default 6
	alignX: AlignX?, -- default "left"
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Scrolling grid of equal cells: parent your cards to the returned ScrollingFrame (a card fills its cell).
--     local grid = Kit.scrollGrid({ columns = 4, cellHeight = 300, parent = page })          -- shop cards
--     local pets = Kit.scrollGrid({ cellSize = UDim2.fromOffset(140, 140), parent = page })   -- as many as fit
--     local index = Kit.scrollGrid({ columns = 6, cellAspect = 1, parent = page })            -- square cells
function Kit.scrollGrid(props: ScrollGridProps): ScrollingFrame
	local options: ScrollGridProps = props
	local gap = options.gap or Theme.Size.Gap
	local inset = options.inset or 6
	local scroll = newScroll(false, inset)

	local cellSize: UDim2
	local explicit = options.cellSize
	if explicit then
		cellSize = explicit
	else
		local columns = math.max(1, math.floor(options.columns or 4))
		-- Each cell gives up its share of the gaps so `columns` cells fit the row exactly.
		local shrink = math.ceil(gap * (columns - 1) / columns)
		cellSize = UDim2.new(1 / columns, -shrink, 0, options.cellHeight or 220)
	end
	local layout = Kit.gridLayout(scroll, { cellSize = cellSize, gap = gap, alignX = options.alignX })
	if options.cellAspect and not options.cellSize then
		local aspect = Instance.new("UIAspectRatioConstraint")
		aspect.AspectRatio = math.max(options.cellAspect, 0.01)
		aspect.DominantAxis = Enum.DominantAxis.Width
		aspect.Parent = layout
	end
	trackCanvas(scroll, layout, false, inset)
	place(scroll, options, "ScrollGrid")
	return scroll
end

---------------------------------------------------------------------------------------------------
-- Empty state

export type EmptyStateProps = {
	icon: string?, -- emoji, default "📭"
	text: string, -- the headline
	hint: string?, -- what to do about it
	actionText: string?, -- with onAction: a button below the text
	onAction: (() -> ())?,
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

-- Friendly placeholder for an empty list: big emoji, headline, optional hint and action button.
--     Kit.emptyState({ icon = "🐾", text = "No pets yet", hint = "Hatch an egg to get your first pet!",
--         actionText = "Find an egg", onAction = function() WindowManager.close() end, parent = page })
function Kit.emptyState(props: EmptyStateProps): Frame
	local root = Instance.new("Frame")
	root.BackgroundTransparency = 1
	root.BorderSizePixel = 0
	root.Size = UDim2.fromScale(1, 1)
	Kit.listLayout(root, { gap = 10, alignX = "center", alignY = "center" })

	Kit.icon({ icon = props.icon or "📭", size = UDim2.fromOffset(96, 96), layoutOrder = 1, parent = root })
	Kit.label({ text = props.text, style = "heading", size = UDim2.new(0.9, 0, 0, 40), layoutOrder = 2, parent = root })
	if props.hint then
		Kit.label({
			text = props.hint,
			style = "body",
			color = Theme.Color.TextMuted,
			size = UDim2.new(0.8, 0, 0, 56),
			layoutOrder = 3,
			parent = root,
		})
	end
	if props.actionText and props.onAction then
		Kit.button({
			text = props.actionText,
			style = "primary",
			onClick = props.onAction,
			layoutOrder = 4,
			parent = root,
		})
	end
	place(root, props, "EmptyState")
	return root
end

---------------------------------------------------------------------------------------------------
-- Viewport

export type ViewportProps = {
	spin: boolean?, -- slowly orbit the camera around the model (use for single previews, not whole grids)
	spinSpeed: number?, -- degrees per second, default 30
	yaw: number?, -- camera angle around the model in degrees; 0 looks at its front (-Z face). Default 25
	pitch: number?, -- camera height angle in degrees, default 12
	zoom: number?, -- > 1 moves the camera closer; default 1 (model fits the frame)
	parent: Instance?,
	name: string?,
	size: UDim2?, -- default: fill the parent
	position: UDim2?,
	anchor: Vector2?,
	layoutOrder: number?,
	zIndex: number?,
	visible: boolean?,
}

export type Viewport = {
	instance: ViewportFrame,
	camera: Camera,
	setModel: (self: Viewport, model: Model?) -> (), -- replaces (and destroys) the shown model
	getModel: (self: Viewport) -> Model?,
	setSpin: (self: Viewport, spin: boolean) -> (),
	refit: (self: Viewport) -> (), -- re-frame the camera after you changed the model
}

type ViewportState = {
	frame: ViewportFrame,
	camera: Camera,
	model: Model?,
	center: Vector3,
	distance: number,
	yaw: number,
	pitch: number,
	zoom: number,
	angle: number,
	spinSpeed: number,
}

local VIEWPORT_FOV = 30
local spinning: { [ViewportState]: boolean } = {}
local spinCount = 0
local spinConnection: RBXScriptConnection? = nil

local function aimViewport(state: ViewportState)
	local rotation = CFrame.Angles(0, math.rad(180 + state.yaw + state.angle), 0)
		* CFrame.Angles(-math.rad(state.pitch), 0, 0)
	state.camera.CFrame = CFrame.new(state.center) * rotation * CFrame.new(0, 0, state.distance)
end

local function fitViewport(state: ViewportState)
	local model = state.model
	if model then
		local boxCFrame, boxSize = model:GetBoundingBox()
		local radius = math.max(boxSize.Magnitude / 2, 0.5)
		state.center = boxCFrame.Position
		state.distance = radius / math.sin(math.rad(VIEWPORT_FOV) / 2) / math.max(state.zoom, 0.05)
	end
	aimViewport(state)
end

-- False when the frame or one of its ancestors is hidden: no point re-rendering a preview nobody sees.
local function isShown(instance: Instance): boolean
	local current: Instance? = instance
	while current do
		if current:IsA("GuiObject") then
			if not current.Visible then
				return false
			end
		elseif current:IsA("LayerCollector") then
			return current.Enabled
		end
		current = current.Parent
	end
	return false
end

local function stepSpin(dt: number)
	for state in spinning do
		if isShown(state.frame) then
			state.angle = (state.angle + state.spinSpeed * dt) % 360
			aimViewport(state)
		end
	end
end

local function setSpinning(state: ViewportState, spin: boolean)
	if spin == (spinning[state] == true) then
		return
	end
	if spin then
		spinning[state] = true
		spinCount += 1
		if not spinConnection then
			spinConnection = RunService.Heartbeat:Connect(stepSpin)
		end
	else
		spinning[state] = nil
		spinCount -= 1
		if spinCount <= 0 and spinConnection then
			spinConnection:Disconnect()
			spinConnection = nil
		end
	end
end

-- 3D preview: a ViewportFrame whose camera frames `model`. The viewport takes ownership of the model (it is
-- parented into the frame and destroyed with it), so pass a freshly built one (PetModels.build,
-- HammerVisuals.buildModel). Pass nil as the model for an empty preview you fill later with view:setModel.
--     local view = Kit.viewport(PetModels.build(petId, tier), { size = UDim2.new(1, 0, 0, 120), parent = card.instance })
--     Kit.viewport(HammerVisuals.buildModel(id), { spin = true, size = UDim2.fromOffset(260, 260), parent = panel })
--     view:setModel(PetModels.build(otherPet, 1))      view:setSpin(true)
function Kit.viewport(model: Model?, props: ViewportProps): Viewport
	local options: ViewportProps = props

	local frame = Instance.new("ViewportFrame")
	frame.BackgroundTransparency = 1
	frame.BorderSizePixel = 0
	frame.Size = UDim2.fromScale(1, 1)
	frame.Ambient = Color3.fromRGB(200, 200, 210)
	frame.LightColor = WHITE
	frame.LightDirection = Vector3.new(-0.5, -1, -0.8)

	local camera = Instance.new("Camera")
	camera.FieldOfView = VIEWPORT_FOV
	camera.Parent = frame
	frame.CurrentCamera = camera

	local state: ViewportState = {
		frame = frame,
		camera = camera,
		model = nil,
		center = Vector3.zero,
		distance = 10,
		yaw = options.yaw or 25,
		pitch = options.pitch or 12,
		zoom = options.zoom or 1,
		angle = 0,
		spinSpeed = options.spinSpeed or 30,
	}

	local function setModel(newModel: Model?)
		local old = state.model
		if old and old ~= newModel then
			old:Destroy()
		end
		state.model = newModel
		if newModel then
			newModel.Parent = frame
		end
		fitViewport(state)
	end
	setModel(model)

	if options.spin then
		setSpinning(state, true)
	end
	frame.Destroying:Connect(function()
		setSpinning(state, false)
		state.model = nil
	end)

	place(frame, options, "Viewport")

	local handle: Viewport = {
		instance = frame,
		camera = camera,
		setModel = function(_: any, newModel: Model?)
			setModel(newModel)
		end,
		getModel = function(_: any): Model?
			return state.model
		end,
		setSpin = function(_: any, spin: boolean)
			setSpinning(state, spin)
		end,
		refit = function(_: any)
			fitViewport(state)
		end,
	}
	return handle
end

---------------------------------------------------------------------------------------------------
-- Confirm dialog

-- Where dialogs go and who handles Escape / gamepad B. WindowManager provides this when it loads.
export type Host = {
	overlay: GuiObject, -- full-screen design-pixel layer above the windows
	pushModal: (dismiss: () -> ()) -> () -> (), -- registers a dismiss handler, returns its remover
}

local host: Host? = nil
local fallbackOverlay: Frame? = nil

-- Called once by WindowManager; feature code never needs it.
function Kit.setHost(newHost: Host)
	host = newHost
end

local function overlayParent(): GuiObject
	local current = host
	if current then
		return current.overlay
	end
	-- WindowManager is not loaded (only happens in isolated tests): use a plain ScreenGui of our own.
	local existing = fallbackOverlay
	if existing and existing.Parent then
		return existing
	end
	local player = Players.LocalPlayer
	local playerGui = player:WaitForChild("PlayerGui")
	local gui = Instance.new("ScreenGui")
	gui.Name = "KitDialogs"
	gui.ResetOnSpawn = false
	gui.IgnoreGuiInset = true
	gui.DisplayOrder = Theme.DisplayOrder + 1
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	local layer = Instance.new("Frame")
	layer.Name = "Overlay"
	layer.BackgroundTransparency = 1
	layer.BorderSizePixel = 0
	layer.Size = UDim2.fromScale(1, 1)
	layer.Parent = gui
	gui.Parent = playerGui
	fallbackOverlay = layer
	return layer
end

export type ConfirmOptions = {
	yesText: string?, -- default "Yes"
	noText: string?, -- default "Cancel"
	danger: boolean?, -- red confirm button (delete, reset)
	icon: string?, -- emoji in front of the title
	onNo: (() -> ())?, -- called when the player cancels (button, backdrop, Escape / gamepad B)
}

local closeActiveConfirm: (() -> ())? = nil

-- Modal yes/no dialog above everything. onYes runs when the player confirms; cancelling just closes it.
-- Only one dialog exists at a time (a new one replaces the old). Returns a function that closes the dialog.
--     Kit.confirm("Delete pets?", "This removes 3 pets forever.", function() deleteSelected() end,
--         { yesText = "Delete", danger = true })
function Kit.confirm(title: string, text: string, onYes: () -> (), options: ConfirmOptions?): () -> ()
	local settings: ConfirmOptions = options or {}
	if closeActiveConfirm then
		closeActiveConfirm()
	end

	local root = Instance.new("Frame")
	root.Name = "ConfirmDialog"
	root.BackgroundTransparency = 1
	root.BorderSizePixel = 0
	root.Size = UDim2.fromScale(1, 1)
	root.ZIndex = Theme.Z.Top

	local dim = Instance.new("TextButton")
	dim.Name = "Dim"
	dim.Text = ""
	dim.AutoButtonColor = false
	dim.Selectable = false
	dim.BackgroundColor3 = Theme.Color.Backdrop
	dim.BackgroundTransparency = Theme.BackdropTransparency
	dim.BorderSizePixel = 0
	dim.Size = UDim2.fromScale(1, 1)
	dim.Parent = root

	local dialog = Kit.panel({
		size = UDim2.fromOffset(640, 340),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		corner = Theme.Corner.Window,
		name = "Dialog",
		parent = root,
	})
	-- Swallows clicks on the dialog itself so they do not reach the dim button behind it.
	dialog.Active = true

	Kit.label({
		text = if settings.icon then `{settings.icon} {title}` else title,
		style = "heading",
		textSize = 36,
		color = Theme.Color.GoldTop,
		size = UDim2.new(1, -48, 0, 56),
		position = UDim2.fromOffset(24, 22),
		parent = dialog,
	})
	Kit.label({
		text = text,
		style = "body",
		textSize = 24,
		color = Theme.Color.TextMuted,
		size = UDim2.new(1, -64, 1, -196),
		position = UDim2.fromOffset(32, 86),
		parent = dialog,
	})

	local closed = false
	local removeModal: (() -> ())? = nil
	local selectedBefore = GuiService.SelectedObject

	local function close()
		if closed then
			return
		end
		closed = true
		if closeActiveConfirm == close then
			closeActiveConfirm = nil
		end
		if removeModal then
			removeModal()
		end
		local selectedNow = GuiService.SelectedObject
		if selectedNow and selectedNow:IsDescendantOf(root) then
			GuiService.SelectedObject = if selectedBefore and selectedBefore.Parent then selectedBefore else nil
		end
		root:Destroy()
	end

	local function cancel()
		if closed then
			return
		end
		close()
		if settings.onNo then
			settings.onNo()
		end
	end

	local noButton = Kit.button({
		text = settings.noText or "Cancel",
		style = "neutral",
		size = UDim2.new(0.5, -36, 0, 68),
		anchor = Vector2.new(0, 1),
		position = UDim2.new(0, 24, 1, -24),
		name = "No",
		parent = dialog,
		onClick = cancel,
	})
	Kit.button({
		text = settings.yesText or "Yes",
		style = if settings.danger then "danger" else "success",
		size = UDim2.new(0.5, -36, 0, 68),
		anchor = Vector2.new(1, 1),
		position = UDim2.new(1, -24, 1, -24),
		name = "Yes",
		parent = dialog,
		onClick = function()
			if closed then
				return
			end
			close()
			onYes()
		end,
	})
	dim.Activated:Connect(cancel)

	closeActiveConfirm = close
	local current = host
	if current then
		removeModal = current.pushModal(cancel)
	end
	root.Parent = overlayParent()
	startPop(dialog, 0.7, 0.22)
	Sound.play("Open")
	if isGamepadActive() then
		GuiService.SelectedObject = noButton.instance
	end
	return close
end

return Kit
