--!strict
-- Start van de client.

local Client = script.Parent

require(Client:WaitForChild("SkyController")).start()
require(Client:WaitForChild("WorldFx")).start()
require(Client:WaitForChild("Movement")).start()
require(Client:WaitForChild("CatchController")).start()
require(Client:WaitForChild("Hud")).start()
