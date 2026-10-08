--!strict
-- Een eenvoudig signaal: modules kunnen elkaar laten weten dat er iets veranderde
-- zonder elkaar te hoeven requiren (geen kringverwijzingen).

export type Signal<T...> = {
	Connect: (self: Signal<T...>, fn: (T...) -> ()) -> (),
	Fire: (self: Signal<T...>, T...) -> (),
}

local Signal = {}

function Signal.new<T...>(): Signal<T...>
	local handlers: { (T...) -> () } = {}
	local self = {}
	function self.Connect(_: any, fn: (T...) -> ())
		table.insert(handlers, fn)
	end
	function self.Fire(_: any, ...: T...)
		for _, fn in handlers do
			local ok, err = pcall(fn :: any, ...)
			if not ok then
				warn("[Signal]", err)
			end
		end
	end
	return (self :: any) :: Signal<T...>
end

return Signal
