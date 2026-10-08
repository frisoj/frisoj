--!strict
-- Alle RemoteEvents en RemoteFunctions tussen client en server.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local folder = Instance.new("Folder")
folder.Name = "Remotes"
folder.Parent = ReplicatedStorage

local function event(name: string): RemoteEvent
	local e = Instance.new("RemoteEvent")
	e.Name = name
	e.Parent = folder
	return e
end

local function func(name: string): RemoteFunction
	local f = Instance.new("RemoteFunction")
	f.Name = name
	f.Parent = folder
	return f
end

return {
	-- client -> server
	Buy = event("Buy"), -- (streamId)
	Action = event("Action"), -- (naam, argument): sell, fuse, rebirth, gift, daily, tutorial
	Code = func("Code"), -- (code) -> (ok, bericht)
	-- server -> client
	State = event("State"), -- (tabel met de toestand van de speler)
	Notify = event("Notify"), -- (tekst, soort)
	Announce = event("Announce"), -- (tekst, kleur) voor de hele server
	Alarm = event("Alarm"), -- (dief, slijmnaam): iemand steelt van jou
	Knockback = event("Knockback"), -- (richting): je bent gebonkt
	Effect = event("Effect"), -- (soort, positie, extra)
}
