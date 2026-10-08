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
	local function aim(angle: number)
		local offset = CFrame.Angles(0, angle, 0) * Vector3.new(S * 0.55, S * 0.55, -S * 2.6)
		camera.CFrame = CFrame.lookAt(target + offset, target)
	end
	aim(0)
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
			-- Het model staat stil (welds werken hier niet); de camera zwaait er rustig omheen.
			aim(math.sin(os.clock() * 0.9) * 0.6)
		end)
	end
	return frame
end

return SlimeIcon
