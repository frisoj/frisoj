--!strict
-- Stelen: E vasthouden bij een slijmpje in andermans lab, het boven je hoofd naar je eigen
-- lab dragen en daar afleveren. Pas bij afleveren wisselt het echt van eigenaar.
-- Gebonkt, dood, vertrokken of te traag: het slijmpje springt terug naar huis.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Slimes = require(Shared:WaitForChild("Slimes"))

local Server = script.Parent
local PlayerData = require(Server:WaitForChild("PlayerData"))
local Passes = require(Server:WaitForChild("Passes"))
local Economy = require(Server:WaitForChild("Economy"))
local Labs = require(Server:WaitForChild("Labs"))
local Movement = require(Server:WaitForChild("Movement"))
local Remotes = require(Server:WaitForChild("Remotes"))

type Slime = PlayerData.Slime
type Carry = { owner: Player, lab: Labs.LabInfo, pad: number, slime: Slime, started: number }

local Steal = {}

local carries: { [Player]: Carry } = {}
local holdBegan: { [Player]: { prompt: ProximityPrompt, t: number } } = {}
local promptInfo: { [ProximityPrompt]: { lab: Labs.LabInfo, pad: number } } = {}

local function now(): number
	return Workspace:GetServerTimeNow()
end

function Steal.isCarrying(player: Player): boolean
	return carries[player] ~= nil
end

local function setCarryAttributes(player: Player, slime: Slime?)
	player:SetAttribute("CarrySpecies", if slime then slime.s else nil)
	player:SetAttribute("CarryMut", if slime and slime.m then slime.m else nil)
	player:SetAttribute("CarryFuse", if slime then slime.f else nil)
end

local function finish(thief: Player)
	carries[thief] = nil
	setCarryAttributes(thief, nil)
	Movement.setCarrying(thief, false)
end

-- Terug naar het platform van de eigenaar.
local function sendHome(thief: Player, reason: string)
	local carry = carries[thief]
	if not carry then
		return
	end
	finish(thief)
	if carry.owner.Parent then
		Economy.setInTransit(carry.owner, carry.pad, false)
		Labs.refresh(carry.owner)
		Economy.notify(carry.owner, Slimes.displayName(carry.slime) .. " is back home!", "good")
		Remotes.Effect:FireAllClients("home", Labs.padPosition(carry.lab, carry.pad), { pad = carry.pad, lab = carry.lab.index })
	end
	if thief.Parent then
		Economy.notify(thief, reason, "bad")
	end
end

local function deliver(thief: Player)
	local carry = carries[thief]
	if not carry then
		return
	end
	finish(thief)
	local owner = carry.owner
	Economy.setInTransit(owner, carry.pad, false)
	local slime = Economy.removeSlime(owner, carry.pad)
	if not slime then
		return
	end
	Economy.addSlime(thief, slime)
	local thiefData = PlayerData.get(thief)
	local ownerData = PlayerData.get(owner)
	if thiefData then
		thiefData.steals += 1
	end
	if ownerData then
		ownerData.timesStolen += 1
	end
	local name = Slimes.displayName(slime)
	Economy.notify(thief, "You stole " .. name .. "!", "rare")
	Economy.notify(owner, thief.DisplayName .. " stole your " .. name .. "!", "bad")
	Remotes.Effect:FireAllClients("stolen", nil, { thief = thief.UserId })
	local info = Slimes.BY_ID[slime.s]
	if info and Slimes.rarityOrder(info.rarity) >= Slimes.rarityOrder("Legendary") then
		Economy.announce(string.format("%s STOLE a %s %s from %s!", thief.DisplayName, string.upper(info.rarity), name, owner.DisplayName), "#FF8A4C")
	end
	-- Meteen opslaan, zodat een crash het slijmpje niet verdubbelt of laat verdwijnen.
	task.spawn(PlayerData.save, owner)
	task.spawn(PlayerData.save, thief)
end

local function holdNeeded(player: Player): number
	return if Passes.has(player, "ThiefGloves") then Config.STEAL_HOLD_GLOVES else Config.STEAL_HOLD
end

local function tryStart(thief: Player, prompt: ProximityPrompt)
	local info = promptInfo[prompt]
	if not info or carries[thief] then
		return
	end
	local began = holdBegan[thief]
	holdBegan[thief] = nil
	if not began or began.prompt ~= prompt or os.clock() - began.t < holdNeeded(thief) - 0.3 then
		return
	end
	local lab = info.lab
	local owner = lab.owner
	if not owner or owner == thief then
		return
	end
	if Labs.isShielded(lab) then
		Economy.notify(thief, "This lab has a shield!", "bad")
		return
	end
	if Labs.isLocked(lab) then
		Economy.notify(thief, "This lab is locked!", "bad")
		return
	end
	local character = thief.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid or humanoid.Health <= 0 then
		return
	end
	if (root.Position - Labs.padPosition(lab, info.pad)).Magnitude > 16 then
		return
	end
	if not Labs.get(thief) or not Economy.freePad(thief) then
		Economy.notify(thief, "Your lab is full! Make room before stealing.", "bad")
		return
	end
	local ownerData = PlayerData.get(owner)
	local slime = ownerData and ownerData.lab[tostring(info.pad)]
	if not slime or Economy.isInTransit(owner, info.pad) then
		return
	end

	local copy: Slime = { s = slime.s, m = slime.m, f = slime.f }
	carries[thief] = { owner = owner, lab = lab, pad = info.pad, slime = copy, started = now() }
	Economy.setInTransit(owner, info.pad, true)
	Labs.refresh(owner)
	setCarryAttributes(thief, copy)
	Movement.setCarrying(thief, true)
	local name = Slimes.displayName(copy)
	Remotes.Alarm:FireClient(owner, thief.DisplayName, name)
	Economy.notify(thief, "Run back to your lab with " .. name .. "!", "info")
