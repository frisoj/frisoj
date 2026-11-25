--!strict
--[[
	Theme — every visual constant of the UI style guide (spec §14): colours, gradients, fonts, text sizes, corner
	radii, stroke widths, layout sizes, animation times and z-indexes. Kit, the HUD and every window read their
	numbers from here so the whole game stays one chunky cartoon style.

	Units: all sizes are DESIGN PIXELS on the 1920x1080 reference screen. Everything on screen sits under a UIScale
	owned by WindowManager, so a "26 px" text is 26 px at 1080p and scales with the viewport everywhere else.

	    Theme.Color.Coins                     a Color3
	    Theme.Gradient.Panel                  a ColorSequence for a vertical UIGradient (Rotation = 90)
	    Theme.buttonGradient("success")       gradient of a button style
	    Theme.rarityColor("Epic")             rarity colour (from Config.Rarities; unknown rarity = Common)
	    Theme.rarityGradient("Exclusive")     rainbow for rainbow rarities, soft two-tone otherwise
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))

local Theme = {}

export type ButtonStyle = "primary" | "success" | "danger" | "robux" | "neutral" | "gold" | "tab"
export type TextStyle = "title" | "heading" | "button" | "number" | "body" | "small"
export type Currency = "coins" | "gems" | "robux"

local hex = Color3.fromHex

-- Top → bottom gradient (use with UIGradient.Rotation = 90).
local function vertical(top: Color3, bottom: Color3): ColorSequence
	return ColorSequence.new(top, bottom)
end

-- Button gradient: top → bottom, with a darker "lip" along the lower edge that gives the chunky 3D look.
local function lipped(top: Color3, bottom: Color3): ColorSequence
	local edge = bottom:Lerp(Color3.new(0, 0, 0), 0.22)
	return ColorSequence.new({
		ColorSequenceKeypoint.new(0, top),
		ColorSequenceKeypoint.new(0.84, bottom),
		ColorSequenceKeypoint.new(0.85, edge),
		ColorSequenceKeypoint.new(1, edge),
	})
end

Theme.vertical = vertical
Theme.lipped = lipped

---------------------------------------------------------------------------------------------------
-- Colours

Theme.Color = {
	-- Surfaces
	Outline = hex("#12152E"), -- thick dark outline around everything
	PanelTop = hex("#2B3270"),
	PanelBottom = hex("#1E2352"),
	CardTop = hex("#3D4799"),
	CardBottom = hex("#2A3176"),
	Inset = hex("#171B42"), -- dark wells: progress bar track, text input, footer strips
	Backdrop = Color3.new(0, 0, 0), -- dim layer behind windows (see Theme.BackdropTransparency)
	White = Color3.new(1, 1, 1),

	-- Window title bar
	TitleTop = hex("#FFB627"),
	TitleBottom = hex("#FF8A00"),

	-- Button families (top / bottom of the gradient)
	GreenTop = hex("#4ADE5B"),
	GreenBottom = hex("#1FAE3C"),
	BlueTop = hex("#4DA8FF"),
	BlueBottom = hex("#2B6CF6"),
	RedTop = hex("#FF6B6B"),
	RedBottom = hex("#E03131"),
	GoldTop = hex("#FFD54A"),
	GoldBottom = hex("#FFA000"),
	NeutralTop = hex("#8A93C9"),
	NeutralBottom = hex("#6770AF"),
	TabTop = hex("#5661AF"), -- unselected tab pill
	TabBottom = hex("#434C94"),

	-- Text
	Text = Color3.new(1, 1, 1),
	TextMuted = hex("#C9D0F5"), -- descriptions, secondary lines
	TextDim = hex("#8A93C9"), -- disabled / placeholder
	TextDark = hex("#12152E"), -- text on very light surfaces

	-- Currencies and bars
	Coins = hex("#FFD23F"),
	Gems = hex("#5EE6FF"),
	XP = hex("#A6FF4D"),
	Robux = Color3.new(1, 1, 1),

	-- Feedback
	Success = hex("#4ADE5B"),
	Error = hex("#FF6B6B"),
	Info = hex("#4DA8FF"),
	Reward = hex("#FFD54A"),
	Badge = hex("#FF4D4D"), -- red notification dot
	Selected = Color3.new(1, 1, 1), -- outline of the selected card
}

