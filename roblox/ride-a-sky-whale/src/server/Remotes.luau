--!strict
-- Maakt alle RemoteEvents aan in ReplicatedStorage.Remotes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local folder = Instance.new("Folder")
folder.Name = "Remotes"

local function event(name: string): RemoteEvent
	local e = Instance.new("RemoteEvent")
	e.Name = name
	e.Parent = folder
	return e
end

local Remotes = {
	Catch = event("Catch"), -- client -> server: id van de Driftling die je raakt
	Action = event("Action"), -- client -> server: ("upgrade" | "migrate" | "code", arg)
	SetGliding = event("SetGliding"), -- client -> server: glider open/dicht (voor de vleugels)
	Notify = event("Notify"), -- server -> client: melding voor één speler
	Announce = event("Announce"), -- server -> iedereen: grote melding
	Sync = event("Sync"), -- server -> client: nest, Sky-dex en levels
}

folder.Parent = ReplicatedStorage

return Remotes
