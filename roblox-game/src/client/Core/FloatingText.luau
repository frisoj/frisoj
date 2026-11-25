--!strict
--[[
	FloatingText — world-space popup text: damage numbers, "+125 🪙", "Too far!" (spec §8).

	    FloatingText.show(position, "-48", Theme.Color.Text)
	    FloatingText.show(position, "CRIT -96!", Theme.Color.Coins, true)     -- big = larger and longer

	Each popup pops in, rises and fades. BillboardGuis are pooled and the number on screen is capped (fewer in
	low-detail mode): when the cap is reached the oldest popup is recycled, so a burst of hits never piles up
	instances. Whether damage numbers are shown at all (setting `damageNumbers`) is the caller's decision.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Client = ReplicatedStorage:WaitForChild("Client")
local Theme = require(Client:WaitForChild("UI"):WaitForChild("Theme"))
local ClientState = require(Client:WaitForChild("Core"):WaitForChild("ClientState"))

local FloatingText = {}

local MAX_ACTIVE = 30
local MAX_ACTIVE_LOW_DETAIL = 12
local MAX_POOLED = 30
local LIFETIME = 0.9
local LIFETIME_BIG = 1.25
local RISE = 3.2 -- studs travelled upwards over the lifetime
local RISE_BIG = 4.2
local SIZE = UDim2.fromScale(7, 1.7) -- studs
local SIZE_BIG = UDim2.fromScale(10, 2.5)
local SCATTER = 0.9 -- random horizontal offset in studs so simultaneous popups do not overlap exactly
local POP_PORTION = 0.16 -- share of the lifetime spent popping in
local FADE_START = 0.6 -- share of the lifetime after which the text fades out
local MAX_DISTANCE = 140
local MAX_TEXT_LENGTH = 40

type Popup = {
	attachment: Attachment,
	billboard: BillboardGui,
	label: TextLabel,
	stroke: UIStroke,
	elapsed: number,
	lifetime: number,
	rise: number,
}

local pool: { Popup } = {}
local active: { Popup } = {} -- oldest first
local connection: RBXScriptConnection? = nil
local random = Random.new()

local function createPopup(): Popup
	local attachment = Instance.new("Attachment")
	attachment.Name = "FloatingText"

	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Billboard"
	billboard.AlwaysOnTop = true
	billboard.LightInfluence = 0
	billboard.MaxDistance = MAX_DISTANCE
	billboard.ResetOnSpawn = false
	billboard.Enabled = false
	billboard.Size = SIZE
	billboard.Parent = attachment

	local label = Instance.new("TextLabel")
	label.Name = "Text"
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.fromScale(0.5, 0.5)
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.BorderSizePixel = 0
	label.Font = Theme.Font.Number
	label.TextScaled = true
	label.TextColor3 = Theme.Color.Text
	label.Parent = billboard

	local stroke = Instance.new("UIStroke")
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual
	stroke.LineJoinMode = Enum.LineJoinMode.Round
	stroke.Color = Theme.Color.Outline
	stroke.Thickness = Theme.Stroke.TextThin
	stroke.Parent = label

	attachment.Parent = workspace.Terrain
	return {
		attachment = attachment,
		billboard = billboard,
		label = label,
		stroke = stroke,
		elapsed = 0,
		lifetime = 1,
		rise = 0,
	}
end

local function release(popup: Popup)
	popup.billboard.Enabled = false
	if #pool < MAX_POOLED then
		table.insert(pool, popup)
	else
		popup.attachment:Destroy()
	end
end

local function step(dt: number)
	for index = #active, 1, -1 do
		local popup = active[index]
		popup.elapsed += dt
		local alpha = popup.elapsed / popup.lifetime
		if alpha >= 1 then
			table.remove(active, index)
			release(popup)
		else
			-- Ease-out rise, quick overshooting pop-in, fade over the last part.
			local eased = 1 - (1 - alpha) * (1 - alpha)
			popup.billboard.StudsOffsetWorldSpace = Vector3.new(0, popup.rise * eased, 0)
			local scale = 1
			if alpha < POP_PORTION then
				scale = 0.4 + 0.8 * (alpha / POP_PORTION)
			elseif alpha < POP_PORTION * 2 then
				scale = 1.2 - 0.2 * ((alpha - POP_PORTION) / POP_PORTION)
			end
			popup.label.Size = UDim2.fromScale(scale, scale)
			local fade = if alpha > FADE_START then (alpha - FADE_START) / (1 - FADE_START) else 0
			popup.label.TextTransparency = fade
			popup.stroke.Transparency = fade
		end
	end
	if #active == 0 and connection then
		connection:Disconnect()
		connection = nil
	end
end

local function activeLimit(): number
	if ClientState.isReady() then
		local settings = ClientState.get().settings
		if type(settings) == "table" and settings.lowDetail == true then
			return MAX_ACTIVE_LOW_DETAIL
		end
	end
	return MAX_ACTIVE
end

local function showNow(worldPos: Vector3, text: string, color: Color3, big: boolean)
	local popup: Popup
	if #active >= activeLimit() then
		popup = table.remove(active, 1) :: Popup -- recycle the oldest
	else
		popup = table.remove(pool) or createPopup()
	end
	if popup.attachment.Parent == nil then
		-- Lost its parent (Terrain was cleared): a destroyed instance cannot be reused.
		popup = createPopup()
	end

	local scatter = Vector3.new(random:NextNumber(-SCATTER, SCATTER), 0, random:NextNumber(-SCATTER, SCATTER))
	popup.attachment.WorldPosition = worldPos + scatter
	popup.elapsed = 0
	popup.lifetime = if big then LIFETIME_BIG else LIFETIME
	popup.rise = if big then RISE_BIG else RISE
	popup.label.Text = if #text > MAX_TEXT_LENGTH then string.sub(text, 1, MAX_TEXT_LENGTH) else text
	popup.label.TextColor3 = color
	popup.label.TextTransparency = 0
	popup.label.Size = UDim2.fromScale(0.4, 0.4)
	popup.stroke.Transparency = 0
	popup.stroke.Thickness = if big then Theme.Stroke.Text else Theme.Stroke.TextThin
	popup.billboard.Size = if big then SIZE_BIG else SIZE
	popup.billboard.StudsOffsetWorldSpace = Vector3.zero
	popup.billboard.Enabled = true

	table.insert(active, popup)
	if not connection then
		connection = RunService.Heartbeat:Connect(step)
	end
end

-- Shows `text` at a world position; it rises and fades by itself. `big` makes it larger and longer-lived
-- (crits, level-ups). Invalid arguments are ignored; never errors.
function FloatingText.show(worldPos: Vector3, text: string, color: Color3, big: boolean?)
	if typeof(worldPos) ~= "Vector3" or type(text) ~= "string" or text == "" then
		return
	end
	local tint = if typeof(color) == "Color3" then color else Theme.Color.Text
	local ok, message = pcall(showNow :: (...any) -> ...any, worldPos, text, tint, big == true)
	if not ok then
		warn(`[FloatingText] could not show "{text}": {tostring(message)}`)
	end
end

-- Number of popups currently on screen (for tests and debugging).
function FloatingText.activeCount(): number
	return #active
end

return FloatingText