Theme.BackdropTransparency = 0.45

---------------------------------------------------------------------------------------------------
-- Gradients (ColorSequences for a UIGradient with Rotation = 90, i.e. top → bottom)

local rainbowKeys: { ColorSequenceKeypoint } = {}
for index = 0, 6 do
	table.insert(rainbowKeys, ColorSequenceKeypoint.new(index / 6, Color3.fromHSV(index / 6, 0.65, 1)))
end

Theme.Gradient = {
	Panel = vertical(Theme.Color.PanelTop, Theme.Color.PanelBottom),
	Card = vertical(Theme.Color.CardTop, Theme.Color.CardBottom),
	TitleBar = vertical(Theme.Color.TitleTop, Theme.Color.TitleBottom),
	Green = lipped(Theme.Color.GreenTop, Theme.Color.GreenBottom),
	Blue = lipped(Theme.Color.BlueTop, Theme.Color.BlueBottom),
	Red = lipped(Theme.Color.RedTop, Theme.Color.RedBottom),
	Gold = lipped(Theme.Color.GoldTop, Theme.Color.GoldBottom),
	Neutral = lipped(Theme.Color.NeutralTop, Theme.Color.NeutralBottom),
	Tab = lipped(Theme.Color.TabTop, Theme.Color.TabBottom),
	XP = vertical(hex("#C9FF7A"), hex("#6FD81E")),
	Coins = vertical(hex("#FFE680"), hex("#FFB300")),
	Gems = vertical(hex("#A8F3FF"), hex("#22B8E6")),
	Shine = vertical(Color3.new(1, 1, 1), hex("#D5D9EE")), -- neutral shading for surfaces tinted by BackgroundColor3
	Rainbow = ColorSequence.new(rainbowKeys),
}

local BUTTON_GRADIENTS: { [string]: ColorSequence } = {
	primary = Theme.Gradient.Blue,
	success = Theme.Gradient.Green,
	danger = Theme.Gradient.Red,
	robux = Theme.Gradient.Green,
	neutral = Theme.Gradient.Neutral,
	gold = Theme.Gradient.Gold,
	tab = Theme.Gradient.Tab,
}

-- Gradient of a button style ("primary" blue, "success"/"robux" green, "danger" red, "gold", "neutral" grey,
-- "tab" muted indigo). Unknown styles fall back to "primary".
function Theme.buttonGradient(style: string): ColorSequence
	return BUTTON_GRADIENTS[style] or Theme.Gradient.Blue
end

---------------------------------------------------------------------------------------------------
-- Type

Theme.Font = {
	Title = Enum.Font.FredokaOne, -- titles, numbers, buttons
	Number = Enum.Font.FredokaOne,
	Button = Enum.Font.FredokaOne,
	Body = Enum.Font.GothamBold, -- body text
	BodyLight = Enum.Font.GothamMedium, -- long descriptions, small print
}

Theme.TextSize = {
	Title = 50, -- window title
	Heading = 28, -- card names, section headers
	Button = 26,
	Number = 30, -- currency amounts, big values
	Body = 20,
	Small = 16,
	Icon = 44, -- emoji icons on cards
}

local TEXT_FONTS: { [string]: Enum.Font } = {
	title = Theme.Font.Title,
	heading = Theme.Font.Title,
	button = Theme.Font.Button,
	number = Theme.Font.Number,
	body = Theme.Font.Body,
	small = Theme.Font.BodyLight,
}

local TEXT_SIZES: { [string]: number } = {
	title = Theme.TextSize.Title,
	heading = Theme.TextSize.Heading,
	button = Theme.TextSize.Button,
	number = Theme.TextSize.Number,
	body = Theme.TextSize.Body,
	small = Theme.TextSize.Small,
}

-- Font and size of a text style; unknown styles fall back to "body".
function Theme.textStyle(style: string): (Enum.Font, number)
	return TEXT_FONTS[style] or Theme.Font.Body, TEXT_SIZES[style] or Theme.TextSize.Body
end

---------------------------------------------------------------------------------------------------
-- Shape

