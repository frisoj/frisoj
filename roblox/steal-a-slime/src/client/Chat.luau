--!strict
-- VIP-spelers krijgen een gouden [VIP]-tag in de chat.

local Players = game:GetService("Players")
local TextChatService = game:GetService("TextChatService")

local Chat = {}

function Chat.start()
	TextChatService.OnIncomingMessage = function(message: TextChatMessage)
		local props = Instance.new("TextChatMessageProperties")
		local source = message.TextSource
		if source then
			local who = Players:GetPlayerByUserId(source.UserId)
			if who and who:GetAttribute("VIP") == true then
				props.PrefixText = "<font color='#FFD24A'>[VIP]</font> " .. message.PrefixText
			end
		end
		return props
	end
end

return Chat
