--!strict
-- De hele interface: Goo-teller, menuknoppen, status (storm, geluk, zaterdag-event),
-- meldingen, aankondigingen, en de schermen Shop (met ODDS), Slimedex, Rebirth, Fuse,
-- Codes, Gifts en de dagelijkse beloning. Plus de tutorial-hints.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")
local MarketplaceService = game:GetService("MarketplaceService")
local SocialService = game:GetService("SocialService")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))
local Rebirths = require(Shared:WaitForChild("Rebirths"))
local Events = require(Shared:WaitForChild("Events"))
local Format = require(Shared:WaitForChild("Format"))
local Layout = require(Shared:WaitForChild("Layout"))

local Client = script.Parent
local Ui = require(Client:WaitForChild("Ui"))
local Sound = require(Client:WaitForChild("Sound"))
local SlimeIcon = require(Client:WaitForChild("SlimeIcon"))
local ClientState = require(Client:WaitForChild("ClientState"))
local Effects = require(Client:WaitForChild("Effects"))

local Hud = {}

local player = Players.LocalPlayer
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local Action = remotes:WaitForChild("Action") :: RemoteEvent
local CodeFn = remotes:WaitForChild("Code") :: RemoteFunction

local gui: ScreenGui = nil :: any
local root: Frame = nil :: any
local state: { [string]: any } = {}

------------------------------------------------------------------ catalogus

type Item = { key: string, name: string, icon: string, desc: string }

local PASS_ITEMS: { Item } = {
	{ key = "VIP", name = "VIP", icon = "👑", desc = "+50% Goo, +1 golden pad, +15s lock, VIP chat tag" },
	{ key = "DoubleGoo", name = "2x Goo", icon = "💰", desc = "Double all the Goo you earn, forever" },
	{ key = "AutoCollect", name = "Auto Collect", icon = "🧲", desc = "Goo flies straight into your wallet" },
	{ key = "MegaLab", name = "Mega Lab", icon = "🏠", desc = "+6 pads for more slimes" },
	{ key = "SpeedBoots", name = "Speed Boots", icon = "👟", desc = "+35% speed and +20% jump" },
	{ key = "ThiefGloves", name = "Thief Gloves", icon = "🧤", desc = "Steal in 0.6s and carry slimes faster" },
	{ key = "LaserLockPlus", name = "Laser Lock+", icon = "🔐", desc = "Your lab lock lasts twice as long" },
	{ key = "LuckyCharm", name = "Lucky Charm", icon = "🍀", desc = "2x egg luck. Storm strikes on your lab: 3% → 6%" },
}

local GOO_ITEMS: { Item } = {
	{ key = "GooPackS", name = "Goo Snack", icon = "🧃", desc = "15 minutes of your income" },
	{ key = "GooPackM", name = "Goo Bucket", icon = "🪣", desc = "1 hour of your income" },
	{ key = "GooPackL", name = "Goo Barrel", icon = "🛢️", desc = "4 hours of your income" },
	{ key = "GooPackXL", name = "Goo Tanker", icon = "🚚", desc = "12 hours of your income" },
}

local BOOST_ITEMS: { Item } = {
	{ key = "ServerLuck2", name = "Server Luck x2", icon = "🍀", desc = "Rare+ slimes x2 more likely on the river for 15 min, for everyone" },
	{ key = "ServerLuck5", name = "Server Luck x5", icon = "🌈", desc = "Rare+ slimes x5 more likely on the river for 15 min, for everyone" },
	{ key = "GoldRush", name = "Gold Rush", icon = "⚡", desc = "Start a Gold storm now (Gold x2)" },
	{ key = "RainbowSurge", name = "Rainbow Surge", icon = "🌈", desc = "Start a Rainbow storm now (Rainbow x15)" },
	{ key = "LabShield", name = "Lab Shield", icon = "🛡️", desc = "Nobody can steal from you for 5 minutes" },
	{ key = "SkipFusion", name = "Skip Fusion", icon = "⏩", desc = "Finish your fusion instantly" },
}

local EGG_ITEMS: { Item } = {
	{ key = "LuckyEgg", name = "Lucky Egg", icon = "🥚", desc = "A random Rare or better slime" },
	{ key = "MegaEgg", name = "Mega Egg", icon = "🌟", desc = "A random Legendary or better slime" },
}

local GOO_MINIMUM = {
	GooPackS = Config.GOO_PACKS.GooPackS,
	GooPackM = Config.GOO_PACKS.GooPackM,
	GooPackL = Config.GOO_PACKS.GooPackL,
	GooPackXL = Config.GOO_PACKS.GooPackXL,
}

------------------------------------------------------------------ meldingen

local toastList: Frame = nil :: any
local announceLabel: TextLabel = nil :: any
local announceQueue: { { text: string, color: Color3 } } = {}
local announcing = false

local KIND_COLORS: { [string]: Color3 } = {
	good = Color3.fromRGB(110, 230, 140),
	bad = Color3.fromRGB(255, 110, 110),
	info = Color3.fromRGB(140, 190, 255),
	rare = Color3.fromRGB(255, 200, 80),
}

