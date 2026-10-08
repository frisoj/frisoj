--!strict
-- De laatste toestand van de speler zoals de server die stuurt, plus een manier om te
-- horen wanneer die verandert.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Remotes = ReplicatedStorage:WaitForChild("Remotes")

local ClientState = {}

ClientState.data = {} :: { [string]: any }

local listeners: { (data: { [string]: any }) -> () } = {}

function ClientState.onChange(fn: (data: { [string]: any }) -> ())
	table.insert(listeners, fn)
	if next(ClientState.data) then
		task.spawn(fn, ClientState.data)
	end
end

function ClientState.remote(name: string): Instance
	return Remotes:WaitForChild(name)
end

function ClientState.start()
	local stateEvent = Remotes:WaitForChild("State") :: RemoteEvent
	stateEvent.OnClientEvent:Connect(function(data: { [string]: any })
		ClientState.data = data
		for _, fn in listeners do
			local ok, err = pcall(fn :: any, data)
			if not ok then
				warn("[ClientState]", err)
			end
		end
	end)
end

return ClientState
