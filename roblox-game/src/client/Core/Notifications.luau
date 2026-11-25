--!strict
--[[
	Notifications — everything that pops up to tell the player something (spec §8):

	    Notifications.toast("success" | "error" | "info" | "reward", "Bought Stone Hammer!")
	        small stacked message above the XP bar; disappears by itself; plays a sound per kind.
	        The same message shown again only restarts its timer (no spam stacks).
	    Notifications.rewardPopup("Daily Reward", { "+250 Gems", "30 min 2x Coins" }, buttonText?)
	        centre card with one row per line and a confirm button; several popups queue up.
	    Notifications.announce("MintyFox hatched a Legendary Sun Dragon!", color?)
	        banner that drops in from the top; several announcements queue up.
	    Notifications.levelUp(13, 5)
	        the level-up banner (level reached, gems earned).

	It also handles the server events Notify, RewardPopup, Announcement and LevelUp for the whole client, so
	feature code never has to listen to those, and shows an error toast when a window fails to build.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Types = require(Shared:WaitForChild("Types"))
local Net = require(Shared:WaitForChild("Net"))
local NumberFormat = require(Shared:WaitForChild("Util"):WaitForChild("NumberFormat"))

local Client = ReplicatedStorage:WaitForChild("Client")
local Core = Client:WaitForChild("Core")
local Theme = require(Client:WaitForChild("UI"):WaitForChild("Theme"))
local Kit = require(Client:WaitForChild("UI"):WaitForChild("Kit"))
local Sound = require(Core:WaitForChild("Sound"))
local WindowManager = require(Core:WaitForChild("WindowManager"))
local ClientEvents = require(Core:WaitForChild("ClientEvents"))

local Notifications = {}

type KindStyle = { icon: string, color: Color3, sound: string, seconds: number }

local KINDS: { [string]: KindStyle } = {
	success = { icon = "✅", color = Theme.Color.Success, sound = "Purchase", seconds = Theme.Time.Toast },
	error = { icon = "❌", color = Theme.Color.Error, sound = "Error", seconds = Theme.Time.Toast + 1 },
	info = { icon = "💬", color = Theme.Color.Info, sound = "Click", seconds = Theme.Time.Toast },
	reward = { icon = "🎁", color = Theme.Color.Reward, sound = "Reward", seconds = Theme.Time.Toast + 0.5 },
}

local MAX_TOASTS = 4
local MAX_TEXT_LENGTH = 300
local MAX_POPUP_LINES = 8
local MAX_QUEUED_POPUPS = 10
local MAX_QUEUED_ANNOUNCEMENTS = 6
local FADE_TIME = 0.18
local TOAST_BOTTOM_OFFSET = 170 -- keeps the stack above the level / XP bar
local ANNOUNCE_Y = 112 -- below the zone banner
local LEVEL_BANNER_SECONDS = 2.6

local layer = WindowManager.getNotificationLayer()

local function clip(text: string): string
	if #text <= MAX_TEXT_LENGTH then
		return text
	end
	-- Cut on a character boundary so a multi-byte character is never split.
	local cut = MAX_TEXT_LENGTH
	while cut > 0 and bit32.band(string.byte(text, cut + 1) or 0, 0xC0) == 0x80 do
		cut -= 1
	end
	return string.sub(text, 1, cut) .. "…"
end

---------------------------------------------------------------------------------------------------
-- Toasts

type Toast = {
	key: string,
	frame: Frame,
	label: TextLabel,
	stroke: UIStroke,
	seconds: number,
	token: number,
}

local toasts: { Toast } = {}
local toastOrder = 0

local toastHolder = Kit.frame({
	name = "Toasts",
	anchor = Vector2.new(0.5, 1),
	position = UDim2.new(0.5, 0, 1, -TOAST_BOTTOM_OFFSET),
	size = UDim2.fromOffset(900, 420),
	parent = layer,
})
Kit.listLayout(toastHolder, { gap = 10, alignX = "center", alignY = "bottom" })

local function removeToast(toast: Toast, instant: boolean)
	local index = table.find(toasts, toast)
	if not index then
		return
	end
	table.remove(toasts, index)
	toast.token += 1
	if instant then
		toast.frame:Destroy()
		return
	end
	Kit.tween(toast.frame, FADE_TIME, { BackgroundTransparency = 1 })
	Kit.tween(toast.stroke, FADE_TIME, { Transparency = 1 })
	Kit.tween(toast.label, FADE_TIME, { TextTransparency = 1 })
	local textStroke = toast.label:FindFirstChildOfClass("UIStroke")
	if textStroke then
		Kit.tween(textStroke, FADE_TIME, { Transparency = 1 })
	end
	task.delay(FADE_TIME + 0.03, function()
		toast.frame:Destroy()
	end)
end

local function scheduleRemoval(toast: Toast)
	toast.token += 1
	local token = toast.token
	task.delay(toast.seconds, function()
		if toast.token == token then
			removeToast(toast, false)
		end
	end)
end

-- Shows a small message that disappears by itself. `kind` picks colour, icon and sound; unknown kinds are
-- shown as "info". Showing a message that is already on screen restarts its timer instead of stacking.
function Notifications.toast(kind: Types.NotifyKind, text: string)
	if type(text) ~= "string" or text == "" then
		return
	end
	local kindName: string = if type(kind) == "string" then kind else "info"
	local style = KINDS[kindName] or KINDS.info
	local message = clip(text)
	local key = kindName .. "\n" .. message

	for _, existing in toasts do
		if existing.key == key then
			scheduleRemoval(existing)
			Kit.pop(existing.frame, 0.9, 0.15)
			return
		end
	end
	while #toasts >= MAX_TOASTS do
		removeToast(toasts[1], true)
	end

	toastOrder += 1
	local frame = Instance.new("Frame")
	frame.Name = "Toast"
	frame.BackgroundColor3 = Theme.Color.White
	frame.BorderSizePixel = 0
	frame.AutomaticSize = Enum.AutomaticSize.XY
	frame.Size = UDim2.fromOffset(0, 0)
	frame.LayoutOrder = toastOrder
	Kit.corner(frame, Theme.Corner.Button)
	Kit.gradient(frame, Theme.Gradient.Panel)
	local stroke = Kit.stroke(frame, Theme.Stroke.Medium, style.color)
	Kit.padding(frame, 12, 24)

	local label = Kit.label({
		text = `{style.icon}  {message}`,
		style = "body",
		textSize = 24,
		stroke = true,
		wrap = true,
		autoSize = Enum.AutomaticSize.XY,
		size = UDim2.fromOffset(0, 0),
		name = "Text",
		parent = frame,
	})
	local limit = Instance.new("UISizeConstraint")
	limit.MaxSize = Vector2.new(780, 240)
	limit.Parent = label

	frame.Parent = toastHolder
	local toast: Toast =
		{ key = key, frame = frame, label = label, stroke = stroke, seconds = style.seconds, token = 0 }
	table.insert(toasts, toast)
	scheduleRemoval(toast)
	Kit.pop(frame, 0.7, 0.2)
	Sound.play(style.sound)
end

---------------------------------------------------------------------------------------------------
-- Reward popup

type PopupRequest = { title: string, lines: { string }, buttonText: string }

local popupQueue: { PopupRequest } = {}
local popupOpen = false
local hatchOverlayActive = false
local showNextPopup: () -> ()

local function buildPopup(request: PopupRequest)
	local lines = request.lines
	local shown = math.min(#lines, MAX_POPUP_LINES)
	local hidden = #lines - shown
	local rowCount = shown + (if hidden > 0 then 1 else 0)
	local titleHeight = 84
	local rowHeight = 54
	local rowGap = 8
	local buttonHeight = 72
	local padding = 26
	local rowsHeight = if rowCount > 0 then rowCount * rowHeight + (rowCount - 1) * rowGap + padding else 0
	local height = titleHeight + padding + rowsHeight + buttonHeight + padding

	local root = Kit.frame({ name = "RewardPopup", zIndex = Theme.Z.Raised })

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

	local card = Kit.panel({
		size = UDim2.fromOffset(620, height),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		corner = Theme.Corner.Window,
		name = "Card",
		parent = root,
	})
	card.Active = true -- clicks on the card must not reach the dim button behind it
	Kit.titleBar({ text = request.title, height = titleHeight, textSize = 40, sideSpace = 24, parent = card })

	local rows = Kit.column({
		gap = rowGap,
		size = UDim2.new(1, -padding * 2, 0, math.max(rowsHeight - padding, 0)),
		position = UDim2.fromOffset(padding, titleHeight + padding),
		name = "Lines",
		parent = card,
	})
	for index = 1, rowCount do
		local text = if index > shown then `…and {hidden} more` else lines[index]
		local row = Kit.panel({
			inset = true,
			corner = Theme.Corner.Small,
			size = UDim2.new(1, 0, 0, rowHeight),
			layoutOrder = index,
			name = "Line" .. index,
			parent = rows,
		})
		Kit.label({
			text = text,
			style = "heading",
			size = UDim2.new(1, -24, 1, -10),
			anchor = Vector2.new(0.5, 0.5),
			position = UDim2.fromScale(0.5, 0.5),
			parent = row,
		})
	end

	local closed = false
	local removeModal: (() -> ())? = nil
	local function dismiss()
		if closed then
			return
		end
		closed = true
		if removeModal then
			removeModal()
		end
		root:Destroy()
		popupOpen = false
		task.defer(showNextPopup)
	end

	Kit.button({
		text = request.buttonText,
		style = "success",
		size = UDim2.new(1, -padding * 2, 0, buttonHeight),
		anchor = Vector2.new(0.5, 1),
		position = UDim2.new(0.5, 0, 1, -padding),
		name = "Confirm",
		parent = card,
		onClick = dismiss,
	})
	dim.Activated:Connect(dismiss)
	removeModal = WindowManager.pushModal(dismiss)

	root.Parent = layer
	Kit.pop(card, 0.6, 0.28)
	Sound.play("Reward")
end

showNextPopup = function()
	if popupOpen or hatchOverlayActive then
		return
	end
	local request = table.remove(popupQueue, 1)
	if not request then
		return
	end
	popupOpen = true
	local ok, message = pcall(buildPopup :: (...any) -> ...any, request)
	if not ok then
		popupOpen = false
		warn(`[Notifications] reward popup failed: {tostring(message)}`)
	end
end

-- Shows a centre card titled `title` with one row per line and a confirm button (default "Awesome!").
-- The rewards are already granted when this shows; the popup only celebrates them. If a popup is already
-- open (or an egg is hatching) it waits in a queue.
function Notifications.rewardPopup(title: string, lines: { string }, buttonText: string?)
	local cleanLines: { string } = {}
	if type(lines) == "table" then
		for _, line in lines do
			if type(line) == "string" and line ~= "" then
				table.insert(cleanLines, clip(line))
			end
		end
	end
	local request: PopupRequest = {
		title = if type(title) == "string" and title ~= "" then clip(title) else "Reward",
		lines = cleanLines,
		buttonText = if type(buttonText) == "string" and buttonText ~= "" then buttonText else "Awesome!",
	}
	if #popupQueue >= MAX_QUEUED_POPUPS then
		table.remove(popupQueue, 1)
	end
	table.insert(popupQueue, request)
	showNextPopup()
end

---------------------------------------------------------------------------------------------------
-- Announcements

type Announcement = { text: string, color: Color3 }

local announceQueue: { Announcement } = {}
local announcing = false
local showNextAnnouncement: () -> ()

local function buildAnnouncement(announcement: Announcement)
	local textSize = 28
	local text = "📢 " .. announcement.text
	local width = math.clamp(Kit.measureText(text, textSize) + 90, 420, 1300)

	local banner = Kit.panel({
		size = UDim2.fromOffset(width, 64),
		anchor = Vector2.new(0.5, 0),
		position = UDim2.new(0.5, 0, 0, -90),
		corner = Theme.Corner.Pill,
		strokeColor = announcement.color,
		name = "Announcement",
		parent = layer,
	})
	Kit.label({
		text = text,
		style = "heading",
		textSize = textSize,
		color = announcement.color,
		size = UDim2.new(1, -48, 1, -12),
		anchor = Vector2.new(0.5, 0.5),
		position = UDim2.fromScale(0.5, 0.5),
		parent = banner,
	})

	Kit.tween(banner, Theme.Time.Slow, { Position = UDim2.new(0.5, 0, 0, ANNOUNCE_Y) }, Enum.EasingStyle.Back)
	task.delay(Theme.Time.Announce, function()
		local leave = Kit.tween(
			banner,
			Theme.Time.Normal,
			{ Position = UDim2.new(0.5, 0, 0, -90) },
			Enum.EasingStyle.Quad,
			Enum.EasingDirection.In
		)
		leave.Completed:Connect(function()
			banner:Destroy()
			announcing = false
			showNextAnnouncement()
		end)
	end)
end

showNextAnnouncement = function()
	if announcing then
		return
	end
	local announcement = table.remove(announceQueue, 1)
	if not announcement then
		return
	end
	announcing = true
	local ok, message = pcall(buildAnnouncement :: (...any) -> ...any, announcement)
	if not ok then
		announcing = false
		warn(`[Notifications] announcement failed: {tostring(message)}`)
	end
end

-- Shows a banner that drops in at the top of the screen for a few seconds. `color` tints text and outline
-- (default gold). Announcements arriving while one is showing wait their turn.
function Notifications.announce(text: string, color: Color3?)
	if type(text) ~= "string" or text == "" then
		return
	end
	if #announceQueue >= MAX_QUEUED_ANNOUNCEMENTS then
		table.remove(announceQueue, 1)
	end
	table.insert(announceQueue, {
		text = clip(text),
		color = if typeof(color) == "Color3" then color :: Color3 else Theme.Color.GoldTop,
	})
	showNextAnnouncement()
end

---------------------------------------------------------------------------------------------------
-- Level-up banner

type LevelBanner = { frame: Frame, levelLabel: TextLabel, gems: number, token: number }

local levelBanner: LevelBanner? = nil

local function levelText(level: number, gems: number): string
	local text = `Level {NumberFormat.commas(level)}`
	if gems > 0 then
		text ..= `   +{NumberFormat.abbreviate(gems)} 💎`
	end
	return text
end

-- Shows the level-up banner with its sound. Several level-ups in a row update the one banner (the gems add up).
function Notifications.levelUp(newLevel: number, gems: number?)
	if type(newLevel) ~= "number" or newLevel ~= newLevel then
		return
	end
	local gained = if type(gems) == "number" and gems == gems then math.max(gems, 0) else 0

	local shown: LevelBanner
	local existing = levelBanner
	if existing then
		existing.gems += gained
		existing.levelLabel.Text = levelText(newLevel, existing.gems)
		Kit.pop(existing.frame, 0.85, 0.2)
		shown = existing
	else
		local frame = Kit.panel({
			size = UDim2.fromOffset(560, 150),
			anchor = Vector2.new(0.5, 0.5),
			position = UDim2.fromScale(0.5, 0.22),
			gradient = Theme.Gradient.Gold,
			corner = Theme.Corner.Window,
			name = "LevelUp",
			parent = layer,
		})
		Kit.label({
			text = "⭐ LEVEL UP! ⭐",
			style = "title",
			textSize = 46,
			size = UDim2.new(1, -40, 0, 70),
			position = UDim2.fromOffset(20, 12),
			parent = frame,
		})
		local levelLabel = Kit.label({
			text = levelText(newLevel, gained),
			style = "heading",
			textSize = 32,
			size = UDim2.new(1, -40, 0, 48),
			position = UDim2.fromOffset(20, 84),
			name = "Level",
			parent = frame,
		})
		local created: LevelBanner = { frame = frame, levelLabel = levelLabel, gems = gained, token = 0 }
		levelBanner = created
		shown = created
		Kit.pop(frame, 0.5, 0.3)
	end
	Sound.play("LevelUp")

	shown.token += 1
	local token = shown.token
	task.delay(LEVEL_BANNER_SECONDS, function()
		if shown.token ~= token then
			return
		end
		if levelBanner == shown then
			levelBanner = nil
		end
		local leave = Kit.tween(
			shown.frame,
			Theme.Time.Normal,
			{ Position = UDim2.new(0.5, 0, 0, -120) },
			Enum.EasingStyle.Quad,
			Enum.EasingDirection.In
		)
		leave.Completed:Connect(function()
			shown.frame:Destroy()
		end)
	end)
end

---------------------------------------------------------------------------------------------------
-- Global wiring

WindowManager.Failed:Connect(function(_id: string, title: string)
	Notifications.toast("error", `Could not open {title}. Please try again.`)
end)

-- Reward popups wait while the hatch animation covers the screen.
ClientEvents.HatchOverlay:Connect(function(active: boolean)
	hatchOverlayActive = active == true
	if not hatchOverlayActive then
		showNextPopup()
	end
end)

-- Connecting waits for the remotes to replicate, so it must not block whoever requires this module.
task.spawn(function()
	Net.onClientEvent("Notify", function(payload: any)
		if type(payload) == "table" and type(payload.text) == "string" then
			local kind: any = payload.kind
			local known = type(kind) == "string" and KINDS[kind] ~= nil
			Notifications.toast(if known then kind else "info", payload.text)
		end
	end)
	Net.onClientEvent("RewardPopup", function(payload: any)
		if type(payload) == "table" then
			Notifications.rewardPopup(payload.title, payload.lines)
		end
	end)
	Net.onClientEvent("Announcement", function(text: any, colorHex: any)
		if type(text) ~= "string" then
			return
		end
		local color: Color3? = nil
		if type(colorHex) == "string" then
			local ok, parsed = pcall(Color3.fromHex, colorHex)
			if ok then
				color = parsed
			end
		end
		Notifications.announce(text, color)
	end)
	Net.onClientEvent("LevelUp", function(newLevel: any, gems: any)
		Notifications.levelUp(newLevel, gems)
	end)
end)

return Notifications
