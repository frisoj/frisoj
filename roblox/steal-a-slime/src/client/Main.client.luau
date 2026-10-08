--!strict
-- Start van de client: interface, effecten, rivier en labs.

local Players = game:GetService("Players")

local Client = script.Parent
local ClientState = require(Client:WaitForChild("ClientState"))
local Hud = require(Client:WaitForChild("Hud"))
local Effects = require(Client:WaitForChild("Effects"))
local StreamView = require(Client:WaitForChild("StreamView"))
local LabView = require(Client:WaitForChild("LabView"))
local Chat = require(Client:WaitForChild("Chat"))

local player = Players.LocalPlayer
local screen = Instance.new("ScreenGui")
screen.Name = "SlimeHud"
screen.ResetOnSpawn = false
screen.IgnoreGuiInset = true
screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screen.Parent = player:WaitForChild("PlayerGui")

ClientState.start()
Effects.start(screen)
Hud.start(screen)
StreamView.start()
LabView.start()
Chat.start()