local function toast(text: string, kind: string)
	local color = KIND_COLORS[kind] or KIND_COLORS.info
	local frame = Ui.make("Frame", {
		Size = UDim2.new(1, 0, 0, 44),
		BackgroundColor3 = Ui.DARK,
		BackgroundTransparency = 0.1,
		Parent = toastList,
	}, { Ui.corner(12), Ui.stroke(2.5, color) })
	Ui.label(text, { Size = UDim2.new(1, -16, 1, -10), Position = UDim2.fromOffset(8, 5), TextColor3 = color, Parent = frame })
	Ui.pop(frame)
	if kind == "bad" then
		Sound.play("error")
	end
	task.delay(4, function()
		TweenService:Create(frame, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
		task.wait(0.4)
		frame:Destroy()
	end)
	local items = toastList:GetChildren()
	local frames = 0
	for _, c in items do
		if c:IsA("Frame") then
			frames += 1
		end
	end
	if frames > 5 then
		for _, c in items do
			if c:IsA("Frame") and c ~= frame then
				c:Destroy()
				break
			end
		end
	end
end

local function runAnnouncements()
	if announcing then
		return
	end
	announcing = true
	while #announceQueue > 0 do
		local item = table.remove(announceQueue, 1) :: { text: string, color: Color3 }
		announceLabel.Text = item.text
		announceLabel.TextColor3 = item.color
		announceLabel.Visible = true
		Ui.pop(announceLabel)
		task.wait(3.6)
		announceLabel.Visible = false
	end
	announcing = false
end

local function announce(text: string, color: Color3)
	table.insert(announceQueue, { text = text, color = color })
	if #announceQueue > 4 then
		table.remove(announceQueue, 1)
	end
	task.spawn(runAnnouncements)
end

------------------------------------------------------------------ panelen

local panels: { [string]: Frame } = {}
local panelBuilders: { [string]: (Frame) -> () } = {}
local openName: string? = nil

local function closePanels()
	for _, p in panels do
		p.Visible = false
	end
	openName = nil
end

local function makePanel(name: string, title: string, color: Color3): (Frame, Frame)
	local panel = Ui.make("Frame", {
		Name = name,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.52),
		Size = UDim2.fromOffset(760, 500),
		BackgroundColor3 = Ui.PANEL,
		Visible = false,
		ZIndex = 10,
		Parent = root,
	}, { Ui.corner(24), Ui.stroke(4), Ui.gradient(Color3.fromRGB(78, 48, 140), Color3.fromRGB(34, 20, 66)) })
	local header = Ui.make("Frame", {
		Size = UDim2.new(1, 0, 0, 64),
		BackgroundColor3 = color,
		Parent = panel,
	}, { Ui.corner(24), Ui.gradient(color:Lerp(Ui.WHITE, 0.2), color:Lerp(Color3.new(0, 0, 0), 0.2)) })
	Ui.label(title, { Size = UDim2.new(1, -140, 0, 48), Position = UDim2.fromOffset(24, 8), TextXAlignment = Enum.TextXAlignment.Left, Parent = header })
	Ui.button("X", Ui.RED, { Size = UDim2.fromOffset(52, 48), Position = UDim2.new(1, -64, 0, 8), Parent = header }, closePanels)
	local body = Ui.make("Frame", {
		Size = UDim2.new(1, -32, 1, -84),
		Position = UDim2.fromOffset(16, 72),
		BackgroundTransparency = 1,
		Parent = panel,
	})
	panels[name] = panel
	return panel, body
end

local function openPanel(name: string)
	local panel = panels[name]
	if not panel then
		return
	end
	if openName == name and panel.Visible then
		closePanels()
		return
	end
	closePanels()
	openName = name
	local builder = panelBuilders[name]
	if builder then
		builder(panel)
	end
	panel.Visible = true
	Ui.pop(panel)
	Sound.play("swoosh", 1.3)
end

local function scrollList(parent: Instance, cellSize: UDim2, padding: number): ScrollingFrame
	local list = Ui.make("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 8,
		CanvasSize = UDim2.new(),
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		Parent = parent,
	})
	Ui.make("UIGridLayout", { CellSize = cellSize, CellPadding = UDim2.fromOffset(padding, padding), SortOrder = Enum.SortOrder.LayoutOrder, Parent = list })
	Ui.make("UIPadding", { PaddingTop = UDim.new(0, 4), PaddingLeft = UDim.new(0, 4), PaddingRight = UDim.new(0, 12), Parent = list })
	return list
end

local function clear(container: Instance)
	for _, c in container:GetChildren() do
		if not c:IsA("UIGridLayout") and not c:IsA("UIListLayout") and not c:IsA("UIPadding") then
			c:Destroy()
		end
	end
end

------------------------------------------------------------------ kopen

local function buyPass(key: string)
	local id = Config.PASSES[key] or 0
	if id == 0 then
		toast("This pass is not for sale yet.", "info")
		return
	end
	MarketplaceService:PromptGamePassPurchase(player, id)
end

local function buyProduct(key: string)
	local id = Config.PRODUCTS[key] or 0
	if id == 0 then
		toast("This item is not for sale yet.", "info")
		return
	end
	MarketplaceService:PromptProductPurchase(player, id)
end

------------------------------------------------------------------ kansen (ODDS)

local oddsPanel: Frame = nil :: any

local function showOdds(title: string, odds: Slimes.Odds, note: string)
	clear(oddsPanel)
	oddsPanel.Visible = true
	Ui.pop(oddsPanel)
	Ui.label(title, { Size = UDim2.new(1, -80, 0, 40), Position = UDim2.fromOffset(16, 10), TextXAlignment = Enum.TextXAlignment.Left, Parent = oddsPanel })
	Ui.button("X", Ui.RED, { Size = UDim2.fromOffset(46, 40), Position = UDim2.new(1, -58, 0, 10) , Parent = oddsPanel }, function()
		oddsPanel.Visible = false
	end)
	local holder = Ui.make("Frame", { Size = UDim2.new(1, -24, 1, -110), Position = UDim2.fromOffset(12, 56), BackgroundTransparency = 1, Parent = oddsPanel })
	local list = Ui.make("ScrollingFrame", {
		Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, BorderSizePixel = 0, ScrollBarThickness = 8,
		CanvasSize = UDim2.new(), AutomaticCanvasSize = Enum.AutomaticSize.Y, Parent = holder,
	})
	Ui.make("UIListLayout", { Padding = UDim.new(0, 4), SortOrder = Enum.SortOrder.LayoutOrder, Parent = list })
	local total = 0
	for i, o in odds do
		total += o.chance
		local info = Slimes.BY_ID[o.id]
		local row = Ui.make("Frame", { Size = UDim2.new(1, -12, 0, 30), BackgroundTransparency = 0.85, BackgroundColor3 = Ui.WHITE, LayoutOrder = i, Parent = list }, { Ui.corner(8) })
		Ui.label(info.name, { Size = UDim2.new(0.45, 0, 1, -4), Position = UDim2.fromOffset(10, 2), TextXAlignment = Enum.TextXAlignment.Left, Parent = row })
		Ui.label(info.rarity, { Size = UDim2.new(0.25, 0, 1, -6), Position = UDim2.new(0.45, 0, 0, 3), TextColor3 = Ui.rgb(Slimes.RARITIES[info.rarity].color), Parent = row })
		Ui.label(Format.chance(o.chance), { Size = UDim2.new(0.28, 0, 1, -4), Position = UDim2.new(0.7, 0, 0, 2), TextXAlignment = Enum.TextXAlignment.Right, Parent = row })
	end
	Ui.label(note .. string.format(" Total: %s (rounded).", Format.chance(total)), {
		Size = UDim2.new(1, -24, 0, 40), Position = UDim2.new(0, 12, 1, -48), TextColor3 = Color3.fromRGB(210, 200, 240), Parent = oddsPanel,
	})