end

-- Iemand bonkte deze speler: draagt hij iets, dan gaat het terug.
function Steal.onBonk(victim: Player, by: Player)
	if carries[victim] then
		sendHome(victim, by.DisplayName .. " bonked you! The slime ran home.")
		Economy.notify(by, "You saved the slime!", "good")
	end
end

function Steal.onLeave(player: Player)
	holdBegan[player] = nil
	if carries[player] then
		sendHome(player, "")
	end
	-- Wie van deze speler aan het stelen was, raakt het kwijt: het lab verdwijnt.
	for thief, carry in carries do
		if carry.owner == player then
			finish(thief)
			Economy.notify(thief, "The owner left. The slime vanished with their lab.", "bad")
		end
	end
end

local function updatePrompts(lab: Labs.LabInfo, pad: number, steal: ProximityPrompt, sell: ProximityPrompt)
	local part = lab.pads[pad]
	local species = part:GetAttribute("Slime")
	local has = typeof(species) == "string" and species ~= "" and part:GetAttribute("Stolen") ~= true
	steal.Enabled = has and lab.owner ~= nil
	sell.Enabled = has and lab.owner ~= nil
	if has then
		local slime: Slime = { s = species :: string, m = (function(): string?
			local m = part:GetAttribute("Mut")
			return if typeof(m) == "string" and m ~= "" then m else nil
		end)(), f = tonumber(part:GetAttribute("Fuse")) or 0 }
		steal.ObjectText = Slimes.displayName(slime)
		sell.ObjectText = Slimes.displayName(slime)
	end
end

function Steal.start()
	for _, lab in Labs.all() do
		for pad, part in lab.pads do
			local steal = Instance.new("ProximityPrompt")
			steal.Name = "StealPrompt"
			steal.ActionText = "Steal"
			steal.HoldDuration = Config.STEAL_HOLD
			steal.MaxActivationDistance = 11
			steal.RequiresLineOfSight = false
			steal.KeyboardKeyCode = Enum.KeyCode.E
			steal.Enabled = false
			steal.Parent = part
			local sell = Instance.new("ProximityPrompt")
			sell.Name = "SellPrompt"
			sell.ActionText = "Sell (50%)"
			sell.HoldDuration = 1.2
			sell.MaxActivationDistance = 9
			sell.RequiresLineOfSight = false
			sell.KeyboardKeyCode = Enum.KeyCode.F
			sell.UIOffset = Vector2.new(0, -60)
			sell.Enabled = false
			sell.Parent = part
			promptInfo[steal] = { lab = lab, pad = pad }

			steal.PromptButtonHoldBegan:Connect(function(player: Player)
				holdBegan[player] = { prompt = steal, t = os.clock() }
			end)
			steal.Triggered:Connect(function(player: Player)
				tryStart(player, steal)
			end)
			sell.Triggered:Connect(function(player: Player)
				if lab.owner == player then
					Economy.sell(player, pad)
					Remotes.Effect:FireClient(player, "sold", part.Position, nil)
				end
			end)
			for _, attr in { "Slime", "Stolen", "Mut", "Fuse" } do
				part:GetAttributeChangedSignal(attr):Connect(function()
					updatePrompts(lab, pad, steal, sell)
				end)
			end
			lab.model:GetAttributeChangedSignal("Owner"):Connect(function()
				updatePrompts(lab, pad, steal, sell)
			end)
		end
	end

	task.spawn(function()
		while true do
			task.wait(0.2)
			for thief, carry in carries do
				local ok, err = pcall(function()
					local character = thief.Character
					local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
					local humanoid = character and character:FindFirstChildOfClass("Humanoid")
					if not carry.owner.Parent then
						finish(thief)
					elseif not root or not humanoid or humanoid.Health <= 0 then
						sendHome(thief, "You dropped the slime!")
					elseif now() - carry.started > Config.CARRY_TIMEOUT then
						sendHome(thief, "Too slow! The slime ran home.")
					else
						local mine = Labs.get(thief)
						if mine and Labs.at(root.Position) == mine then
							deliver(thief)
						end
					end
				end)
				if not ok then
					warn("[Steal]", err)
				end
			end
		end
	end)
end

return Steal
