--[[
	3D world classes: BasePart, Model/PVInstance, Workspace, Camera, Attachment, joints, Sound, effects, Lighting.

	There is no physics: nothing falls, collides or stays welded together. Moving a part moves only that part;
	Model:PivotTo / BasePart:PivotTo move all descendant parts rigidly (so `character:PivotTo(cf)` moves the whole
	rig, while `rootPart.CFrame = cf` moves only the root part). Spatial queries are simple approximations.
	workspace:Raycast returns nil unless a test installs a handler (env.mocks.setRaycastHandler / setRaycastTarget).
]]
return function(H)
	local sched = H.sched
	local config = H.config
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Vector3, Vector2, CFrame, Ray = roblox.Vector3, roblox.Vector2, roblox.CFrame, roblox.Ray
	local mocks = H.mocks

	config.viewportSize = Vector2.new(1280, 720) -- Camera.ViewportSize; change with env.mocks.setViewportSize

	--------------------------------------------------------------------------------------------------------------
	-- BasePart
	--------------------------------------------------------------------------------------------------------------
	local BasePart = H.class("BasePart")

	local function rotationOf(cframe: any): any
		return cframe - cframe.Position
	end

	BasePart.props.Position = {
		get = function(self)
			return self.CFrame.Position
		end,
		set = function(self, value)
			if typeof(value) ~= "Vector3" then
				error(`Unable to assign property Position. Vector3 expected, got {H.typeof(value)}`, 3)
			end
			self.CFrame = CFrame.new(value) * rotationOf(self.CFrame)
		end,
	}
	BasePart.props.Orientation = {
		get = function(self)
			local x, y, z = self.CFrame:ToOrientation()
			return Vector3.new(math.deg(x), math.deg(y), math.deg(z))
		end,
		set = function(self, value)
			if typeof(value) ~= "Vector3" then
				error(`Unable to assign property Orientation. Vector3 expected, got {H.typeof(value)}`, 3)
			end
			self.CFrame = CFrame.new(self.CFrame.Position)
				* CFrame.fromOrientation(math.rad(value.X), math.rad(value.Y), math.rad(value.Z))
		end,
	}
	BasePart.props.Rotation = {
		get = function(self)
			local x, y, z = self.CFrame:ToEulerAnglesXYZ()
			return Vector3.new(math.deg(x), math.deg(y), math.deg(z))
		end,
		set = function(self, value)
			if typeof(value) ~= "Vector3" then
				error(`Unable to assign property Rotation. Vector3 expected, got {H.typeof(value)}`, 3)
			end
			self.CFrame = CFrame.new(self.CFrame.Position) * CFrame.Angles(math.rad(value.X), math.rad(value.Y), math.rad(value.Z))
		end,
	}
	BasePart.props.BrickColor = {
		get = function(self)
			return roblox.BrickColor.new(self.Color)
		end,
		set = function(self, value)
			if typeof(value) ~= "BrickColor" then
				error(`Unable to assign property BrickColor. BrickColor expected, got {H.typeof(value)}`, 3)
			end
			self.Color = value.Color
		end,
	}
	BasePart.changed.CFrame = function(self)
		H.notify(self, "Position")
		H.notify(self, "Orientation")
	end

	local function massOf(part: any): number
		local size = part.Size
		return if part.Massless then 0 else size.X * size.Y * size.Z * 0.7
	end
	BasePart.props.Mass = { get = massOf }
	BasePart.props.AssemblyMass = { get = massOf }
	BasePart.props.ExtentsSize = {
		get = function(self)
			return self.Size
		end,
	}
	BasePart.props.ExtentsCFrame = {
		get = function(self)
			return self.CFrame
		end,
	}
	BasePart.props.CenterOfMass = {
		get = function()
			return Vector3.zero
		end,
	}
	BasePart.props.AssemblyCenterOfMass = {
		get = function(self)
			return self.CFrame.Position
		end,
	}
	BasePart.props.AssemblyRootPart = {
		get = function(self)
			return self
		end,
	}
	BasePart.methods.GetMass = massOf
	BasePart.methods.GetRootPart = function(self)
		return self
	end

	local function noop() end
	BasePart.methods.ApplyImpulse = noop
	BasePart.methods.ApplyAngularImpulse = noop
	BasePart.methods.ApplyImpulseAtPosition = noop
	BasePart.methods.SetNetworkOwner = noop
	BasePart.methods.SetNetworkOwnershipAuto = noop
	BasePart.methods.GetNetworkOwner = function()
		return nil
	end
	BasePart.methods.GetNetworkOwnershipAuto = function()
		return true
	end
	BasePart.methods.CanSetNetworkOwnership = function()
		return true
	end
	BasePart.methods.GetTouchingParts = function()
		return {}
	end
	BasePart.methods.GetConnectedParts = function()
		return {}
	end
	BasePart.methods.GetJoints = function()
		return {}
	end
	BasePart.methods.CanCollideWith = function()
		return true
	end
	BasePart.methods.IsGrounded = function()
		return false
	end
	BasePart.methods.GetVelocityAtPosition = function()
		return Vector3.zero
	end

	--------------------------------------------------------------------------------------------------------------
	-- pivots, models
	--------------------------------------------------------------------------------------------------------------
	local Model = H.class("Model")

	local function partsOf(root: any): { any }
		local parts = {}
		if root:IsA("BasePart") then
			table.insert(parts, root)
		end
		for _, descendant in root:GetDescendants() do
			if descendant:IsA("BasePart") then
				table.insert(parts, descendant)
			end
		end
		return parts
	end

	-- Bounding box of `parts` expressed in the frame `orientation`: returns centre CFrame and size.
	local function boundingBox(parts: { any }, orientation: any): (any, any)
		if #parts == 0 then
			return orientation, Vector3.zero
		end
		local minX, minY, minZ = math.huge, math.huge, math.huge
		local maxX, maxY, maxZ = -math.huge, -math.huge, -math.huge
		for _, part in parts do
			local relative = orientation:ToObjectSpace(part.CFrame)
			local half = part.Size / 2
			local right, up, back = relative.XVector, relative.YVector, relative.ZVector
			local extentX = math.abs(right.X) * half.X + math.abs(up.X) * half.Y + math.abs(back.X) * half.Z
			local extentY = math.abs(right.Y) * half.X + math.abs(up.Y) * half.Y + math.abs(back.Y) * half.Z
			local extentZ = math.abs(right.Z) * half.X + math.abs(up.Z) * half.Y + math.abs(back.Z) * half.Z
			local position = relative.Position
			minX, maxX = math.min(minX, position.X - extentX), math.max(maxX, position.X + extentX)
			minY, maxY = math.min(minY, position.Y - extentY), math.max(maxY, position.Y + extentY)
			minZ, maxZ = math.min(minZ, position.Z - extentZ), math.max(maxZ, position.Z + extentZ)
		end
		local centre = orientation * CFrame.new((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
		return centre, Vector3.new(maxX - minX, maxY - minY, maxZ - minZ)
	end

	Model.props.PrimaryPart = {
		get = function(self)
			local part = H.raw(self, "PrimaryPart")
			if part and H.isDestroyed(part) then
				return nil
			end
			return part
		end,
		set = function(self, value)
			if value ~= nil and not (H.isInstance(value) and value:IsA("BasePart")) then
				error(`Unable to assign property PrimaryPart. BasePart expected, got {H.typeof(value)}`, 3)
			end
			H.rawset(self, "PrimaryPart", value)
		end,
	}

	local function modelPivot(model: any): any
		local primary = model.PrimaryPart
		if primary then
			return primary.CFrame * primary.PivotOffset
		end
		local stored = H.state(model).worldPivot
		if stored then
			return stored
		end
		local centre = boundingBox(partsOf(model), CFrame.identity)
		return centre
	end

	Model.props.WorldPivot = {
		get = modelPivot,
		set = function(self, value)
			if typeof(value) ~= "CFrame" then
				error(`Unable to assign property WorldPivot. CFrame expected, got {H.typeof(value)}`, 3)
			end
			H.state(self).worldPivot = value
		end,
	}

	local function movePivot(root: any, oldPivot: any, newPivot: any)
		for _, part in partsOf(root) do
			part.CFrame = newPivot * oldPivot:ToObjectSpace(part.CFrame)
		end
		for _, descendant in root:GetDescendants() do
			if descendant:IsA("Model") and H.state(descendant).worldPivot then
				H.state(descendant).worldPivot = newPivot * oldPivot:ToObjectSpace(H.state(descendant).worldPivot)
			end
		end
	end

	function Model.methods.GetPivot(self: any): any
		return modelPivot(self)
	end

	function Model.methods.PivotTo(self: any, target: any)
		if typeof(target) ~= "CFrame" then
			error(`PivotTo: CFrame expected, got {H.typeof(target)}`, 2)
		end
		local oldPivot = modelPivot(self)
		movePivot(self, oldPivot, target)
		if not self.PrimaryPart then
			H.state(self).worldPivot = target
		end
	end

	function Model.methods.GetBoundingBox(self: any): (any, any)
		local primary = self.PrimaryPart
		local orientation = if primary then rotationOf(primary.CFrame) else CFrame.identity
		return boundingBox(partsOf(self), orientation)
	end

	function Model.methods.GetExtentsSize(self: any): any
		local _, size = Model.methods.GetBoundingBox(self)
		return size
	end

	function Model.methods.MoveTo(self: any, position: any)
		if typeof(position) ~= "Vector3" then
			error(`MoveTo: Vector3 expected, got {H.typeof(position)}`, 2)
		end
		local pivot = modelPivot(self)
		Model.methods.PivotTo(self, CFrame.new(position) * rotationOf(pivot))
	end

	function Model.methods.GetScale(self: any): number
		return H.state(self).scale or 1
	end

	function Model.methods.ScaleTo(self: any, scale: number)
		if type(scale) ~= "number" or scale <= 0 then
			error("ScaleTo: scale must be a positive number", 2)
		end
		local state = H.state(self)
		local factor = scale / (state.scale or 1)
		state.scale = scale
		local pivot = modelPivot(self)
		for _, part in partsOf(self) do
			local relative = pivot:ToObjectSpace(part.CFrame)
			part.Size = part.Size * factor
			part.CFrame = pivot * (rotationOf(relative) + relative.Position * factor)
		end
	end

	function BasePart.methods.GetPivot(self: any): any
		return self.CFrame * self.PivotOffset
	end

	function BasePart.methods.PivotTo(self: any, target: any)
		if typeof(target) ~= "CFrame" then
			error(`PivotTo: CFrame expected, got {H.typeof(target)}`, 2)
		end
		movePivot(self, self.CFrame * self.PivotOffset, target)
	end

	--------------------------------------------------------------------------------------------------------------
	-- Workspace
	--------------------------------------------------------------------------------------------------------------
	local Workspace = H.class("Workspace")
	local raycastHandler: ((origin: any, direction: any, params: any?) -> any)? = nil

	local RaycastResult = {}
	RaycastResult.__index = RaycastResult
	RaycastResult.__tostring = function(self)
		return `RaycastResult\{{tostring(self.Instance)} @ {tostring(self.Position)}\}`
	end
	H.typeNames[RaycastResult] = "RaycastResult"

	local function newRaycastResult(fields: { [string]: any }): any
		return table.freeze(setmetatable({
			Instance = fields.Instance,
			Position = fields.Position or Vector3.zero,
			Normal = fields.Normal or Vector3.yAxis,
			Material = fields.Material or Enum.Material.Plastic,
			Distance = fields.Distance or 0,
		}, RaycastResult))
	end

	local function castArguments(origin: any, direction: any, params: any, name: string)
		if typeof(origin) ~= "Vector3" or typeof(direction) ~= "Vector3" then
			error(`{name}: origin and direction must be Vector3 values`, 3)
		end
		if params ~= nil and H.typeof(params) ~= "RaycastParams" then
			error(`{name}: third argument must be a RaycastParams, got {H.typeof(params)}`, 3)
		end
	end

	function Workspace.methods.Raycast(_self: any, origin: any, direction: any, params: any?): any
		castArguments(origin, direction, params, "Raycast")
		if raycastHandler then
			local result = raycastHandler(origin, direction, params)
			if result ~= nil and H.typeof(result) ~= "RaycastResult" then
				result = newRaycastResult(result)
			end
			return result
		end
		return nil
	end
	Workspace.methods.Spherecast = function(_self: any, _position: any, _radius: number, _direction: any, _params: any?)
		return nil
	end
	Workspace.methods.Blockcast = function(_self: any, _cframe: any, _size: any, _direction: any, _params: any?)
		return nil
	end
	Workspace.methods.Shapecast = function(_self: any, _part: any, _direction: any, _params: any?)
		return nil
	end

	function Workspace.methods.GetServerTimeNow(_self: any): number
		return sched.unixTime()
	end
	function Workspace.methods.GetRealPhysicsFPS(_self: any): number
		return 60
	end
	Workspace.props.DistributedGameTime = {
		get = function()
			return sched.now()
		end,
	}

	-- OverlapParams filtering shared by the spatial queries below
	local function passesFilter(part: any, params: any?): boolean
		if not params then
			return true
		end
		local listed = false
		for _, root in params.FilterDescendantsInstances do
			if part == root or part:IsDescendantOf(root) then
				listed = true
				break
			end
		end
		if params.FilterType == Enum.RaycastFilterType.Include then
			return listed
		end
		return not listed
	end

	local function queryParts(self: any, params: any?, test: (part: any) -> boolean): { any }
		local found = {}
		local maxParts = params and params.MaxParts or 0
		for _, descendant in self:GetDescendants() do
			if descendant:IsA("BasePart") and passesFilter(descendant, params) and test(descendant) then
				table.insert(found, descendant)
				if maxParts > 0 and #found >= maxParts then
					break
				end
			end
		end
		return found
	end

	function Workspace.methods.GetPartBoundsInRadius(self: any, position: any, radius: number, params: any?): { any }
		return queryParts(self, params, function(part)
			local reach = radius + part.Size.Magnitude / 2
			return (part.Position - position).Magnitude <= reach
		end)
	end

	function Workspace.methods.GetPartBoundsInBox(self: any, cframe: any, size: any, params: any?): { any }
		local half = size / 2
		return queryParts(self, params, function(part)
			local offset = cframe:PointToObjectSpace(part.Position)
			local reach = part.Size.Magnitude / 2
			return math.abs(offset.X) <= half.X + reach and math.abs(offset.Y) <= half.Y + reach and math.abs(offset.Z) <= half.Z + reach
		end)
	end

	function Workspace.methods.GetPartsInPart(self: any, part: any, params: any?): { any }
		return queryParts(self, params, function(other)
			if other == part then
				return false
			end
			return (other.Position - part.Position).Magnitude <= (other.Size.Magnitude + part.Size.Magnitude) / 2
		end)
	end

	function Workspace.methods.ArePartsTouchingOthers(_self: any, _parts: { any }): boolean
		return false
	end

	function Workspace.methods.BulkMoveTo(_self: any, parts: { any }, cframes: { any }, _mode: any?)
		for position, part in parts do
			part.CFrame = cframes[position]
		end
	end

	Workspace.methods.GetPivot = function()
		return CFrame.identity
	end

	--------------------------------------------------------------------------------------------------------------
	-- Camera
	--------------------------------------------------------------------------------------------------------------
	local Camera = H.class("Camera")
	Camera.defaults.CameraType = Enum.CameraType.Custom
	Camera.props.ViewportSize = {
		get = function()
			return config.viewportSize
		end,
	}
	Camera.defaults.NearPlaneZ = -0.1

	local function project(self: any, point: any): (any, boolean)
		if typeof(point) ~= "Vector3" then
			error(`Vector3 expected, got {H.typeof(point)}`, 3)
		end
		local viewport = config.viewportSize
		local relative = self.CFrame:PointToObjectSpace(point)
		local depth = -relative.Z
		local halfHeight = math.tan(math.rad(self.FieldOfView) / 2) * math.max(math.abs(depth), 1e-6)
		local halfWidth = halfHeight * viewport.X / viewport.Y
		local x = viewport.X / 2 + relative.X / halfWidth * viewport.X / 2
		local y = viewport.Y / 2 - relative.Y / halfHeight * viewport.Y / 2
		local onScreen = depth > 0 and x >= 0 and x <= viewport.X and y >= 0 and y <= viewport.Y
		return Vector3.new(x, y, depth), onScreen
	end
	Camera.methods.WorldToViewportPoint = project
	Camera.methods.WorldToScreenPoint = project

	local function pointToRay(self: any, x: number, y: number, depth: number?): any
		local viewport = config.viewportSize
		local slope = math.tan(math.rad(self.FieldOfView) / 2)
		local direction = Vector3.new(
			(x - viewport.X / 2) / (viewport.Y / 2) * slope,
			-(y - viewport.Y / 2) / (viewport.Y / 2) * slope,
			-1
		).Unit
		local worldDirection = self.CFrame:VectorToWorldSpace(direction)
		return Ray.new(self.CFrame.Position + worldDirection * (depth or 0), worldDirection)
	end
	Camera.methods.ViewportPointToRay = pointToRay
	Camera.methods.ScreenPointToRay = pointToRay
	Camera.methods.GetRenderCFrame = function(self: any)
		return self.CFrame
	end
	Camera.methods.GetPartsObscuringTarget = function()
		return {}
	end

	--------------------------------------------------------------------------------------------------------------
	-- Attachment, joints
	--------------------------------------------------------------------------------------------------------------
	local Attachment = H.class("Attachment")

	local function parentCFrame(self: any): any
		local parent = self.Parent
		if parent and parent:IsA("BasePart") then
			return parent.CFrame
		elseif parent and parent:IsA("Attachment") then
			return parent.WorldCFrame
		end
		return CFrame.identity
	end

	Attachment.props.WorldCFrame = {
		get = function(self)
			return parentCFrame(self) * self.CFrame
		end,
		set = function(self, value)
			self.CFrame = parentCFrame(self):ToObjectSpace(value)
		end,
	}
	Attachment.props.WorldPosition = {
		get = function(self)
			return (parentCFrame(self) * self.CFrame).Position
		end,
		set = function(self, value)
			local world = parentCFrame(self) * self.CFrame
			self.CFrame = parentCFrame(self):ToObjectSpace(CFrame.new(value) * rotationOf(world))
		end,
	}
	Attachment.props.Position = {
		get = function(self)
			return self.CFrame.Position
		end,
		set = function(self, value)
			self.CFrame = CFrame.new(value) * rotationOf(self.CFrame)
		end,
	}
	Attachment.props.Orientation = {
		get = function(self)
			local x, y, z = self.CFrame:ToOrientation()
			return Vector3.new(math.deg(x), math.deg(y), math.deg(z))
		end,
		set = function(self, value)
			self.CFrame = CFrame.new(self.CFrame.Position)
				* CFrame.fromOrientation(math.rad(value.X), math.rad(value.Y), math.rad(value.Z))
		end,
	}

	H.class("JointInstance").defaults.Active = true
	H.class("WeldConstraint").defaults.Active = true
	H.class("WeldConstraint").defaults.Enabled = true
	H.class("Constraint").defaults.Active = true
	H.class("BaseScript").defaults.Enabled = true

	--------------------------------------------------------------------------------------------------------------
	-- Sound
	--------------------------------------------------------------------------------------------------------------
	local Sound = H.class("Sound")
	mocks.soundsPlayed = {} -- { { sound = Sound, soundId = string, time = virtual seconds } } in play order

	-- Sounds with a SoundId pretend to be config.soundLength seconds long (so Ended fires); sounds without one
	-- have length 0 like in Roblox. H.rawset(sound, "TimeLength", seconds) overrides it for one sound.
	config.soundLength = 1
	Sound.props.TimeLength = {
		get = function(self)
			local explicit = H.raw(self, "TimeLength")
			if explicit ~= nil then
				return explicit
			end
			return if self.SoundId ~= "" then config.soundLength else 0
		end,
	}
	Sound.defaults.PlaybackLoudness = 0
	Sound.props.IsLoaded = {
		get = function()
			return true
		end,
	}
	Sound.props.IsPlaying = {
		get = function(self)
			return H.state(self).playing == true
		end,
	}
	Sound.props.IsPaused = {
		get = function(self)
			return H.state(self).playing ~= true
		end,
	}

	local function playSound(self: any)
		local state = H.state(self)
		state.playing = true
		state.token = (state.token or 0) + 1
		local token = state.token
		table.insert(mocks.soundsPlayed, { sound = self, soundId = self.SoundId, time = sched.now() })
		H.fireExisting(self, "Played", self.SoundId)
		H.notify(self, "IsPlaying")
		local length = self.TimeLength
		if length > 0 and not self.Looped then
			sched.delay(length / math.max(self.PlaybackSpeed, 0.01), function()
				if state.token == token and state.playing then
					state.playing = false
					H.fireExisting(self, "Ended", self.SoundId)
					H.notify(self, "IsPlaying")
				end
			end)
		end
	end

	local function stopSound(self: any, event: string)
		local state = H.state(self)
		if state.playing then
			state.playing = false
			state.token = (state.token or 0) + 1
			H.fireExisting(self, event, self.SoundId)
			H.notify(self, "IsPlaying")
		end
	end

	Sound.methods.Play = playSound
	Sound.methods.Resume = playSound
	Sound.methods.Stop = function(self: any)
		stopSound(self, "Stopped")
	end
	Sound.methods.Pause = function(self: any)
		stopSound(self, "Paused")
	end
	Sound.props.Playing = {
		get = function(self)
			return H.state(self).playing == true
		end,
		set = function(self, value)
			if value then
				if not H.state(self).playing then
					playSound(self)
				end
			else
				stopSound(self, "Stopped")
			end
		end,
	}
	Sound.destroyed = function(self)
		H.state(self).playing = false
	end

	local SoundService = H.class("SoundService")
	function SoundService.methods.PlayLocalSound(_self: any, sound: any)
		if not (H.isInstance(sound) and sound:IsA("Sound")) then
			error("PlayLocalSound: expected a Sound", 2)
		end
		table.insert(mocks.soundsPlayed, { sound = sound, soundId = sound.SoundId, time = sched.now(), localSound = true })
	end
	SoundService.methods.SetListener = noop
	SoundService.methods.GetListener = function()
		return Enum.ListenerType.Camera, nil
	end

	--------------------------------------------------------------------------------------------------------------
	-- effects, lighting, misc
	--------------------------------------------------------------------------------------------------------------
	local ParticleEmitter = H.class("ParticleEmitter")
	function ParticleEmitter.methods.Emit(self: any, count: number?)
		local state = H.state(self)
		state.emitted = (state.emitted or 0) + (count or 16)
	end
	ParticleEmitter.methods.Clear = noop
	H.class("Trail").methods.Clear = noop

	H.class("MeshPart").defaults.MeshId = ""
	H.class("MeshPart").defaults.MeshSize = Vector3.zero

	local Lighting = H.class("Lighting")
	Lighting.defaults.ClockTime = 14
	Lighting.defaults.TimeOfDay = "14:00:00"
	function Lighting.methods.GetMinutesAfterMidnight(self: any): number
		return self.ClockTime * 60
	end
	function Lighting.methods.SetMinutesAfterMidnight(self: any, minutes: number)
		self.ClockTime = minutes / 60
	end
	function Lighting.methods.GetSunDirection(_self: any): any
		return Vector3.new(0, 1, 0)
	end
	function Lighting.methods.GetMoonDirection(_self: any): any
		return Vector3.new(0, -1, 0)
	end
	function Lighting.methods.GetMoonPhase(_self: any): number
		return 0.5
	end

	local Team = H.class("Team")
	function Team.methods.GetPlayers(self: any): { any }
		local members = {}
		for _, player in H.game:GetService("Players"):GetPlayers() do
			if player.Team == self then
				table.insert(members, player)
			end
		end
		return members
	end
	H.class("Teams").methods.GetTeams = function(self: any): { any }
		local teams = {}
		for _, child in self:GetChildren() do
			if child:IsA("Team") then
				table.insert(teams, child)
			end
		end
		return teams
	end

	local Tool = H.class("Tool")
	function Tool.methods.Activate(self: any)
		H.fire(self, "Activated")
	end
	function Tool.methods.Deactivate(self: any)
		H.fire(self, "Deactivated")
	end

	table.insert(H.bootHooks, function()
		local workspace = H.workspace
		local camera = H.create("Camera", { Parent = workspace })
		H.rawset(workspace, "CurrentCamera", camera)
		local terrain = H.create("Terrain", { Parent = workspace })
		H.rawset(workspace, "Terrain", terrain)
	end)

	-- test API -----------------------------------------------------------------------------------------------------

	-- setRaycastHandler(fn): fn(origin, direction, raycastParams) -> nil | RaycastResult | { Instance=, Position=,
	-- Normal=, Material=, Distance= }. Pass nil to restore "rays hit nothing".
	function mocks.setRaycastHandler(handler: ((origin: any, direction: any, params: any?) -> any)?)
		raycastHandler = handler
	end

	-- setRaycastTarget(part): every workspace:Raycast hits `part` at its position (nil: hit nothing again)
	function mocks.setRaycastTarget(part: any?)
		if part == nil then
			raycastHandler = nil
			return
		end
		raycastHandler = function(origin: any)
			local position = if part:IsA("BasePart") then part.Position else part:GetPivot().Position
			return { Instance = part, Position = position, Distance = (position - origin).Magnitude }
		end
	end

	mocks.newRaycastResult = newRaycastResult

	-- setViewportSize(Vector2): changes Camera.ViewportSize and fires its changed signal
	function mocks.setViewportSize(size: any)
		config.viewportSize = size
		local camera = H.workspace.CurrentCamera
		if camera then
			H.notify(camera, "ViewportSize")
		end
		sched.flush()
	end

	return nil
end