end

local function riverLuck(): number
	local t = Workspace:GetServerTimeNow()
	local luck = 1
	if (tonumber(Workspace:GetAttribute("ServerLuckEnds")) or 0) > t then
		luck = tonumber(Workspace:GetAttribute("ServerLuck")) or 1
	end
	return luck * Events.luckMultiplier(t)
end

local function showRiverOdds()
	local luck = riverLuck()
	showOdds("River odds", Slimes.speciesOdds(luck), if luck > 1 then string.format("Current luck x%g on Rare and better is included.", luck) else "No luck boost active right now.")
end

local function showEggOdds(egg: string)
	local luck = if player:GetAttribute("Pass_LuckyCharm") then 2 else 1
	showOdds(Slimes.EGGS[egg].name .. " odds", Slimes.eggOdds(egg, luck), if luck > 1 then "Your Lucky Charm (x2 luck) is included." else "With Lucky Charm the rarer slimes are 2x as likely.")
end

------------------------------------------------------------------ Shop

local shopTab = "Passes"

local function shopCard(list: Instance, item: Item, order: number, price: number, owned: boolean, onBuy: () -> (), extra: ((Frame) -> ())?)
	local card = Ui.make("Frame", { BackgroundColor3 = Color3.fromRGB(70, 44, 124), LayoutOrder = order, Parent = list }, { Ui.corner(16), Ui.stroke(3) })
	Ui.label(item.icon, { Size = UDim2.new(0, 64, 0, 64), Position = UDim2.fromOffset(10, 10), NoStroke = true, Parent = card })
	Ui.label(item.name, { Size = UDim2.new(1, -90, 0, 34), Position = UDim2.fromOffset(82, 12), TextXAlignment = Enum.TextXAlignment.Left, Parent = card })
	Ui.label(item.desc, { Size = UDim2.new(1, -90, 0, 40), Position = UDim2.fromOffset(82, 46), TextXAlignment = Enum.TextXAlignment.Left, TextYAlignment = Enum.TextYAlignment.Top, TextColor3 = Color3.fromRGB(215, 205, 245), Parent = card })
	if owned then
		Ui.label("OWNED", { Size = UDim2.new(0.5, 0, 0, 40), Position = UDim2.new(0.25, 0, 1, -50), TextColor3 = Ui.GREEN, Parent = card })
	else
		Ui.button("R$ " .. price, Ui.PINK, { Size = UDim2.new(0.5, 0, 0, 42), Position = UDim2.new(1, -12, 1, -52), AnchorPoint = Vector2.new(1, 0), Parent = card }, onBuy)
	end
	if extra then
		extra(card)
	end
end

local function buildShop(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	local tabs = Ui.make("Frame", { Size = UDim2.new(1, 0, 0, 46), BackgroundTransparency = 1, Parent = body })
	Ui.make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), Parent = tabs })
	for _, tab in { "Passes", "Goo", "Boosts", "Eggs" } do
		Ui.button(tab, if tab == shopTab then Ui.GOLD else Ui.BLUE, { Size = UDim2.fromOffset(170, 44), Parent = tabs }, function()
			shopTab = tab
			buildShop(panel)
		end)
	end
	local area = Ui.make("Frame", { Size = UDim2.new(1, 0, 1, -56), Position = UDim2.fromOffset(0, 56), BackgroundTransparency = 1, Parent = body })
	local list = scrollList(area, UDim2.new(0.5, -10, 0, 140), 10)
	if shopTab == "Passes" then
		for i, item in PASS_ITEMS do
			shopCard(list, item, i, Config.PRICES[item.key], player:GetAttribute("Pass_" .. item.key) == true, function()
				buyPass(item.key)
			end)
		end
	elseif shopTab == "Goo" then
		for i, item in GOO_ITEMS do
			local pack = GOO_MINIMUM[item.key]
			local amount = math.max(pack.min, math.floor((state.income or 0) * pack.seconds))
			shopCard(list, { key = item.key, name = item.name, icon = item.icon, desc = item.desc .. ": +" .. Format.number(amount) .. " Goo" }, i, Config.PRICES[item.key], false, function()
				buyProduct(item.key)
			end)
		end
	elseif shopTab == "Boosts" then
		for i, item in BOOST_ITEMS do
			shopCard(list, item, i, Config.PRICES[item.key], false, function()
				buyProduct(item.key)
			end, if item.key == "ServerLuck2" or item.key == "ServerLuck5" then function(card: Frame)
				Ui.button("ODDS", Ui.BLUE, { Size = UDim2.new(0.38, 0, 0, 42), Position = UDim2.new(0, 12, 1, -52), Parent = card }, showRiverOdds)
			end else nil)
		end
	else
		local restricted = player:GetAttribute("RandomItemsRestricted")
		if restricted ~= false then
			Ui.label(if restricted == nil then "Checking your account..." else "Eggs are not available for your account.", { Size = UDim2.new(1, 0, 0, 50), Parent = area })
			list:Destroy()
			return
		end
		for i, item in EGG_ITEMS do
			shopCard(list, item, i, Config.PRICES[item.key], false, function()
				buyProduct(item.key)
			end, function(card: Frame)
				Ui.button("ODDS", Ui.BLUE, { Size = UDim2.new(0.38, 0, 0, 42), Position = UDim2.new(0, 12, 1, -52), Parent = card }, function()
					showEggOdds(item.key)
				end)
			end)
		end
	end
end

------------------------------------------------------------------ Slimedex

