--!strict
-- Vangen: vlieg of loop dicht genoeg langs een Driftling en je net doet de rest.
-- De client meldt het, de server controleert de afstand.
--
-- Elke frame testen we het hele stukje dat je sinds de vorige frame hebt
-- afgelegd, zodat je bij hoge snelheid (spuitgat) niets mist.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Debris = game:GetService("Debris")

local Remotes = ReplicatedStorage:WaitForChild("Remotes")
local CatchRemote = Remotes:WaitForChild("Catch") :: RemoteEvent

local player = Players.LocalPlayer

local CatchController = {}

local RETRY_SECONDS = 0.3
local MAX_STEP = 40 -- grotere sprong in één frame = teleport/respawn, niet meetellen

local pending: { [Instance]: number } = {}
local bursted: { [Instance]: boolean } = {}
local lastPos: Vector3? = nil

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
		bursted[child] = nil
	end)

	RunService.Heartbeat:Connect(function()
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if root == nil then
			lastPos = nil
			return
		end
		local pos = root.Position
		local from = lastPos or pos
		if (pos - from).Magnitude > MAX_STEP then
			from = pos
		end
		lastPos = pos

		local segment = pos - from
		local lengthSq = segment:Dot(segment)
		local range = (tonumber(player:GetAttribute("NetRange")) or 12)
		local now = os.clock()
		for _, model in folder:GetChildren() do
			if model:IsA("Model") and now - (pending[model] or 0) > RETRY_SECONDS then
				local target = model:GetPivot().Position
				local t = if lengthSq > 0 then math.clamp((target - from):Dot(segment) / lengthSq, 0, 1) else 0
				local closest = from + segment * t
				if (target - closest).Magnitude <= range then
					pending[model] = now
					CatchRemote:FireServer(model.Name)
					if not bursted[model] then
						bursted[model] = true
						burst(target)
					end
				end
			end
		end
	end)
end

return CatchController
