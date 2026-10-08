--!strict
-- Een slijmpje als 3D-plaatje in de interface (ViewportFrame), voor de Slijmdex, de winkel,
-- de Fuse Machine en de eier-onthulling.

local RunService = game:GetService("RunService")

local SlimeModel = require(script.Parent:WaitForChild("SlimeModel"))

local SlimeIcon = {}

-- Maakt een ViewportFrame met het slijmpje erin. `spin` laat het langzaam draaien.
function SlimeIcon.new(species: string, mut: string?, fuse: number, spin: boolean?): ViewportFrame
	local frame = Instance.new("ViewportFrame")
	frame.BackgroundTransparency = 1
	frame.Ambient = Color3.fromRGB(200, 190, 220)
	frame.LightColor = Color3.fromRGB(255, 250, 240)
	frame.LightDirection = Vector3.new(-1, -1.4, -0.8)
	local visual = SlimeModel.build(species, mut, fuse)
	-- Deeltjes en lampjes werken niet in een ViewportFrame; die laten we weg.
	for _, d in visual.model:GetDescendants() do
		if d:IsA("ParticleEmitter") or d:IsA("Light") then
			d:Destroy()
		end
	end
	SlimeModel.place(visual, CFrame.new(), 0, 0)
	visual.model.Parent = frame
	local camera = Instance.new("Camera")
	camera.FieldOfView = 32
	local S = visual.size
	local target = Vector3.new(0, visual.height * 0.55, 0)
	camera.CFrame = CFrame.lookAt(target + Vector3.new(S * 0.55, S * 0.55, -S * 2.6), target)
	camera.Parent = frame
	frame.CurrentCamera = camera
	if spin then
		local shown = false
		local conn: RBXScriptConnection
		conn = RunService.RenderStepped:Connect(function()
			if not frame:IsDescendantOf(game) then
				if shown then
					conn:Disconnect()
				end
				return
			end
			shown = true
			local t = os.clock()
			SlimeModel.place(visual, CFrame.Angles(0, math.sin(t * 0.9) * 0.6, 0), t, 0.5)
		end)
	end
	return frame
end

return SlimeIcon
