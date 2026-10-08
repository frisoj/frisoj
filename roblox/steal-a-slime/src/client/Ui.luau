--!strict
-- Kleine hulpfuncties voor de interface: instanties maken, afgeronde hoeken, randen,
-- verlopen, knoppen die meeveren, en zwevende labels boven dingen in de wereld.

local TweenService = game:GetService("TweenService")

local Sound = require(script.Parent:WaitForChild("Sound"))

local Ui = {}

Ui.FONT = Enum.Font.FredokaOne
Ui.DARK = Color3.fromRGB(32, 20, 58)
Ui.PANEL = Color3.fromRGB(48, 30, 86)
Ui.STROKE = Color3.fromRGB(20, 12, 40)
Ui.GREEN = Color3.fromRGB(90, 230, 120)
Ui.PINK = Color3.fromRGB(255, 100, 180)
Ui.GOLD = Color3.fromRGB(255, 205, 70)
Ui.BLUE = Color3.fromRGB(90, 180, 255)
Ui.RED = Color3.fromRGB(255, 90, 90)
Ui.WHITE = Color3.new(1, 1, 1)

function Ui.make(className: string, props: { [string]: any }, children: { any }?): any
	local inst = Instance.new(className)
	local parent = props.Parent
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
	if parent then
		inst.Parent = parent
	end
	return inst
end

function Ui.corner(radius: number): Instance
	return Ui.make("UICorner", { CornerRadius = UDim.new(0, radius) })
end

function Ui.stroke(thickness: number, color: Color3?): Instance
	return Ui.make("UIStroke", { Thickness = thickness, Color = color or Ui.STROKE, ApplyStrokeMode = Enum.ApplyStrokeMode.Border })
end

function Ui.textStroke(thickness: number, color: Color3?): Instance
	return Ui.make("UIStroke", { Thickness = thickness, Color = color or Ui.STROKE })
end

function Ui.gradient(a: Color3, b: Color3, rotation: number?): Instance
	return Ui.make("UIGradient", { Color = ColorSequence.new(a, b), Rotation = rotation or 90 })
end

function Ui.label(text: string, props: { [string]: any }): TextLabel
	local base: { [string]: any } = {
		BackgroundTransparency = 1,
		Font = Ui.FONT,
		Text = text,
		TextColor3 = Ui.WHITE,
		TextScaled = true,
	}
	for k, v in props do
		if k ~= "NoStroke" then
			base[k] = v
		end
	end
	local label = Ui.make("TextLabel", base) :: TextLabel
	if props.NoStroke ~= true then
		Ui.textStroke(2).Parent = label
	end
	return label
end

-- Een knop met verloop, rand en een veertje bij indrukken.
function Ui.button(text: string, color: Color3, props: { [string]: any }, onClick: () -> ()): TextButton
	local base: { [string]: any } = {
		AutoButtonColor = false,
		BackgroundColor3 = Ui.WHITE,
		Font = Ui.FONT,
		Text = text,
		TextColor3 = Ui.WHITE,
		TextScaled = true,
	}
	for k, v in props do
		base[k] = v
	end
	local button = Ui.make("TextButton", base) :: TextButton
	Ui.corner(12).Parent = button
	Ui.stroke(3).Parent = button
	Ui.gradient(color:Lerp(Ui.WHITE, 0.25), color:Lerp(Color3.new(0, 0, 0), 0.15)).Parent = button
	Ui.textStroke(2).Parent = button
	Ui.make("UIPadding", { PaddingLeft = UDim.new(0, 6), PaddingRight = UDim.new(0, 6), PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4), Parent = button })
	local scale = Ui.make("UIScale", { Parent = button }) :: UIScale
	button.MouseEnter:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12), { Scale = 1.05 }):Play()
	end)
	button.MouseLeave:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.12), { Scale = 1 }):Play()
	end)
	button.MouseButton1Down:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.06), { Scale = 0.93 }):Play()
	end)
	button.MouseButton1Up:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.1), { Scale = 1 }):Play()
	end)
	button.Activated:Connect(function()
		Sound.play("click")
		onClick()
	end)
	return button
end

-- Laat een frame verend verschijnen.
function Ui.pop(frame: GuiObject)
	local scale = frame:FindFirstChildOfClass("UIScale") or Ui.make("UIScale", { Parent = frame })
	scale.Scale = 0.6
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
end

-- Zwevend label boven een onderdeel in de wereld.
function Ui.billboard(adornee: BasePart, height: number, width: number, rows: number, maxDistance: number): (BillboardGui, { TextLabel })
	local gui = Ui.make("BillboardGui", {
		Adornee = adornee,
		Size = UDim2.new(width, 0, rows * 0.55, 0),
		StudsOffsetWorldSpace = Vector3.new(0, height, 0),
		AlwaysOnTop = false,
		LightInfluence = 0,
		MaxDistance = maxDistance,
		ResetOnSpawn = false,
	}) :: BillboardGui
	local labels: { TextLabel } = {}
	for i = 1, rows do
		local label = Ui.label("", {
			Size = UDim2.new(1, 0, 1 / rows, 0),
			Position = UDim2.new(0, 0, (i - 1) / rows, 0),
			Parent = gui,
		})
		table.insert(labels, label)
	end
	return gui, labels
end

function Ui.rgb(rgb: { number }): Color3
	return Color3.fromRGB(rgb[1], rgb[2], rgb[3])
end

return Ui
