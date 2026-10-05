--!strict
-- Het scherm van de speler: Parels, de lucht, meldingen, winkel, Sky-dex en codes.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MarketplaceService = game:GetService("MarketplaceService")
local TweenService = game:GetService("TweenService")
local TextChatService = game:GetService("TextChatService")
local SoundService = game:GetService("SoundService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local SkyForecast = require(Shared:WaitForChild("SkyForecast"))
local Biomes = require(Shared:WaitForChild("Biomes"))
local Driftlings = require(Shared:WaitForChild("Driftlings"))
local Upgrades = require(Shared:WaitForChild("Upgrades"))
local Format = require(Shared:WaitForChild("Format"))

local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local ActionRemote = Remotes:WaitForChild("Action") :: RemoteEvent
local NotifyRemote = Remotes:WaitForChild("Notify") :: RemoteEvent
local AnnounceRemote = Remotes:WaitForChild("Announce") :: RemoteEvent
local SyncRemote = Remotes:WaitForChild("Sync") :: RemoteEvent

local Client = script.Parent
local Movement = require(Client:WaitForChild("Movement"))

local player = Players.LocalPlayer

local Hud = {}

-- Kleuren en lettertypes
local INK = Color3.fromRGB(14, 28, 48)
local PANEL = Color3.fromRGB(20, 38, 64)
local WHITE = Color3.new(1, 1, 1)
local MUTED = Color3.fromRGB(175, 195, 220)
local GOLD = Color3.fromRGB(255, 200, 70)
local GREEN = Color3.fromRGB(90, 200, 120)
local RED = Color3.fromRGB(235, 95, 95)
local BLUE = Color3.fromRGB(70, 140, 220)
local TITLE = Enum.Font.FredokaOne
local BODY = Enum.Font.GothamMedium
local BOLD = Enum.Font.GothamBold

type SyncState = {
	nest: { { s: string, m: string? } },
	dex: { [string]: { n: number, m: { [string]: boolean } } },
	levels: { [string]: number },
	nestCap: number,
	migrations: number,
	migrationCost: number,
	tutorialDone: boolean,
}

local state: SyncState? = nil
local gui: ScreenGui
local toastList: Frame
local openPanel: Frame? = nil
local renderers: { [Frame]: () -> () } = {}

-- Kleine helper om UI te bouwen.
local function make(className: string, props: { [string]: any }, children: { any }?): any
	local inst = Instance.new(className)
	for k, v in props do
		if k ~= "Parent" then
			(inst :: any)[k] = v
		end
	end
	if children then
		for _, child in children do
			child.Parent = inst
		end
	end
	if props.Parent then
		inst.Parent = props.Parent
	end
	return inst
end

local function corner(r: number?): any
	return make("UICorner", { CornerRadius = UDim.new(0, r or 12) })
end

local function stroke(color: Color3?, transparency: number?): any
	return make("UIStroke", {
		Color = color or WHITE,
		Transparency = transparency or 0.8,
		Thickness = 1.5,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	})
end

local function padding(px: number): any
	return make("UIPadding", {
		PaddingTop = UDim.new(0, px),
		PaddingBottom = UDim.new(0, px),
		PaddingLeft = UDim.new(0, px),
		PaddingRight = UDim.new(0, px),
	})
end

local function text(props: { [string]: any }): TextLabel
	local defaults: { [string]: any } = {
		BackgroundTransparency = 1,
		Font = BODY,
		TextColor3 = WHITE,
		TextScaled = true,
		TextWrapped = true,
	}
	for k, v in props do
		defaults[k] = v
	end
	return make("TextLabel", defaults)
end

local function button(props: { [string]: any }, onClick: () -> ()): TextButton
	local defaults: { [string]: any } = {
		AutoButtonColor = true,
		Font = TITLE,
		TextColor3 = WHITE,
		TextScaled = true,
		BackgroundColor3 = BLUE,
	}
	for k, v in props do
		defaults[k] = v
	end
	local b = make("TextButton", defaults, { corner(10), make("UITextSizeConstraint", { MaxTextSize = 22 }) })
	b.Activated:Connect(onClick)
	return b
end

-- Meldingen ---------------------------------------------------------------

local KIND_COLORS: { [string]: Color3 } = {
	good = GREEN,
	bad = RED,
	info = BLUE,
	catch = Color3.fromRGB(80, 170, 255),
	rare = Color3.fromRGB(190, 110, 255),
	feast = GOLD,
}

local function playSound(id: string, volume: number, speed: number?)
	local s = Instance.new("Sound")
	s.SoundId = id
	s.Volume = volume
	s.PlaybackSpeed = speed or 1
	s.Parent = SoundService
	s:Play()
	task.delay(3, function()
		s:Destroy()
	end)
end

local function toast(message: string, kind: string?)
	local color = KIND_COLORS[kind or "info"] or BLUE
	local frame = make("Frame", {
		Size = UDim2.new(1, 0, 0, 40),
		BackgroundColor3 = INK,
		BackgroundTransparency = 0.15,
		Parent = toastList,
	}, {
		corner(10),
		stroke(color, 0.2),
		text({
			Size = UDim2.new(1, -20, 1, -10),
			Position = UDim2.fromOffset(10, 5),
			Text = message,
			Font = BOLD,
			TextColor3 = WHITE,
		}),
	})
	if kind == "catch" or kind == "rare" then
		playSound("rbxasset://sounds/electronicpingshort.wav", 0.5, if kind == "rare" then 0.8 else 1.2)
	end
	task.delay(4.5, function()
		local fade = TweenInfo.new(0.4)
		TweenService:Create(frame, fade, { BackgroundTransparency = 1 }):Play()
		for _, d in frame:GetDescendants() do
			if d:IsA("TextLabel") then
				TweenService:Create(d, fade, { TextTransparency = 1 }):Play()
			elseif d:IsA("UIStroke") then
				TweenService:Create(d, fade, { Transparency = 1 }):Play()
			end
		end
		task.wait(0.45)
		frame:Destroy()
	end)
end

local announceLabel: TextLabel

local function announce(message: string, kind: string?)
	announceLabel.Text = message
	announceLabel.TextColor3 = KIND_COLORS[kind or "info"] or WHITE
	announceLabel.TextTransparency = 0
	announceLabel.TextStrokeTransparency = 0.3
	announceLabel.Visible = true
	playSound("rbxasset://sounds/electronicpingshort.wav", 0.6, 0.6)
	local stamp = os.clock()
	announceLabel:SetAttribute("Stamp", stamp)
	task.delay(6, function()
		if announceLabel:GetAttribute("Stamp") == stamp then
			TweenService:Create(announceLabel, TweenInfo.new(0.6), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		end
	end)
end

-- Panelen (winkel, Sky-dex, codes) -----------------------------------------

local function closePanel()
	if openPanel then
		openPanel.Visible = false
		openPanel = nil
	end
end

local function showPanel(panel: Frame)
	if openPanel == panel then
		closePanel()
		return
	end
	closePanel()
	openPanel = panel
	panel.Visible = true
	local render = renderers[panel]
	if render then
		render()
	end
end

local function makePanel(title: string): (Frame, ScrollingFrame)
	local panel = make("Frame", {
		Name = title,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.52),
		Size = UDim2.fromScale(0.9, 0.72),
		BackgroundColor3 = PANEL,
		BackgroundTransparency = 0.05,
		Visible = false,
		Parent = gui,
	}, {
		corner(16),
		stroke(WHITE, 0.75),
		make("UISizeConstraint", { MaxSize = Vector2.new(520, 560) }),
	})
	text({
		Text = title,
		Font = TITLE,
		Size = UDim2.new(1, -70, 0, 34),
		Position = UDim2.fromOffset(18, 12),
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = panel,
	})
	button({
		Text = "X",
		Size = UDim2.fromOffset(38, 38),
		Position = UDim2.new(1, -50, 0, 10),
		BackgroundColor3 = RED,
		Parent = panel,
	}, closePanel)
	local list = make("ScrollingFrame", {
		Position = UDim2.fromOffset(14, 58),
		Size = UDim2.new(1, -28, 1, -70),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ScrollBarThickness = 6,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		Parent = panel,
	}, {
		make("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }),
	})
	return panel, list
end

local function clearList(list: ScrollingFrame)
	for _, child in list:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
end

local function sectionTitle(list: ScrollingFrame, title: string, order: number)
	text({
		Text = title,
		Font = TITLE,
		TextColor3 = MUTED,
		Size = UDim2.new(1, 0, 0, 24),
		TextXAlignment = Enum.TextXAlignment.Left,
		LayoutOrder = order,
		Parent = list,
	})
end

local function row(list: ScrollingFrame, order: number, title: string, detail: string, buttonText: string, buttonColor: Color3, onClick: (() -> ())?)
	local frame = make("Frame", {
		Size = UDim2.new(1, -8, 0, 64),
		BackgroundColor3 = INK,
		BackgroundTransparency = 0.2,
		LayoutOrder = order,
		Parent = list,
	}, { corner(10) })
	text({
		Text = title,
		Font = BOLD,
		Size = UDim2.new(0.62, -12, 0, 26),
		Position = UDim2.fromOffset(12, 6),
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = frame,
	})
	text({
		Text = detail,
		TextColor3 = MUTED,
		Size = UDim2.new(0.62, -12, 0, 22),
		Position = UDim2.fromOffset(12, 34),
		TextXAlignment = Enum.TextXAlignment.Left,
		Parent = frame,
	})
	local b = button({
		Text = buttonText,
		BackgroundColor3 = buttonColor,
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -10, 0.5, 0),
		Size = UDim2.new(0.36, 0, 0, 42),
		Parent = frame,
	}, function()
		if onClick then
			onClick()
		end
	end)
	b.AutoButtonColor = onClick ~= nil
end

-- Prijzen van producten en passes ophalen (één keer, daarna onthouden).
local priceCache: { [string]: string } = {}
local function priceText(id: number, infoType: Enum.InfoType): string
	if id == 0 then
		return "Not set up"
	end
	local key = tostring(infoType) .. id
	local cached = priceCache[key]
	if cached then
		return cached
	end
	priceCache[key] = "Buy"
	task.spawn(function()
		local ok, info = pcall(function()
			return MarketplaceService:GetProductInfo(id, infoType)
		end)
		if ok and info and info.PriceInRobux then
			priceCache[key] = "R$ " .. tostring(info.PriceInRobux)
			if openPanel and renderers[openPanel] then
				renderers[openPanel]()
			end
		end
	end)
	return "Buy"
end

local PASS_INFO = {
	{ key = "DoublePearls", title = "2x Pearls", detail = "Your nest makes double Pearls, forever." },
	{ key = "VIPCaptain", title = "VIP Captain", detail = "+2 nest slots and a gold [VIP] chat tag." },
	{ key = "Weatherman", title = "Weatherman", detail = "See 3 skies ahead + alerts for rare skies." },
}

local PRODUCT_INFO = {
	{ key = "GoldenFeast", title = "Golden Feast", detail = "2x Pearls for the WHOLE server, 10 min." },
	{ key = "MegaFeast", title = "MEGA Feast", detail = "3x Pearls for the WHOLE server, 30 min." },
	{ key = "PearlPack", title = "Pearl Pack", detail = "30 minutes of your income, right now." },
}

local function buildShop(): Frame
	local panel, list = makePanel("SHOP")
	renderers[panel] = function()
		clearList(list)
		local s = state
		local pearls = (tonumber(player:GetAttribute("Pearls")) or 0)
		local order = 0
		local function nextOrder(): number
			order += 1
			return order
		end

		sectionTitle(list, "UPGRADES", nextOrder())
		for _, kind in Upgrades.KINDS do
			local level = if s then s.levels[kind] or 1 else 1
			local info = Upgrades.INFO[kind]
			local cost = Upgrades.nextCost(kind, level)
			local detail = string.format("Lv %d: %d %s", level, Upgrades.value(kind, level), info.unit)
			if cost then
				local canBuy = pearls >= cost
				row(list, nextOrder(), info.title, detail, Format.number(cost), if canBuy then GREEN else Color3.fromRGB(90, 100, 115), function()
					ActionRemote:FireServer("upgrade", kind)
				end)
			else
				row(list, nextOrder(), info.title, detail, "MAX", GOLD, nil)
			end
		end

		sectionTitle(list, "MIGRATION", nextOrder())
		local cost = if s then s.migrationCost else Config.MIGRATION_BASE_COST
		local migrations = if s then s.migrations else 0
		row(list, nextOrder(), "Migrate (rebirth)",
			string.format("Reset for +%d%% Pearls forever. Done: %d", math.floor(Config.MIGRATION_BONUS * 100), migrations),
			Format.number(cost), if pearls >= cost then GOLD else Color3.fromRGB(90, 100, 115), function()
				ActionRemote:FireServer("migrate")
			end)

		sectionTitle(list, "SERVER BOOSTS", nextOrder())
		for _, p in PRODUCT_INFO do
			local id = (Config.PRODUCTS :: any)[p.key] :: number
			row(list, nextOrder(), p.title, p.detail, priceText(id, Enum.InfoType.Product), GOLD, if id ~= 0
				then function()
					MarketplaceService:PromptProductPurchase(player, id)
				end
				else nil)
		end

		sectionTitle(list, "PASSES", nextOrder())
		for _, p in PASS_INFO do
			local id = (Config.PASSES :: any)[p.key] :: number
			local owned = player:GetAttribute(if p.key == "VIPCaptain" then "VIP" else p.key) == true
			if owned then
				row(list, nextOrder(), p.title, p.detail, "OWNED", GREEN, nil)
			else
				row(list, nextOrder(), p.title, p.detail, priceText(id, Enum.InfoType.GamePass), BLUE, if id ~= 0
					then function()
						MarketplaceService:PromptGamePassPurchase(player, id)
					end
					else nil)
			end
		end
	end
	return panel
end

local function buildDex(): Frame
	local panel, list = makePanel("SKY-DEX")
	renderers[panel] = function()
		clearList(list)
		local odds = {}
		for _, r in Driftlings.RARITIES do
			table.insert(odds, string.format("%s %s%%", r.id, tostring(r.weight)))
		end
		text({
			Text = "Base odds: " .. table.concat(odds, " · ") .. ". Islands and the Eclipse have better odds. Some Driftlings only appear in one sky.",
			TextColor3 = MUTED,
			Size = UDim2.new(1, -8, 0, 40),
			TextXAlignment = Enum.TextXAlignment.Left,
			LayoutOrder = 0,
			Parent = list,
		})
		local dex = if state then state.dex else {}
		for i, id in Driftlings.ORDER do
			local species = Driftlings.SPECIES[id]
			local rarity = Driftlings.RARITY_BY_ID[species.rarity]
			local entry = dex[id]
			local title = if entry then species.name else "???"
			local where = if species.zone == "soon" then "Coming soon"
				elseif species.biome then "Only in " .. Biomes.get(species.biome).name
				elseif species.zone == "island" then "Floating islands"
				else "Anywhere in the sky"
			local detail = species.rarity .. " · " .. Format.number(species.rate) .. "/min · " .. where
			if entry then
				local muts = {}
				for _, mutId in Biomes.ORDER do
					local b = Biomes.LIST[mutId]
					if b.mutation and entry.m[b.mutation] then
						table.insert(muts, b.mutation)
					end
				end
				if #muts > 0 then
					detail ..= " · " .. table.concat(muts, ", ")
				end
			end
			local count = if entry then "x" .. entry.n else "-"
			row(list, i, title, detail, count, rarity.color:Lerp(INK, 0.35), nil)
		end
	end
	return panel
end

local function buildCodes(): Frame
	local panel, list = makePanel("CODES")
	local box = make("TextBox", {
		PlaceholderText = "Type a code",
		Text = "",
		ClearTextOnFocus = false,
		Font = BOLD,
		TextScaled = true,
		TextColor3 = WHITE,
		PlaceholderColor3 = MUTED,
		BackgroundColor3 = INK,
		Size = UDim2.new(1, -8, 0, 52),
		LayoutOrder = 1,
		Parent = list,
	}, { corner(10), padding(10) })
	button({
		Text = "REDEEM",
		BackgroundColor3 = GREEN,
		Size = UDim2.new(1, -8, 0, 48),
		LayoutOrder = 2,
		Parent = list,
	}, function()
		if #box.Text > 0 then
			ActionRemote:FireServer("code", box.Text)
			box.Text = ""
		end
	end)
	text({
		Text = "New codes drop with every update. Join the group for the latest ones!",
		TextColor3 = MUTED,
		Size = UDim2.new(1, -8, 0, 40),
		LayoutOrder = 3,
		Parent = list,
	})
	return panel
end

-- Opbouw ----------------------------------------------------------------------

function Hud.start()
	gui = make("ScreenGui", {
		Name = "HUD",
		ResetOnSpawn = false,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Parent = player:WaitForChild("PlayerGui"),
	})

	-- Op kleine schermen (telefoons) worden de vaste onderdelen kleiner.
	local scalers: { UIScale } = {}
	local function autoScale(target: GuiObject)
		local scaler = Instance.new("UIScale")
		scaler.Parent = target
		table.insert(scalers, scaler)
	end
	local function updateScale()
		local camera = Workspace.CurrentCamera
		if camera == nil then
			return
		end
		local size = camera.ViewportSize
		local factor = math.clamp(math.min(size.X / 1000, size.Y / 620), 0.55, 1)
		for _, scaler in scalers do
			scaler.Scale = factor
		end
	end

	-- Parels (linksboven)
	local pearlsPanel = make("Frame", {
		Position = UDim2.fromOffset(12, 12),
		Size = UDim2.fromOffset(220, 74),
		BackgroundColor3 = INK,
		BackgroundTransparency = 0.2,
		Parent = gui,
	}, { corner(14), stroke(GOLD, 0.5) })
	autoScale(pearlsPanel)
	text({ Text = "PEARLS", Font = BOLD, TextColor3 = GOLD, Size = UDim2.new(1, -20, 0, 16), Position = UDim2.fromOffset(12, 6), TextXAlignment = Enum.TextXAlignment.Left, Parent = pearlsPanel })
	local pearlsLabel = text({ Text = "0", Font = TITLE, Size = UDim2.new(1, -20, 0, 32), Position = UDim2.fromOffset(12, 22), TextXAlignment = Enum.TextXAlignment.Left, Parent = pearlsPanel })
	local rateLabel = text({ Text = "+0/min", Font = BOLD, TextColor3 = MUTED, Size = UDim2.new(1, -20, 0, 14), Position = UDim2.fromOffset(12, 55), TextXAlignment = Enum.TextXAlignment.Left, Parent = pearlsPanel })

	-- Midden boven: lucht, boost en hint onder elkaar
	local topColumn = make("Frame", {
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 10),
		Size = UDim2.fromOffset(420, 150),
		BackgroundTransparency = 1,
		Parent = gui,
	}, {
		make("UIListLayout", {
			Padding = UDim.new(0, 6),
			HorizontalAlignment = Enum.HorizontalAlignment.Center,
			SortOrder = Enum.SortOrder.LayoutOrder,
		}),
	})
	autoScale(topColumn)

	local skyPanel = make("Frame", {
		Size = UDim2.fromOffset(300, 78),
		BackgroundColor3 = INK,
		BackgroundTransparency = 0.25,
		LayoutOrder = 1,
		Parent = topColumn,
	}, { corner(14) })
	local skyStroke = stroke(BLUE, 0.3)
	skyStroke.Parent = skyPanel
	local skyName = text({ Text = "", Font = TITLE, Size = UDim2.new(1, -16, 0, 30), Position = UDim2.fromOffset(8, 4), Parent = skyPanel })
	local skyMut = text({ Text = "", Font = BOLD, TextColor3 = MUTED, Size = UDim2.new(1, -16, 0, 16), Position = UDim2.fromOffset(8, 36), Parent = skyPanel })
	local skyNext = text({ Text = "", Font = BODY, TextColor3 = MUTED, Size = UDim2.new(1, -16, 0, 16), Position = UDim2.fromOffset(8, 56), Parent = skyPanel })

	-- Feestmaal / walvislied (onder de lucht)
	local boostLabel = text({
		Text = "",
		Font = TITLE,
		TextColor3 = GOLD,
		TextStrokeTransparency = 0.3,
		Size = UDim2.fromOffset(420, 26),
		Visible = false,
		LayoutOrder = 2,
		Parent = topColumn,
	})

	-- Tutorial-hint
	local hintLabel = text({
		Text = "",
		Font = TITLE,
		TextColor3 = Color3.fromRGB(255, 235, 140),
		TextStrokeTransparency = 0.2,
		Size = UDim2.fromOffset(420, 30),
		Visible = false,
		LayoutOrder = 3,
		Parent = topColumn,
	})

	-- Grote aankondiging
	announceLabel = text({
		Text = "",
		Font = TITLE,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.3),
		Size = UDim2.new(0.8, 0, 0, 50),
		TextStrokeTransparency = 0.3,
		Visible = false,
		Parent = gui,
	})
	make("UITextSizeConstraint", { MaxTextSize = 40, Parent = announceLabel })

	-- Meldingen (onder in het midden)
	toastList = make("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -24),
		Size = UDim2.new(0.6, 0, 0, 220),
		BackgroundTransparency = 1,
		Parent = gui,
	}, {
		make("UIListLayout", { Padding = UDim.new(0, 6), VerticalAlignment = Enum.VerticalAlignment.Bottom, SortOrder = Enum.SortOrder.LayoutOrder }),
		make("UISizeConstraint", { MaxSize = Vector2.new(460, 220) }),
	})
	autoScale(toastList)

	-- Knoppen (links, onder de Parels: rechtsonder zit op telefoons de springknop)
	local shop = buildShop()
	local dex = buildDex()
	local codes = buildCodes()

	local side = make("Frame", {
		AnchorPoint = Vector2.new(0, 0.5),
		Position = UDim2.new(0, 12, 0.55, 0),
		Size = UDim2.fromOffset(110, 312),
		BackgroundTransparency = 1,
		Parent = gui,
	}, { make("UIListLayout", { Padding = UDim.new(0, 8), SortOrder = Enum.SortOrder.LayoutOrder }) })
	autoScale(side)

	local function sideButton(label: string, color: Color3, order: number, onClick: () -> ()): TextButton
		return button({ Text = label, BackgroundColor3 = color, Size = UDim2.new(1, 0, 0, 56), LayoutOrder = order, Parent = side }, onClick)
	end

	sideButton("SHOP", GREEN, 1, function()
		showPanel(shop)
	end)
	sideButton("SKY-DEX", BLUE, 2, function()
		showPanel(dex)
	end)
	sideButton("CODES", Color3.fromRGB(120, 100, 200), 3, function()
		showPanel(codes)
	end)
	sideButton("FEAST", Color3.fromRGB(215, 160, 30), 4, function()
		if Config.PRODUCTS.GoldenFeast ~= 0 then
			MarketplaceService:PromptProductPurchase(player, Config.PRODUCTS.GoldenFeast)
		else
			toast("The Golden Feast isn't set up yet (Config.PRODUCTS).", "bad")
		end
	end)
	local glideButton = sideButton("GLIDE: ON", Color3.fromRGB(60, 90, 130), 5, function()
		Movement.toggle()
	end)
	Movement.GlideChanged:Connect(function(_, closed)
		glideButton.Text = if closed then "GLIDE: OFF" else "GLIDE: ON"
	end)

	local camera = Workspace.CurrentCamera
	if camera then
		camera:GetPropertyChangedSignal("ViewportSize"):Connect(updateScale)
	end
	updateScale()

	-- Parels bijwerken
	local function updatePearls()
		pearlsLabel.Text = Format.number((tonumber(player:GetAttribute("Pearls")) or 0))
		rateLabel.Text = "+" .. Format.number((tonumber(player:GetAttribute("Rate")) or 0)) .. "/min"
	end
	player:GetAttributeChangedSignal("Pearls"):Connect(updatePearls)
	player:GetAttributeChangedSignal("Rate"):Connect(updatePearls)
	updatePearls()

	-- Server-berichten
	NotifyRemote.OnClientEvent:Connect(function(payload)
		if type(payload) == "table" and type(payload.text) == "string" then
			toast(payload.text, payload.kind)
		end
	end)
	AnnounceRemote.OnClientEvent:Connect(function(payload)
		if type(payload) == "table" and type(payload.text) == "string" then
			announce(payload.text, payload.kind)
		end
	end)
	SyncRemote.OnClientEvent:Connect(function(payload)
		state = payload
		if openPanel and renderers[openPanel] then
			renderers[openPanel]()
		end
	end)

	-- [VIP] voor het chatbericht van VIP-spelers
	TextChatService.OnIncomingMessage = function(message: TextChatMessage)
		local source = message.TextSource
		if source then
			local speaker = Players:GetPlayerByUserId(source.UserId)
			if speaker and speaker:GetAttribute("VIP") then
				local props = Instance.new("TextChatMessageProperties")
				props.PrefixText = "<font color='#FFD24A'>[VIP]</font> " .. message.PrefixText
				return props
			end
		end
		return nil :: any
	end

	-- Hint voor nieuwe spelers
	local launchedOnce = false
	Movement.Launched:Connect(function()
		launchedOnce = true
	end)

	-- Elke halve seconde: lucht, boosts, hints en weerwaarschuwingen
	local warned: { [number]: boolean } = {}
	task.spawn(function()
		while true do
			local now = Workspace:GetServerTimeNow()
			local id, left = SkyForecast.current(now)
			local b = Biomes.get(id)
			skyName.Text = b.name
			skyName.TextColor3 = b.uiColor
			skyStroke.Color = b.uiColor
			skyMut.Text = if b.mutation then string.format("%s x%d · %d%% chance", b.mutation, Biomes.MUTATIONS[b.mutation].mult, math.floor(b.chance * 100)) else b.blurb

			local weatherman = player:GetAttribute("Weatherman") == true
			local upcoming = SkyForecast.upcoming(now, if weatherman then 3 else 1)
			local parts = {}
			for i, slot in upcoming do
				local nb = Biomes.get(slot.id)
				table.insert(parts, if i == 1 then nb.name .. " in " .. Format.clock(left) else nb.name)
			end
			skyNext.Text = "Next: " .. table.concat(parts, " > ")

			-- Weatherman: waarschuwing een minuut voor een zeldzame lucht
			if weatherman then
				local nextSlot = upcoming[1]
				local rare = nextSlot.id == "Aurora" or nextSlot.id == "Starfall" or nextSlot.id == "Eclipse"
				if rare and left <= 60 and not warned[nextSlot.startsAt] then
					warned[nextSlot.startsAt] = true
					toast(Biomes.get(nextSlot.id).name .. " starts in 1 minute! Get ready.", "rare")
				end
			end

			local feastEnds = (tonumber(Workspace:GetAttribute("FeastEndsAt")) or 0)
			local songEnds = (tonumber(Workspace:GetAttribute("SongEndsAt")) or 0)
			if feastEnds > now then
				boostLabel.Visible = true
				boostLabel.Text = string.format("%s's FEAST · %dx PEARLS · %s",
					tostring(Workspace:GetAttribute("FeastBy") or "?"), (tonumber(Workspace:GetAttribute("FeastMult")) or 2), Format.clock(feastEnds - now))
			elseif songEnds > now then
				boostLabel.Visible = true
				boostLabel.Text = "WHALE SONG · 2x DRIFTLINGS · " .. Format.clock(songEnds - now)
			else
				boostLabel.Visible = false
			end

			local done = state ~= nil and (state :: SyncState).tutorialDone
			if done then
				hintLabel.Visible = false
			else
				hintLabel.Visible = true
				hintLabel.Text = if launchedOnce then "Fly through Driftlings to catch them!" else "Jump into the BLOWHOLE to fly!"
			end

			task.wait(0.5)
		end
	end)
end

return Hud
