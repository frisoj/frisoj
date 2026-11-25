--!strict
-- Client entry point: the only LocalScript in StarterPlayerScripts. All client code lives in
-- ReplicatedStorage.Client; ClientMain loads and starts it.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Client = ReplicatedStorage:WaitForChild("Client")
local ClientMain = require(Client:WaitForChild("ClientMain"))

ClientMain.start()
