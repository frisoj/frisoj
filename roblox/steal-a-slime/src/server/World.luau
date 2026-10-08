--!strict
-- Kleine dingen in de wereld die bij het starten worden aangezet: de kiosken op het plein
-- (Shop, Codes, Rebirth, Slijmdex, Fuse Machine) krijgen een knop die het juiste scherm opent.

local Workspace = game:GetService("Workspace")

local World = {}

local KIOSKS = {
	Shop = { action = "Shop", object = "Slime Shop" },
	Codes = { action = "Codes", object = "Code Terminal" },
	Rebirth = { action = "Rebirth", object = "Rebirth Altar" },
	Dex = { action = "Slimedex", object = "Slimedex" },
	Fuse = { action = "Fuse", object = "Fuse Machine" },
}

local function addPrompt(part: BasePart, opens: string)
	local info = KIOSKS[opens]
	if not info then
		return
	end
	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "OpenPrompt"
	prompt.ActionText = info.action
	prompt.ObjectText = info.object
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 12
	prompt.RequiresLineOfSight = false
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt:SetAttribute("Opens", opens)
	prompt.Parent = part
end

-- Borden met tekst (de mapbouwer zet het attribuut SignText; tekst kan pas in de game).
local function addSign(part: BasePart, text: string)
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(part.Size.X * 40, part.Size.Y * 40)
	gui.LightInfluence = 0
	gui.Brightness = 1.5
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(0.92, 0, 0.84, 0)
	label.Position = UDim2.new(0.04, 0, 0.08, 0)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Text = text
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(30, 18, 50)
	stroke.Parent = label
	gui.Parent = part
end

function World.start()
	for _, part in Workspace:GetDescendants() do
		if part:IsA("BasePart") then
			local opens = part:GetAttribute("Opens")
			if typeof(opens) == "string" then
				addPrompt(part, opens)
			end
			local sign = part:GetAttribute("SignText")
			if typeof(sign) == "string" then
				addSign(part, sign)
			end
		end
	end
end

return World