Theme.Corner = {
	Window = 20,
	Panel = 18,
	Card = 16,
	Button = 14,
	Small = 10,
	Pill = 9999, -- Kit.corner turns anything >= 1000 into a full pill (UDim.new(1, 0))
}

Theme.Stroke = {
	Thick = 4, -- windows, HUD panels, cards
	Medium = 3, -- buttons, pills, toasts
	Thin = 2, -- small chips, dividers
	Text = 3, -- dark outline of big text (titles, numbers, buttons)
	TextThin = 2, -- outline of body-sized text
}

Theme.Size = {
	Reference = Vector2.new(1920, 1080), -- the screen the design pixels refer to
	Window = Vector2.new(1400, 830), -- default window (about 73% x 77% of the reference screen)
	TitleBar = 96, -- height of the gold window title bar
	CloseButton = 76, -- diameter of the red round close button
	WindowPadding = 26, -- gap between the window edge and its content frame
	TabBar = 60, -- height of a Kit.tabs row
	Button = Vector2.new(220, 60), -- default Kit.button
	ButtonSmall = Vector2.new(150, 48),
	Padding = 16, -- inner padding of cards and panels
	Gap = 14, -- gap between cards / list rows
	Touch = 88, -- smallest touch target: stays >= 44 real px at the minimum UI scale of 0.5
	ScrollBar = 8,
}

-- Animation times (seconds).
Theme.Time = {
	Fast = 0.1,
	Normal = 0.2,
	Slow = 0.35,
	Toast = 3.5, -- how long a toast stays
	Announce = 5,
}

-- Z-indexes. The four layers of the shared ScreenGui are siblings ordered by Layer*; inside a layer use the
-- small numbers (ZIndexBehavior is Sibling, so they only order siblings).
Theme.Z = {
	LayerHud = 1,
	LayerWindows = 10,
	LayerOverlay = 20,
	LayerNotifications = 30,
	Base = 1,
	Content = 2,
	Raised = 5, -- badges, ribbons, close buttons: things that sit on top of their siblings
	Top = 10,
}

-- ScreenGui.DisplayOrder of the shared "HUD" ScreenGui (the loading screen must use a higher value).
Theme.DisplayOrder = 5

---------------------------------------------------------------------------------------------------
-- Rarities and currencies

-- Rarity colours by rarity id, taken from Config.Rarities (the single source of truth).
local rarityColors: { [string]: Color3 } = {}
local rainbowRarities: { [string]: boolean } = {}
for _, def in Config.Rarities.list do
	rarityColors[def.id] = def.color
	rainbowRarities[def.id] = def.rainbow
end
Theme.Rarity = rarityColors

local FALLBACK_RARITY_COLOR = hex("#B8C1CC")

-- Colour of a rarity ("Common" ... "Exclusive"); unknown ids get the Common grey.
function Theme.rarityColor(rarity: string): Color3
	return rarityColors[rarity] or FALLBACK_RARITY_COLOR
end

-- True for rarities drawn with the animated rainbow (Exclusive).
function Theme.isRainbow(rarity: string): boolean
	return rainbowRarities[rarity] == true
end

-- Gradient for a rarity-coloured surface: light → rarity colour, or the rainbow for rainbow rarities.
function Theme.rarityGradient(rarity: string): ColorSequence
	if rainbowRarities[rarity] then
		return Theme.Gradient.Rainbow
	end
	local color = Theme.rarityColor(rarity)
	return vertical(color:Lerp(Color3.new(1, 1, 1), 0.35), color)
end

local CURRENCY_COLORS: { [string]: Color3 } = {
	coins = Theme.Color.Coins,
	gems = Theme.Color.Gems,
	robux = Theme.Color.Robux,
}

local CURRENCY_ICONS: { [string]: string } = {
	coins = "🪙",
	gems = "💎",
	robux = "R$",
}

-- Text colour of a currency amount ("coins" | "gems" | "robux").
function Theme.currencyColor(currency: string): Color3
	return CURRENCY_COLORS[currency] or Theme.Color.Text
end

-- Icon printed in front of a currency amount: 🪙, 💎 or "R$".
function Theme.currencyIcon(currency: string): string
	return CURRENCY_ICONS[currency] or ""
end

return Theme
