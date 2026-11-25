--[[
	Humanoid, Animator / AnimationTrack and the character rig builder.

	H.buildCharacter(player, rigType?) creates a minimal but structurally correct rig: R15 (default) with all 15
	body parts + HumanoidRootPart, Motor6D joints with the standard names (Root, Waist, Neck, RightShoulder,
	RightElbow, RightWrist ...), grip/hat attachments, Humanoid + Animator; or R6 (Torso, "Right Arm",
	"Right Shoulder" ...). Nothing animates or moves on its own: Humanoid:MoveTo completes instantly without
	moving, there is no falling. Health works: Health <= 0 fires Died once.
]]
return function(H)
	local sched = H.sched
	local roblox = H.roblox
	local Enum = roblox.Enum
	local Vector3, CFrame = roblox.Vector3, roblox.CFrame

	--------------------------------------------------------------------------------------------------------------
	-- Humanoid
	--------------------------------------------------------------------------------------------------------------
	local Humanoid = H.class("Humanoid")
	Humanoid.defaults.Health = 100
	Humanoid.defaults.FloorMaterial = Enum.Material.Plastic
	Humanoid.defaults.MoveDirection = Vector3.zero

	-- callbacks(humanoid) run when a humanoid dies (the Players module respawns characters with it)
	H.humanoidDiedHooks = {}

	Humanoid.props.Health = {
		get = function(self)
			return H.raw(self, "Health")
		end,
		set = function(self, value)
			if type(value) ~= "number" then
				error(`Unable to assign property Health. float expected, got {H.typeof(value)}`, 3)
			end
			if value ~= value then
				value = 0
			end
			if H.state(self).dead then
				return
			end
			H.rawset(self, "Health", math.clamp(value, 0, self.MaxHealth))
		end,
	}
	Humanoid.changed.Health = function(self, health)
		H.fireExisting(self, "HealthChanged", health)
		local state = H.state(self)
		if health <= 0 and not state.dead then
			state.dead = true
			H.fireExisting(self, "StateChanged", Enum.HumanoidStateType.Running, Enum.HumanoidStateType.Dead)
			H.fireExisting(self, "Died")
			for _, hook in H.humanoidDiedHooks do
				hook(self)
			end
		end
	end
	Humanoid.changed.MaxHealth = function(self, maxHealth)
		if H.raw(self, "Health") > maxHealth then
			H.rawset(self, "Health", maxHealth)
		end
	end
	Humanoid.props.RootPart = {
		get = function(self)
			local parent = self.Parent
			local root = parent and parent:FindFirstChild("HumanoidRootPart")
			return if root and root:IsA("BasePart") then root else nil
		end,
	}
	Humanoid.cloned = function(original, clone)
		H.state(clone).dead = H.state(original).dead
	end

	function Humanoid.methods.TakeDamage(self: any, amount: number)
		if type(amount) ~= "number" then
			error(`TakeDamage: number expected, got {H.typeof(amount)}`, 2)
		end
		local parent = self.Parent
		if parent and parent:FindFirstChildOfClass("ForceField") then
			return
		end
		self.Health = self.Health - amount
	end

	function Humanoid.methods.GetState(self: any): any
		return if H.state(self).dead then Enum.HumanoidStateType.Dead else H.state(self).humanoidState or Enum.HumanoidStateType.Running
	end

	function Humanoid.methods.ChangeState(self: any, newState: any)
		local state = H.state(self)
		local old = Humanoid.methods.GetState(self)
		if newState == Enum.HumanoidStateType.Dead then
			self.Health = 0
			return
		end
		state.humanoidState = newState
		if old ~= newState then
			H.fireExisting(self, "StateChanged", old, newState)
		end
	end

	function Humanoid.methods.SetStateEnabled(self: any, stateType: any, enabled: boolean)
		local state = H.state(self)
		state.disabledStates = state.disabledStates or {}
		state.disabledStates[stateType] = not enabled
	end

	function Humanoid.methods.GetStateEnabled(self: any, stateType: any): boolean
		local disabled = H.state(self).disabledStates
		return not (disabled and disabled[stateType])
	end

	function Humanoid.methods.MoveTo(self: any, location: any, part: any?)
		if typeof(location) ~= "Vector3" then
			error(`MoveTo: Vector3 expected, got {H.typeof(location)}`, 2)
		end
		H.rawset(self, "WalkToPoint", location)
		H.rawset(self, "WalkToPart", part)
		-- no locomotion in the harness: report the walk as finished on the next resumption
		sched.deferCall(function()
			H.fireExisting(self, "MoveToFinished", true)
		end, table.pack())
	end

	function Humanoid.methods.Move(_self: any, _direction: any, _relativeToCamera: boolean?) end

	function Humanoid.methods.EquipTool(self: any, tool: any)
		if self.Parent then
			tool.Parent = self.Parent
		end
	end

	function Humanoid.methods.UnequipTools(self: any)
		local character = self.Parent
		local player = character and H.game:GetService("Players"):GetPlayerFromCharacter(character)
		local backpack = player and player:FindFirstChildOfClass("Backpack")
		if character then
			for _, child in character:GetChildren() do
				if child:IsA("Tool") then
					child.Parent = backpack
				end
			end
		end
	end

	function Humanoid.methods.AddAccessory(self: any, accessory: any)
		accessory.Parent = self.Parent
	end

	function Humanoid.methods.GetAccessories(self: any): { any }
		local accessories = {}
		local character = self.Parent
		if character then
			for _, child in character:GetChildren() do
				if child:IsA("Accoutrement") then
					table.insert(accessories, child)
				end
			end
		end
		return accessories
	end

	function Humanoid.methods.RemoveAccessories(self: any)
		for _, accessory in Humanoid.methods.GetAccessories(self) do
			accessory:Destroy()
		end
	end

	function Humanoid.methods.GetAppliedDescription(self: any): any
		local state = H.state(self)
		if not state.description then
			state.description = H.create("HumanoidDescription")
		end
		return state.description:Clone()
	end

	local function applyDescription(self: any, description: any)
		H.yield()
		H.state(self).description = description:Clone()
	end
	Humanoid.methods.ApplyDescription = applyDescription
	Humanoid.methods.ApplyDescriptionAsync = applyDescription
	Humanoid.methods.ApplyDescriptionReset = applyDescription
	Humanoid.methods.ApplyDescriptionResetAsync = applyDescription
	Humanoid.methods.BuildRigFromAttachments = function() end
	Humanoid.methods.GetMoveVelocity = function()
		return Vector3.zero
	end
	Humanoid.methods.PlayEmote = function()
		return false
	end
	Humanoid.methods.PlayEmoteAsync = Humanoid.methods.PlayEmote

	--------------------------------------------------------------------------------------------------------------
	-- Animator / AnimationTrack
	--------------------------------------------------------------------------------------------------------------
	local Animator = H.class("Animator")
	local AnimationTrack = H.class("AnimationTrack")
	AnimationTrack.defaults.Length = 1
	AnimationTrack.defaults.Looped = false
	AnimationTrack.defaults.TimePosition = 0
	AnimationTrack.defaults.WeightCurrent = 1
	AnimationTrack.defaults.WeightTarget = 1
	AnimationTrack.props.IsPlaying = {
		get = function(self)
			return H.state(self).playing == true
		end,
	}
	AnimationTrack.props.Speed = {
		get = function(self)
			return H.state(self).speed or 1
		end,
	}

	function Animator.methods.LoadAnimation(self: any, animation: any): any
		if not (H.isInstance(animation) and animation:IsA("Animation")) then
			error(`LoadAnimation: Animation expected, got {H.typeof(animation)}`, 2)
		end
		local track = H.create("AnimationTrack")
		track.Name = animation.Name
		H.rawset(track, "Animation", animation)
		local state = H.state(self)
		state.tracks = state.tracks or {}
		table.insert(state.tracks, track)
		return track
	end

	function Animator.methods.GetPlayingAnimationTracks(self: any): { any }
		local playing = {}
		for _, track in H.state(self).tracks or {} do
			if H.state(track).playing then
				table.insert(playing, track)
			end
		end
		return playing
	end
	Animator.methods.ApplyJointVelocities = function() end
	Animator.methods.StepAnimations = function() end

	local function stopTrack(self: any)
		local state = H.state(self)
		if state.playing then
			state.playing = false
			state.token = (state.token or 0) + 1
			H.fireExisting(self, "Stopped")
			H.fireExisting(self, "Ended")
		end
	end

	function AnimationTrack.methods.Play(self: any, _fadeTime: number?, _weight: number?, speed: number?)
		local state = H.state(self)
		state.playing = true
		state.speed = speed or state.speed or 1
		state.token = (state.token or 0) + 1
		local token = state.token
		if not self.Looped then
			sched.delay(self.Length / math.max(math.abs(state.speed), 0.01), function()
				if state.token == token then
					stopTrack(self)
				end
			end)
		end
	end
	AnimationTrack.methods.Stop = function(self: any, _fadeTime: number?)
		stopTrack(self)
	end
	AnimationTrack.methods.AdjustSpeed = function(self: any, speed: number?)
		H.state(self).speed = speed or 1
	end
	AnimationTrack.methods.AdjustWeight = function() end
	AnimationTrack.methods.GetTimeOfKeyframe = function()
		return 0
	end
	-- Marker signals never fire on their own; a test can fire one with track:GetMarkerReachedSignal(name):_fire(param)
	function AnimationTrack.methods.GetMarkerReachedSignal(self: any, name: string): any
		local state = H.state(self)
		state.markers = state.markers or {}
		if not state.markers[name] then
			state.markers[name] = H.Signal.new("AnimationTrack marker " .. name)
		end
		return state.markers[name]
	end
	AnimationTrack.destroyed = function(self)
		H.state(self).playing = false
	end

	--------------------------------------------------------------------------------------------------------------
	-- character rigs
	--------------------------------------------------------------------------------------------------------------
	local function makePart(name: string, size: any, cframe: any, parent: any): any
		local part = H.datatypes.Instance.new("Part")
		part.Name = name
		part.Size = size
		part.CFrame = cframe
		part.CanCollide = false
		part.Parent = parent
		return part
	end

	local function makeJoint(name: string, part0: any, part1: any)
		local joint = H.datatypes.Instance.new("Motor6D")
		joint.Name = name
		joint.Part0 = part0
		joint.Part1 = part1
		joint.C0 = part0.CFrame:ToObjectSpace(part1.CFrame)
		joint.Parent = part1
		return joint
	end

	local function makeAttachment(name: string, parent: any, offset: any)
		local attachment = H.datatypes.Instance.new("Attachment")
		attachment.Name = name
		attachment.CFrame = CFrame.new(offset)
		attachment.Parent = parent
		return attachment
	end

	-- name, size, offset from the root part, parent part name, joint name
	local R15_PARTS = {
		{ "LowerTorso", Vector3.new(2, 0.4, 1), Vector3.new(0, -0.8, 0), "HumanoidRootPart", "Root" },
		{ "UpperTorso", Vector3.new(2, 1.6, 1), Vector3.new(0, 0.2, 0), "LowerTorso", "Waist" },
		{ "Head", Vector3.new(1.2, 1.2, 1.2), Vector3.new(0, 1.6, 0), "UpperTorso", "Neck" },
		{ "RightUpperArm", Vector3.new(1, 1.2, 1), Vector3.new(1.5, 0.4, 0), "UpperTorso", "RightShoulder" },
		{ "RightLowerArm", Vector3.new(1, 1.1, 1), Vector3.new(1.5, -0.4, 0), "RightUpperArm", "RightElbow" },
		{ "RightHand", Vector3.new(1, 0.3, 1), Vector3.new(1.5, -1, 0), "RightLowerArm", "RightWrist" },
		{ "LeftUpperArm", Vector3.new(1, 1.2, 1), Vector3.new(-1.5, 0.4, 0), "UpperTorso", "LeftShoulder" },
		{ "LeftLowerArm", Vector3.new(1, 1.1, 1), Vector3.new(-1.5, -0.4, 0), "LeftUpperArm", "LeftElbow" },
		{ "LeftHand", Vector3.new(1, 0.3, 1), Vector3.new(-1.5, -1, 0), "LeftLowerArm", "LeftWrist" },
		{ "RightUpperLeg", Vector3.new(1, 1.2, 1), Vector3.new(0.5, -1.5, 0), "LowerTorso", "RightHip" },
		{ "RightLowerLeg", Vector3.new(1, 1.2, 1), Vector3.new(0.5, -2.3, 0), "RightUpperLeg", "RightKnee" },
		{ "RightFoot", Vector3.new(1, 0.3, 1), Vector3.new(0.5, -2.85, 0), "RightLowerLeg", "RightAnkle" },
		{ "LeftUpperLeg", Vector3.new(1, 1.2, 1), Vector3.new(-0.5, -1.5, 0), "LowerTorso", "LeftHip" },
		{ "LeftLowerLeg", Vector3.new(1, 1.2, 1), Vector3.new(-0.5, -2.3, 0), "LeftUpperLeg", "LeftKnee" },
		{ "LeftFoot", Vector3.new(1, 0.3, 1), Vector3.new(-0.5, -2.85, 0), "LeftLowerLeg", "LeftAnkle" },
	}
	local R6_PARTS = {
		{ "Torso", Vector3.new(2, 2, 1), Vector3.new(0, 0, 0), "HumanoidRootPart", "RootJoint" },
		{ "Head", Vector3.new(2, 1, 1), Vector3.new(0, 1.5, 0), "Torso", "Neck" },
		{ "Right Arm", Vector3.new(1, 2, 1), Vector3.new(1.5, 0, 0), "Torso", "Right Shoulder" },
		{ "Left Arm", Vector3.new(1, 2, 1), Vector3.new(-1.5, 0, 0), "Torso", "Left Shoulder" },
		{ "Right Leg", Vector3.new(1, 2, 1), Vector3.new(0.5, -2, 0), "Torso", "Right Hip" },
		{ "Left Leg", Vector3.new(1, 2, 1), Vector3.new(-0.5, -2, 0), "Torso", "Left Hip" },
	}

	-- Builds an unparented character Model for `player` standing at `rootCFrame`.
	function H.buildCharacter(player: any, rigType: string?, rootCFrame: any?): any
		local isR6 = rigType == "R6"
		local root = rootCFrame or CFrame.new(0, 3, 0)
		local character = H.datatypes.Instance.new("Model")
		character.Name = player.Name
		local rootPart = makePart("HumanoidRootPart", Vector3.new(2, 2, 1), root, character)
		rootPart.Transparency = 1
		local parts = { HumanoidRootPart = rootPart }
		for _, spec in if isR6 then R6_PARTS else R15_PARTS do
			local part = makePart(spec[1], spec[2], root * CFrame.new(spec[3]), character)
			parts[spec[1]] = part
			-- R6 joints live in the Torso (RootJoint in the root part); R15 joints live in the child part
			local joint = makeJoint(spec[5], parts[spec[4]], part)
			if isR6 then
				joint.Parent = parts[spec[4]]
			end
		end
		makeAttachment("RootAttachment", rootPart, Vector3.zero)
		makeAttachment("HatAttachment", parts.Head, Vector3.new(0, 0.6, 0))
		makeAttachment("FaceFrontAttachment", parts.Head, Vector3.new(0, 0, -0.6))
		if isR6 then
			makeAttachment("RightGripAttachment", parts["Right Arm"], Vector3.new(0, -1, 0))
			makeAttachment("LeftGripAttachment", parts["Left Arm"], Vector3.new(0, -1, 0))
		else
			makeAttachment("RightGripAttachment", parts.RightHand, Vector3.new(0, -0.15, 0))
			makeAttachment("LeftGripAttachment", parts.LeftHand, Vector3.new(0, -0.15, 0))
		end

		local humanoid = H.datatypes.Instance.new("Humanoid")
		humanoid.RigType = if isR6 then Enum.HumanoidRigType.R6 else Enum.HumanoidRigType.R15
		humanoid.DisplayName = player.DisplayName
		local animator = H.datatypes.Instance.new("Animator")
		animator.Parent = humanoid
		humanoid.Parent = character
		character.PrimaryPart = rootPart
		return character
	end

	return nil
end