local function buildDex(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	local dex = state.dex or {}
	local found = 0
	for _ in dex do
		found += 1
	end
	Ui.label(string.format("Found %d / %d  |  Bonus: +%d%% Goo", found, #Slimes.LIST, math.floor((state.dexBonus or 0) * 100 + 0.5)), {
		Size = UDim2.new(1, 0, 0, 36), TextColor3 = Ui.GOLD, Parent = body,
	})
	local area = Ui.make("Frame", { Size = UDim2.new(1, 0, 1, -44), Position = UDim2.fromOffset(0, 44), BackgroundTransparency = 1, Parent = body })
	local list = scrollList(area, UDim2.fromOffset(160, 190), 10)
	for i, info in Slimes.LIST do
		local entry = dex[info.id]
		local rarity = Slimes.RARITIES[info.rarity]
		local tile = Ui.make("Frame", { BackgroundColor3 = Color3.fromRGB(60, 38, 108), LayoutOrder = i, Parent = list }, { Ui.corner(14), Ui.stroke(3, Ui.rgb(rarity.color)) })
		if entry then
			local icon = SlimeIcon.new(info.id, nil, entry.f or 0, false)
			icon.Size = UDim2.new(1, -16, 0, 110)
			icon.Position = UDim2.fromOffset(8, 6)
			icon.Parent = tile
			Ui.label(info.name, { Size = UDim2.new(1, -10, 0, 26), Position = UDim2.fromOffset(5, 116), Parent = tile })
			local muts = 0
			for _ in entry.m or {} do
				muts += 1
			end
			Ui.label(string.format("%s  |  %d/6 mutations", info.rarity, muts), { Size = UDim2.new(1, -10, 0, 20), Position = UDim2.fromOffset(5, 144), TextColor3 = Ui.rgb(rarity.color), Parent = tile })
			Ui.label("+" .. Format.number(info.income) .. "/s", { Size = UDim2.new(1, -10, 0, 18), Position = UDim2.fromOffset(5, 166), TextColor3 = Ui.GREEN, Parent = tile })
		else
			Ui.label("?", { Size = UDim2.new(1, 0, 0, 100), Position = UDim2.fromOffset(0, 10), TextColor3 = Color3.fromRGB(150, 130, 190), Parent = tile })
			Ui.label("???", { Size = UDim2.new(1, -10, 0, 26), Position = UDim2.fromOffset(5, 116), Parent = tile })
			Ui.label(info.rarity, { Size = UDim2.new(1, -10, 0, 20), Position = UDim2.fromOffset(5, 144), TextColor3 = Ui.rgb(rarity.color), Parent = tile })
		end
	end
end

------------------------------------------------------------------ Rebirth

local function buildRebirth(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	local rebirths = state.rebirths or 0
	local req = Rebirths.next(rebirths)
	Ui.label(string.format("Rebirth %d / %d", rebirths, Rebirths.MAX), { Size = UDim2.new(1, 0, 0, 44), TextColor3 = Ui.GOLD, Parent = body })
	if not req then
		Ui.label("You reached the highest rebirth. Legend!", { Size = UDim2.new(1, 0, 0, 40), Position = UDim2.fromOffset(0, 60), Parent = body })
		return
	end
	local r = req :: Rebirths.Requirement
	local goo = state.goo or 0
	local hasSlime = false
	for _, slime in state.lab or {} do
		if Rebirths.meets(slime, r) then
			hasSlime = true
		end
	end
	local function line(y: number, ok: boolean, text: string)
		Ui.label((if ok then "✅ " else "❌ ") .. text, { Size = UDim2.new(1, -20, 0, 36), Position = UDim2.fromOffset(10, y), TextXAlignment = Enum.TextXAlignment.Left, Parent = body })
	end
	line(60, goo >= r.goo, string.format("%s / %s Goo", Format.number(goo), Format.number(r.goo)))
	line(100, hasSlime, "Own " .. Rebirths.describe(r) .. " in your lab")
	local bar = Ui.make("Frame", { Size = UDim2.new(1, -20, 0, 18), Position = UDim2.fromOffset(10, 144), BackgroundColor3 = Color3.fromRGB(30, 20, 50), Parent = body }, { Ui.corner(9) })
	Ui.make("Frame", { Size = UDim2.new(math.clamp(goo / r.goo, 0, 1), 0, 1, 0), BackgroundColor3 = Ui.GREEN, Parent = bar }, { Ui.corner(9) })
	Ui.label("Rewards: +50% Goo forever, +1 pad, +5s lock", { Size = UDim2.new(1, -20, 0, 34), Position = UDim2.fromOffset(10, 180), TextColor3 = Color3.fromRGB(150, 255, 190), Parent = body })
	Ui.label("You lose your Goo and slimes. Slimedex, passes and rebirth bonus stay.", { Size = UDim2.new(1, -20, 0, 28), Position = UDim2.fromOffset(10, 220), TextColor3 = Color3.fromRGB(255, 190, 190), Parent = body })
	Ui.button("REBIRTH", if goo >= r.goo and hasSlime then Ui.GREEN else Color3.fromRGB(120, 120, 140), { Size = UDim2.fromOffset(280, 64), Position = UDim2.new(0.5, -140, 0, 280), Parent = body }, function()
		Action:FireServer("rebirth")
		task.delay(0.6, function()
			if openName == "Rebirth" then
				buildRebirth(panel)
			end
		end)
	end)
end

------------------------------------------------------------------ Fuse

local fuseTimer: TextLabel? = nil
local fuseShownBusy = false

local function buildFuse(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	local fusing = state.fusing
	fuseShownBusy = fusing ~= nil
	fuseTimer = nil
	if fusing then
		local left = math.max(0, (fusing.readyAt or 0) - Workspace:GetServerTimeNow())
		local box = Ui.make("Frame", { Size = UDim2.new(1, 0, 0, 120), BackgroundColor3 = Color3.fromRGB(70, 44, 124), Parent = body }, { Ui.corner(16), Ui.stroke(3) })
		local icon = SlimeIcon.new(fusing.s, fusing.m, fusing.f, true)
		icon.Size = UDim2.fromOffset(110, 110)
		icon.Position = UDim2.fromOffset(6, 5)
		icon.Parent = box
		Ui.label("Fusing: " .. Slimes.displayName(fusing), { Size = UDim2.new(1, -140, 0, 36), Position = UDim2.fromOffset(124, 12), TextXAlignment = Enum.TextXAlignment.Left, Parent = box })
		fuseTimer = Ui.label("Ready in " .. Format.time(left), { Size = UDim2.new(0.5, -60, 0, 30), Position = UDim2.fromOffset(124, 60), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = Ui.GOLD, Parent = box })
		Ui.button("Skip  R$ " .. Config.PRICES.SkipFusion, Ui.PINK, { Size = UDim2.fromOffset(200, 48), Position = UDim2.new(1, -212, 0, 60), Parent = box }, function()
			buyProduct("SkipFusion")
		end)
	end
	local top = if fusing then 132 else 0
	Ui.label("Put 3 of the same slime in the machine: Giant = x4 Goo, Titan = x16 Goo", { Size = UDim2.new(1, 0, 0, 30), Position = UDim2.fromOffset(0, top), TextColor3 = Color3.fromRGB(215, 205, 245), Parent = body })
	local area = Ui.make("Frame", { Size = UDim2.new(1, 0, 1, -(top + 38)), Position = UDim2.fromOffset(0, top + 38), BackgroundTransparency = 1, Parent = body })
	local list = scrollList(area, UDim2.new(0.5, -10, 0, 110), 10)
	local groups: { [string]: { s: string, f: number, n: number, m: string? } } = {}
	for _, slime in state.lab or {} do
		if slime.f < Slimes.MAX_FUSE then
			local key = slime.s .. ":" .. slime.f
			local g: { s: string, f: number, n: number, m: string? } = groups[key] or { s = slime.s, f = slime.f, n = 0, m = nil }
			g.n += 1
			g.m = Slimes.bestMutation(g.m, slime.m)
			groups[key] = g
		end
	end
	local order = 0
	for _, g in groups do
		order += 1
		local card = Ui.make("Frame", { BackgroundColor3 = Color3.fromRGB(70, 44, 124), LayoutOrder = if g.n >= 3 then order else order + 100, Parent = list }, { Ui.corner(14), Ui.stroke(3) })
		local icon = SlimeIcon.new(g.s, g.m, g.f, false)
		icon.Size = UDim2.fromOffset(96, 96)
		icon.Position = UDim2.fromOffset(6, 7)
		icon.Parent = card
		local result = { s = g.s, m = g.m, f = g.f + 1 }
		Ui.label(string.format("%d/3  %s", math.min(g.n, 3), Slimes.displayName({ s = g.s, m = nil, f = g.f })), { Size = UDim2.new(1, -116, 0, 28), Position = UDim2.fromOffset(108, 8), TextXAlignment = Enum.TextXAlignment.Left, Parent = card })
		Ui.label("→ " .. Slimes.displayName(result), { Size = UDim2.new(1, -116, 0, 24), Position = UDim2.fromOffset(108, 38), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = Ui.GOLD, Parent = card })
		if g.n >= 3 and not fusing then
			Ui.button("FUSE", Ui.GREEN, { Size = UDim2.fromOffset(120, 36), Position = UDim2.fromOffset(108, 66), Parent = card }, function()
				Action:FireServer("fuse", g.s, g.f)
				task.delay(0.5, function()
					if openName == "Fuse" then
						buildFuse(panel)
					end
				end)
			end)
		end
	end
	if order == 0 then
		Ui.label("Buy or steal more slimes to fuse them!", { Size = UDim2.new(1, 0, 0, 40), Parent = area })
	end
end

------------------------------------------------------------------ Codes

local function buildCodes(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	Ui.label("Enter a code for free rewards!", { Size = UDim2.new(1, 0, 0, 40), Position = UDim2.fromOffset(0, 20), Parent = body })
	local box = Ui.make("TextBox", {
		Size = UDim2.new(0.7, 0, 0, 60), Position = UDim2.new(0.15, 0, 0, 90), BackgroundColor3 = Color3.fromRGB(30, 20, 52),
		Font = Ui.FONT, PlaceholderText = "CODE", Text = "", TextColor3 = Ui.WHITE, TextScaled = true, ClearTextOnFocus = false, Parent = body,
	}, { Ui.corner(14), Ui.stroke(3) })
	local result = Ui.label("", { Size = UDim2.new(1, 0, 0, 36), Position = UDim2.fromOffset(0, 250), Parent = body })
	Ui.button("REDEEM", Ui.GREEN, { Size = UDim2.fromOffset(240, 60), Position = UDim2.new(0.5, -120, 0, 170), Parent = body }, function()
		local ok, text = CodeFn:InvokeServer(box.Text)
		result.Text = tostring(text)
		result.TextColor3 = if ok then Ui.GREEN else Ui.RED
		Sound.play(if ok then "rare" else "error")
	end)
	Ui.label("Codes are shared on our game page and in updates.", { Size = UDim2.new(1, 0, 0, 28), Position = UDim2.fromOffset(0, 330), TextColor3 = Color3.fromRGB(200, 190, 230), Parent = body })
end

------------------------------------------------------------------ Gifts en Daily

local function buildGifts(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	Ui.label("Play to unlock free gifts! They reset every day.", { Size = UDim2.new(1, 0, 0, 34), Parent = body })
	local area = Ui.make("Frame", { Size = UDim2.new(1, 0, 1, -44), Position = UDim2.fromOffset(0, 44), BackgroundTransparency = 1, Parent = body })
	local list = scrollList(area, UDim2.fromOffset(132, 160), 10)
	local claimed = state.giftsClaimed or 0
	local seconds = state.giftSeconds or 0
	for i, gift in Config.GIFTS do
		local ready = seconds >= gift.at * 60
		local done = i <= claimed
		local tile = Ui.make("Frame", { BackgroundColor3 = if done then Color3.fromRGB(50, 90, 70) else Color3.fromRGB(70, 44, 124), LayoutOrder = i, Parent = list }, { Ui.corner(14), Ui.stroke(3, if ready and not done then Ui.GOLD else Ui.STROKE) })
		Ui.label(if gift.egg then "🥚" else "🎁", { Size = UDim2.new(1, 0, 0, 60), Position = UDim2.fromOffset(0, 8), NoStroke = true, Parent = tile })
		Ui.label(if gift.egg then "Lucky Egg" else (gift.minutes .. " min of Goo"), { Size = UDim2.new(1, -8, 0, 24), Position = UDim2.fromOffset(4, 72), Parent = tile })
		if done then
			Ui.label("CLAIMED", { Size = UDim2.new(1, -8, 0, 30), Position = UDim2.fromOffset(4, 112), TextColor3 = Ui.GREEN, Parent = tile })
		elseif ready and i == claimed + 1 then
			Ui.button("CLAIM", Ui.GREEN, { Size = UDim2.new(1, -16, 0, 40), Position = UDim2.fromOffset(8, 108), Parent = tile }, function()
				Action:FireServer("gift")
				task.delay(0.5, function()
					if openName == "Gifts" then
						buildGifts(panel)
					end
				end)
			end)
		else
			Ui.label(if ready then "Next!" else Format.time(gift.at * 60 - seconds), { Size = UDim2.new(1, -8, 0, 30), Position = UDim2.fromOffset(4, 112), TextColor3 = Ui.GOLD, Parent = tile })
		end
	end
end

local function buildDaily(panel: Frame)
	local body = panel:FindFirstChild("Body") :: Frame
	clear(body)
	local streak = state.dailyStreak or 0
	local ready = state.dailyReady == true
	Ui.label("Come back every day for bigger rewards!", { Size = UDim2.new(1, 0, 0, 34), Parent = body })
	local row = Ui.make("Frame", { Size = UDim2.new(1, 0, 0, 160), Position = UDim2.fromOffset(0, 50), BackgroundTransparency = 1, Parent = body })
	Ui.make("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 8), HorizontalAlignment = Enum.HorizontalAlignment.Center, Parent = row })
	local nextDay = if ready then (state.dailyNext or 1) else streak
	for i, reward in Config.DAILY do
		local current = i == nextDay
		local tile = Ui.make("Frame", { Size = UDim2.fromOffset(92, 150), BackgroundColor3 = if i < nextDay or (not ready and i == nextDay) then Color3.fromRGB(50, 90, 70) else Color3.fromRGB(70, 44, 124), Parent = row }, { Ui.corner(14), Ui.stroke(3, if current and ready then Ui.GOLD else Ui.STROKE) })
		Ui.label("Day " .. i, { Size = UDim2.new(1, -8, 0, 28), Position = UDim2.fromOffset(4, 6), Parent = tile })
		Ui.label(if reward.egg then "🥚" else "💧", { Size = UDim2.new(1, 0, 0, 60), Position = UDim2.fromOffset(0, 40), NoStroke = true, Parent = tile })
		Ui.label(if reward.egg then "Lucky Egg" else reward.minutes .. " min", { Size = UDim2.new(1, -8, 0, 24), Position = UDim2.fromOffset(4, 110), Parent = tile })
	end
	if ready then
		Ui.button("CLAIM DAY " .. nextDay, Ui.GREEN, { Size = UDim2.fromOffset(300, 64), Position = UDim2.new(0.5, -150, 0, 240), Parent = body }, function()
			Action:FireServer("daily")
			closePanels()
		end)
	else
		Ui.label("Come back tomorrow to keep your streak going!", { Size = UDim2.new(1, 0, 0, 40), Position = UDim2.fromOffset(0, 250), TextColor3 = Ui.GOLD, Parent = body })
	end
end

------------------------------------------------------------------ hoofdscherm

local gooLabel: TextLabel = nil :: any
local incomeLabel: TextLabel = nil :: any
local padsLabel: TextLabel = nil :: any
local tankLabel: TextLabel = nil :: any
local stormLabel: TextLabel = nil :: any
local luckLabel: TextLabel = nil :: any
local eventLabel: TextLabel = nil :: any
local giftBadge: TextLabel = nil :: any
local tutorialFrame: Frame = nil :: any
local tutorialLabel: TextLabel = nil :: any

local function menuButton(parent: Instance, icon: string, text: string, color: Color3, order: number, onClick: () -> ()): TextButton
	local b = Ui.button("", color, { Size = UDim2.fromOffset(78, 78), LayoutOrder = order, Parent = parent }, onClick)
	Ui.label(icon, { Size = UDim2.new(1, 0, 0.62, 0), NoStroke = true, Parent = b })
	Ui.label(text, { Size = UDim2.new(1, 0, 0.34, 0), Position = UDim2.fromScale(0, 0.64), Parent = b })
	return b
end

local function statusCard(parent: Instance, order: number, color: Color3): TextLabel
	local card = Ui.make("Frame", { Size = UDim2.fromOffset(250, 46), BackgroundColor3 = Ui.DARK, BackgroundTransparency = 0.15, LayoutOrder = order, Parent = parent }, { Ui.corner(12), Ui.stroke(2.5, color) })
	return Ui.label("", { Size = UDim2.new(1, -16, 1, -10), Position = UDim2.fromOffset(8, 5), TextColor3 = color, Parent = card })
end

local function myLabModel(): Instance?
	local index = player:GetAttribute("Lab")
	local labs = Workspace:FindFirstChild("Labs")
	return if labs and index then labs:FindFirstChild("Lab" .. tostring(index)) else nil
end

local function updateTutorial()
	local step = state.tutorial or 0
	local character = player.Character
	local rootPart = character and character:FindFirstChild("HumanoidRootPart")
	if step >= 3 or not rootPart or not rootPart:IsA("BasePart") then
		tutorialFrame.Visible = false
		Effects.setGuide(nil)
		return
	end
	tutorialFrame.Visible = true
	local lab = myLabModel()
	if step == 0 then
		tutorialLabel.Text = "1/3  Walk to the GOO RIVER and press E to buy a slime!"
		local x = math.clamp(rootPart.Position.X, Layout.RIVER_START + 20, Layout.RIVER_END - 20)
		Effects.setGuide(Vector3.new(x, 3, Layout.RIVER_Z(x)))
	elseif step == 1 then
		tutorialLabel.Text = "2/3  Step on the green COLLECT pad in your lab to collect Goo!"
		local pad = lab and lab:FindFirstChild("CollectPad")
		Effects.setGuide(if pad and pad:IsA("BasePart") then pad.Position + Vector3.new(0, 2, 0) else nil)
	else
		tutorialLabel.Text = "3/3  Step on the red LOCK button so nobody can steal!"
		local button = lab and lab:FindFirstChild("LockButton")
		Effects.setGuide(if button and button:IsA("BasePart") then button.Position + Vector3.new(0, 2, 0) else nil)
	end
end

local function updateStatus()
	local t = Workspace:GetServerTimeNow()
	local w = Workspace:GetAttribute("Weather")
	local ends = tonumber(Workspace:GetAttribute("WeatherEnds")) or 0
	local mut = if typeof(w) == "string" and w ~= "" and ends > t then Slimes.MUTATIONS[w] else nil
	if mut then
		stormLabel.Text = string.format("%s  x%d  %s", string.upper(mut.storm), mut.mult, Format.time(ends - t))
		stormLabel.TextColor3 = Ui.rgb(mut.color)
	else
		stormLabel.Text = "Next storm in " .. Format.time((tonumber(Workspace:GetAttribute("NextStorm")) or t) - t)
		stormLabel.TextColor3 = Color3.fromRGB(200, 190, 240)
	end
	local luckEnds = tonumber(Workspace:GetAttribute("ServerLuckEnds")) or 0
	local luckParent = luckLabel.Parent :: Frame
	if luckEnds > t then
		luckParent.Visible = true
		luckLabel.Text = string.format("SERVER LUCK x%d  %s", tonumber(Workspace:GetAttribute("ServerLuck")) or 1, Format.time(luckEnds - t))
	else
		luckParent.Visible = false
	end
	local live, seconds = Events.saturday(t)
	eventLabel.Text = if live then "SLIME STORM SATURDAY  x2  " .. Format.time(seconds) else "Saturday event in " .. (if seconds > 86400 then math.floor(seconds / 86400) .. "d" else Format.time(seconds))
	eventLabel.TextColor3 = if live then Ui.GOLD else Color3.fromRGB(200, 190, 240)
end

local function onState(data: { [string]: any })
	state = data
	gooLabel.Text = Format.number(data.goo or 0) .. " Goo"
	incomeLabel.Text = "+" .. Format.number(data.income or 0) .. "/s  (x" .. string.format("%.2g", data.multiplier or 1) .. ")"
	padsLabel.Text = string.format("Pads %d/%d", data.used or 0, data.pads or 0) .. (if (data.storage or 0) > 0 then string.format("  +%d waiting", data.storage) else "")
	local auto = player:GetAttribute("Pass_AutoCollect") == true
	tankLabel.Visible = not auto and (data.tank or 0) >= 1
	tankLabel.Text = "Tank: " .. Format.number(data.tank or 0) .. " Goo - collect at your lab!"
	-- Cadeau-knop: hoeveel cadeaus klaarliggen
	local claimable = 0
	for i, gift in Config.GIFTS do
		if i > (data.giftsClaimed or 0) and (data.giftSeconds or 0) >= gift.at * 60 then
			claimable += 1
		end
	end
	giftBadge.Visible = claimable > 0
	giftBadge.Text = tostring(claimable)
	if openName == "Fuse" and panels.Fuse.Visible then
		local fusing = data.fusing
		if (fusing ~= nil) ~= fuseShownBusy then
			buildFuse(panels.Fuse)
		elseif fusing and fuseTimer then
			(fuseTimer :: TextLabel).Text = "Ready in " .. Format.time(math.max(0, (fusing.readyAt or 0) - Workspace:GetServerTimeNow()))
		end
	end
	updateTutorial()
end

local function autoScale(scale: UIScale)
	local camera = Workspace.CurrentCamera
	local function update()
		local size = if camera then camera.ViewportSize else Vector2.new(1280, 720)
		scale.Scale = math.clamp(math.min(size.X / 1280, size.Y / 760), 0.55, 1.25)
	end
	update()
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(update)
	end
end

function Hud.start(screen: ScreenGui)
	gui = screen
	root = Ui.make("Frame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, Parent = gui })
	autoScale(Ui.make("UIScale", { Parent = gui }) :: UIScale)

	-- Goo-teller bovenin
	local top = Ui.make("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(420, 92), BackgroundColor3 = Ui.DARK, BackgroundTransparency = 0.1, Parent = root },
		{ Ui.corner(20), Ui.stroke(3, Color3.fromRGB(120, 255, 150)) })
	gooLabel = Ui.label("0 Goo", { Size = UDim2.new(1, -20, 0, 46), Position = UDim2.fromOffset(10, 4), TextColor3 = Color3.fromRGB(150, 255, 170), Parent = top })
	incomeLabel = Ui.label("+0/s", { Size = UDim2.new(0.6, -10, 0, 28), Position = UDim2.fromOffset(10, 54), TextXAlignment = Enum.TextXAlignment.Left, Parent = top })
	padsLabel = Ui.label("Pads", { Size = UDim2.new(0.4, -10, 0, 28), Position = UDim2.new(0.6, 0, 0, 54), TextXAlignment = Enum.TextXAlignment.Right, TextColor3 = Color3.fromRGB(210, 200, 245), Parent = top })
	tankLabel = Ui.label("", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 104), Size = UDim2.fromOffset(420, 26), TextColor3 = Ui.GOLD, Visible = false, Parent = root })

	-- Menuknoppen links
	local menu = Ui.make("Frame", { AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 12, 0.5, 0), Size = UDim2.fromOffset(170, 360), BackgroundTransparency = 1, Parent = root })
	Ui.make("UIGridLayout", { CellSize = UDim2.fromOffset(78, 78), CellPadding = UDim2.fromOffset(10, 10), SortOrder = Enum.SortOrder.LayoutOrder, Parent = menu })
	menuButton(menu, "🛒", "Shop", Ui.PINK, 1, function() openPanel("Shop") end)
	menuButton(menu, "📖", "Dex", Ui.BLUE, 2, function() openPanel("Dex") end)
	menuButton(menu, "♻️", "Rebirth", Ui.GREEN, 3, function() openPanel("Rebirth") end)
	menuButton(menu, "🧪", "Fuse", Color3.fromRGB(190, 110, 255), 4, function() openPanel("Fuse") end)
	local gifts = menuButton(menu, "🎁", "Gifts", Ui.GOLD, 5, function() openPanel("Gifts") end)
	giftBadge = Ui.label("", { Size = UDim2.fromOffset(30, 30), Position = UDim2.new(1, -20, 0, -10), BackgroundTransparency = 0, BackgroundColor3 = Ui.RED, Visible = false, ZIndex = 3, Parent = gifts })
	Ui.corner(15).Parent = giftBadge
	menuButton(menu, "🎟️", "Codes", Color3.fromRGB(120, 200, 200), 6, function() openPanel("Codes") end)
	menuButton(menu, "📅", "Daily", Color3.fromRGB(255, 150, 90), 7, function() openPanel("Daily") end)
	menuButton(menu, "👋", "Invite", Color3.fromRGB(120, 160, 255), 8, function()
		pcall(function()
			SocialService:PromptGameInvite(player)
		end)
	end)

	-- Status rechtsboven
	local status = Ui.make("Frame", { AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -12, 0, 12), Size = UDim2.fromOffset(250, 170), BackgroundTransparency = 1, Parent = root })
	Ui.make("UIListLayout", { Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder, Parent = status })
	stormLabel = statusCard(status, 1, Color3.fromRGB(200, 190, 240))
	luckLabel = statusCard(status, 2, Color3.fromRGB(120, 255, 200))
	eventLabel = statusCard(status, 3, Ui.GOLD)
	local oddsButton = Ui.button("River odds", Ui.BLUE, { Size = UDim2.fromOffset(250, 40), LayoutOrder = 4, Parent = status }, showRiverOdds)
	local _ = oddsButton

	-- Meldingen rechtsonder, aankondigingen bovenin
	toastList = Ui.make("Frame", { AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -12, 1, -110), Size = UDim2.fromOffset(380, 300), BackgroundTransparency = 1, Parent = root })
	Ui.make("UIListLayout", { Padding = UDim.new(0, 6), VerticalAlignment = Enum.VerticalAlignment.Bottom, SortOrder = Enum.SortOrder.LayoutOrder, Parent = toastList })
	announceLabel = Ui.label("", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 140), Size = UDim2.fromOffset(900, 46), Visible = false, Parent = root })

	-- Tutorial onderin
	tutorialFrame = Ui.make("Frame", { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -120), Size = UDim2.fromOffset(760, 56), BackgroundColor3 = Ui.DARK, BackgroundTransparency = 0.1, Visible = false, Parent = root },
		{ Ui.corner(16), Ui.stroke(3, Ui.GREEN) })
	tutorialLabel = Ui.label("", { Size = UDim2.new(1, -20, 1, -12), Position = UDim2.fromOffset(10, 6), TextColor3 = Color3.fromRGB(170, 255, 190), Parent = tutorialFrame })

	-- Panelen
	local PANELS: { { name: string, title: string, color: Color3 } } = {
		{ name = "Shop", title = "SLIME SHOP", color = Ui.PINK },
		{ name = "Dex", title = "SLIMEDEX", color = Ui.BLUE },
		{ name = "Rebirth", title = "REBIRTH", color = Ui.GREEN },
		{ name = "Fuse", title = "FUSE MACHINE", color = Color3.fromRGB(190, 110, 255) },
		{ name = "Codes", title = "CODES", color = Color3.fromRGB(120, 200, 200) },
		{ name = "Gifts", title = "PLAYTIME GIFTS", color = Ui.GOLD },
		{ name = "Daily", title = "DAILY REWARD", color = Color3.fromRGB(255, 150, 90) },
	}
	for _, info in PANELS do
		local _, body = makePanel(info.name, info.title, info.color)
		body.Name = "Body"
	end
	panelBuilders.Shop = buildShop
	panelBuilders.Dex = buildDex
	panelBuilders.Rebirth = buildRebirth
	panelBuilders.Fuse = buildFuse
	panelBuilders.Codes = buildCodes
	panelBuilders.Gifts = buildGifts
	panelBuilders.Daily = buildDaily

	oddsPanel = Ui.make("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.52), Size = UDim2.fromOffset(560, 520), BackgroundColor3 = Ui.PANEL, Visible = false, ZIndex = 20, Parent = root },
		{ Ui.corner(20), Ui.stroke(4, Ui.BLUE), Ui.gradient(Color3.fromRGB(60, 40, 120), Color3.fromRGB(28, 18, 56)) })

	-- Kiosken in de wereld openen de juiste panelen
	ProximityPromptService.PromptTriggered:Connect(function(prompt: ProximityPrompt, who: Player)
		if who ~= player then
			return
		end
		local opens = prompt:GetAttribute("Opens")
		if typeof(opens) == "string" then
			openPanel(opens)
		end
	end)

	-- Meldingen van de server
	;(remotes:WaitForChild("Notify") :: RemoteEvent).OnClientEvent:Connect(function(text: string, kind: string)
		toast(text, kind)
		if kind == "rare" then
			Sound.play("rare")
		end
	end)
	;(remotes:WaitForChild("Announce") :: RemoteEvent).OnClientEvent:Connect(function(text: string, color: string)
		local ok, c = pcall(Color3.fromHex, color)
		announce(text, if ok then c else Ui.WHITE)
	end)
	;(remotes:WaitForChild("Alarm") :: RemoteEvent).OnClientEvent:Connect(function(thief: string, slime: string)
		announce(string.format("%s is stealing your %s! BONK THEM!", thief, slime), Ui.RED)
	end)
	player.AttributeChanged:Connect(function(name: string)
		if (string.sub(name, 1, 5) == "Pass_" or name == "RandomItemsRestricted") and openName == "Shop" then
			buildShop(panels.Shop)
		end
	end)
	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(who: Player, id: number, purchased: boolean)
		if who ~= player or not purchased then
			return
		end
		for _, item in PASS_ITEMS do
			if Config.PASSES[item.key] == id then
				toast("Thank you! " .. item.name .. " is now active.", "rare")
				Sound.play("rare")
			end
		end
	end)

	ClientState.onChange(onState)
	local dailyShown = false
	ClientState.onChange(function(data)
		if not dailyShown and data.dailyReady == true then
			dailyShown = true
			task.delay(2, function()
				openPanel("Daily")
			end)
		end
	end)

	local acc = 0
	RunService.Heartbeat:Connect(function(dt)
		acc += dt
		if acc >= 0.25 then
			acc = 0
			updateStatus()
		end
	end)
end

return Hud
