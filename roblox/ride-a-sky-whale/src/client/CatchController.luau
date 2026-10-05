--!strict
-- Vangen: vlieg of loop dicht genoeg langs een Driftling en je net doet de rest.
-- De client meldt het, de server controleert de afstand.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local CatchRemote = Remotes:WaitForChild("Catch") :: RemoteEvent

local player = Players.LocalPlayer

local CatchController = {}

local pending: { [Instance]: number } = {}

local function burst(position: Vector3)
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Transparency = 1
	p.Size = Vector3.one
	p.CFrame = CFrame.new(position)
	p.Parent = Workspace
	local e = Instance.new("ParticleEmitter")
	e.Color = ColorSequence.new(Color3.fromRGB(255, 240, 170))
	e.LightEmission = 1
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.8), NumberSequenceKeypoint.new(1, 0) })
	e.Speed = NumberRange.new(10, 20)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Lifetime = NumberRange.new(0.4, 0.7)
	e.Rate = 0
	e.Parent = p
	e:Emit(24)
	Debris:AddItem(p, 1.5)
end

function CatchController.start()
	local folder = Workspace:WaitForChild("SkyDriftlings")
	folder.ChildRemoved:Connect(function(child)
		pending[child] = nil
	end)

	task.spawn(function()
		while true do
			task.wait(0.08)
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if root then
				local range = (tonumber(player:GetAttribute("NetRange")) or 12)
				local now = os.clock()
				for _, model in folder:GetChildren() do
					if model:IsA("Model") and now - (pending[model] or 0) > 1 then
						local pos = model:GetPivot().Position
						if (pos - root.Position).Magnitude <= range then
							pending[model] = now
							CatchRemote:FireServer(model.Name)
							burst(pos)
						end
					end
				end
			end
		end
	end)
end

return CatchController
