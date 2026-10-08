--!strict
-- Twee ranglijsten in de wereld: meeste Goo ooit verdiend en meeste diefstallen.
-- OrderedDataStore kent alleen gehele getallen tot 2^63; Goo wordt daarom als
-- log10 × 10^7 opgeslagen (oplopend, en terug te rekenen voor het bord).

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Format = require(Shared:WaitForChild("Format"))

local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local Leaderboards = {}

local UPDATE_SECONDS = 120
local ROWS = 10

type Board = { store: OrderedDataStore?, rows: { TextLabel }, decode: (number) -> string }

local function encodeGoo(goo: number): number
	return math.floor(math.log10(math.max(goo, 0) + 1) * 1e7)
end

local function decodeGoo(v: number): string
	return Format.number(10 ^ (v / 1e7) - 1)
end

local function getStore(name: string): OrderedDataStore?
	local ok, store = pcall(function()
		return DataStoreService:GetOrderedDataStore(name)
	end)
	return if ok then store else nil
end

local function makeBoard(part: BasePart, title: string, color: Color3): { TextLabel }
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(600, 800)
	gui.LightInfluence = 0
	gui.Brightness = 1.2
	gui.Parent = part
	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = Color3.fromRGB(28, 18, 52)
	bg.Parent = gui
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new(Color3.fromRGB(60, 30, 110), Color3.fromRGB(20, 12, 40))
	grad.Rotation = 90
	grad.Parent = bg
	local head = Instance.new("TextLabel")
	head.BackgroundTransparency = 1
	head.Size = UDim2.new(1, 0, 0.12, 0)
	head.Font = Enum.Font.FredokaOne
	head.TextScaled = true
	head.TextColor3 = color
	head.Text = title
	head.Parent = bg
	local rows: { TextLabel } = {}
	for i = 1, ROWS do
		local row = Instance.new("TextLabel")
		row.BackgroundTransparency = if i % 2 == 0 then 0.85 else 1
		row.BackgroundColor3 = Color3.new(1, 1, 1)
		row.BorderSizePixel = 0
		row.Position = UDim2.new(0.04, 0, 0.13 + (i - 1) * 0.085, 0)
		row.Size = UDim2.new(0.92, 0, 0.08, 0)
		row.Font = Enum.Font.FredokaOne
		row.TextScaled = true
		row.TextXAlignment = Enum.TextXAlignment.Left
		row.TextColor3 = if i == 1 then Color3.fromRGB(255, 215, 80) elseif i == 2 then Color3.fromRGB(220, 230, 240) elseif i == 3 then Color3.fromRGB(240, 160, 90) else Color3.new(1, 1, 1)
		row.Text = ""
		row.Parent = bg
		table.insert(rows, row)
	end
	return rows
end

local nameCache: { [number]: string } = {}
local function nameOf(userId: number): string
	local cached = nameCache[userId]
	if cached then
		return cached
	end
	local ok, name = pcall(function()
		return Players:GetNameFromUserIdAsync(userId)
	end)
	local result = if ok and typeof(name) == "string" then name else "???"
	nameCache[userId] = result
	return result
end

local function refresh(board: Board)
	local store = board.store
	if not store then
		return
	end
	local ok, pages = pcall(function()
		return store:GetSortedAsync(false, ROWS)
	end)
	if not ok or not pages then
		return
	end
	local entries = (pages :: DataStorePages):GetCurrentPage()
	for i = 1, ROWS do
		local entry = entries[i]
		if entry then
			local userId = tonumber(entry.key) or 0
			board.rows[i].Text = string.format("  #%d  %s  -  %s", i, nameOf(userId), board.decode(entry.value))
		else
			board.rows[i].Text = ""
		end
	end
end

local function push(gooStore: OrderedDataStore?, stealStore: OrderedDataStore?)
	for player, data in PlayerData.all() do
		local key = tostring(player.UserId)
		if gooStore and data.totalGoo > 0 then
			pcall(function()
				gooStore:SetAsync(key, encodeGoo(data.totalGoo))
			end)
		end
		if stealStore and data.steals > 0 then
			pcall(function()
				stealStore:SetAsync(key, data.steals)
			end)
		end
	end
end

function Leaderboards.start()
	local folder = Workspace:WaitForChild("Boards")
	local gooPart = folder:WaitForChild("TopGoo") :: BasePart
	local stealPart = folder:WaitForChild("TopThieves") :: BasePart
	local gooStore = getStore(Config.LEADERBOARD_GOO)
	local stealStore = getStore(Config.LEADERBOARD_STEALS)
	local boards: { Board } = {
		{ store = gooStore, rows = makeBoard(gooPart, "TOP GOO", Color3.fromRGB(150, 255, 170)), decode = decodeGoo },
		{ store = stealStore, rows = makeBoard(stealPart, "TOP THIEVES", Color3.fromRGB(255, 140, 90)), decode = function(v: number): string
			return Format.number(v) .. " steals"
		end },
	}
	task.spawn(function()
		task.wait(15)
		while true do
			push(gooStore, stealStore)
			for _, board in boards do
				refresh(board)
			end
			task.wait(UPDATE_SECONDS)
		end
	end)
end

return Leaderboards
