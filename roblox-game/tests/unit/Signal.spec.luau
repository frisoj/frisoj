-- Unit tests for Shared/Util/Signal. No timers: everything is driven by task.spawn / coroutine.yield so the
-- tests are deterministic under any scheduler.
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Signal = require(Shared:WaitForChild("Util"):WaitForChild("Signal"))

return function(t)
	t.test("Connect receives every Fire with all arguments, in connection order", function()
		local signal = Signal.new()
		local log = {}
		signal:Connect(function(a, b, c)
			table.insert(log, { "first", a, b, c })
		end)
		signal:Connect(function(a, b, c)
			table.insert(log, { "second", a, b, c })
		end)
		signal:Fire(1, "two", nil)
		signal:Fire(false)
		t.equal(log, {
			{ "first", 1, "two", nil },
			{ "second", 1, "two", nil },
			{ "first", false },
			{ "second", false },
		})
	end)

	t.test("nil arguments keep their position", function()
		local signal = Signal.new()
		local count, third
		signal:Connect(function(...)
			count = select("#", ...)
			third = select(3, ...)
		end)
		signal:Fire(nil, nil, "x")
		t.equal(count, 3)
		t.equal(third, "x")
	end)

	t.test("Disconnect stops delivery and is idempotent", function()
		local signal = Signal.new()
		local calls = 0
		local connection = signal:Connect(function()
			calls += 1
		end)
		t.equal(connection.Connected, true)
		signal:Fire()
		connection:Disconnect()
		t.equal(connection.Connected, false)
		connection:Disconnect()
		signal:Fire()
		t.equal(calls, 1)
	end)

	t.test("disconnecting one connection leaves the others (and their order) intact", function()
		local signal = Signal.new()
		local log = {}
		local connections = {}
		for index = 1, 4 do
			connections[index] = signal:Connect(function()
				table.insert(log, index)
			end)
		end
		connections[2]:Disconnect()
		signal:Fire()
		connections[1]:Disconnect()
		connections[4]:Disconnect()
		signal:Fire()
		t.equal(log, { 1, 3, 4, 3 })
	end)

	t.test("Once runs for a single Fire only", function()
		local signal = Signal.new()
		local values = {}
		local connection = signal:Once(function(value)
			table.insert(values, value)
		end)
		t.equal(connection.Connected, true)
		signal:Fire("a")
		t.equal(connection.Connected, false)
		signal:Fire("b")
		t.equal(values, { "a" })
	end)

	t.test("Once can be disconnected before it fires", function()
		local signal = Signal.new()
		local calls = 0
		local connection = signal:Once(function()
			calls += 1
		end)
		connection:Disconnect()
		signal:Fire()
		t.equal(calls, 0)
	end)

	t.test("Once handler that re-fires the signal is not run twice", function()
		local signal = Signal.new()
		local calls = 0
		signal:Once(function(depth)
			calls += 1
			if depth < 3 then
				signal:Fire(depth + 1)
			end
		end)
		signal:Fire(1)
		t.equal(calls, 1)
	end)

	t.test("re-entrant Fire delivers nested events completely and in order", function()
		local signal = Signal.new()
		local log = {}
		signal:Connect(function(value)
			table.insert(log, "A" .. value)
			if value == 1 then
				signal:Fire(2)
			end
		end)
		signal:Connect(function(value)
			table.insert(log, "B" .. value)
		end)
		signal:Fire(1)
		t.equal(log, { "A1", "A2", "B2", "B1" })
	end)

	t.test("a handler disconnected during Fire is skipped in that same Fire", function()
		local signal = Signal.new()
		local log = {}
		local second
		signal:Connect(function()
			table.insert(log, "first")
			second:Disconnect()
		end)
		second = signal:Connect(function()
			table.insert(log, "second")
		end)
		signal:Connect(function()
			table.insert(log, "third")
		end)
		signal:Fire()
		signal:Fire()
		t.equal(log, { "first", "third", "first", "third" })
	end)

	t.test("a handler that disconnects itself does not disturb the others", function()
		local signal = Signal.new()
		local log = {}
		local own
		own = signal:Connect(function()
			table.insert(log, "self")
			own:Disconnect()
		end)
		signal:Connect(function()
			table.insert(log, "other")
		end)
		signal:Fire()
		signal:Fire()
		t.equal(log, { "self", "other", "other" })
	end)

	t.test("a handler connected during Fire first runs on the next Fire", function()
		local signal = Signal.new()
		local log = {}
		local added = false
		signal:Connect(function()
			table.insert(log, "outer")
			if not added then
				added = true
				signal:Connect(function()
					table.insert(log, "inner")
				end)
			end
		end)
		signal:Fire()
		t.equal(log, { "outer" })
		signal:Fire()
		t.equal(log, { "outer", "outer", "inner" })
	end)

	t.test("an erroring handler does not stop the other handlers or the caller", function()
		local signal = Signal.new()
		local log = {}
		local errorsBefore = if type(t.env.errors) == "table" then #t.env.errors else 0
		signal:Connect(function()
			table.insert(log, "before")
		end)
		signal:Connect(function()
			error("intentional error raised by Signal.spec (expected in the test output)")
		end)
		signal:Connect(function()
			table.insert(log, "after")
		end)
		local ok = pcall(function()
			signal:Fire()
		end)
		t.truthy(ok, "Fire must not propagate handler errors")
		t.equal(log, { "before", "after" })
		signal:Fire()
		t.equal(log, { "before", "after", "before", "after" })
		-- The harness may collect errors from spawned threads; drop the ones this test caused on purpose.
		if type(t.env.errors) == "table" then
			for index = #t.env.errors, errorsBefore + 1, -1 do
				table.remove(t.env.errors, index)
			end
		end
	end)

	t.test("a yielding handler does not block the other handlers or the caller", function()
		local signal = Signal.new()
		local log = {}
		local parked
		signal:Connect(function(value)
			parked = coroutine.running()
			table.insert(log, "yield-start" .. value)
			local resumedWith = coroutine.yield()
			table.insert(log, "yield-end" .. tostring(resumedWith))
		end)
		signal:Connect(function(value)
			table.insert(log, "plain" .. value)
		end)
		signal:Fire(1)
		t.equal(log, { "yield-start1", "plain1" })
		task.spawn(parked, "!")
		t.equal(log, { "yield-start1", "plain1", "yield-end!" })
	end)

	t.test("Wait returns the arguments of the next Fire", function()
		local signal = Signal.new()
		local results
		local thread = task.spawn(function()
			results = table.pack(signal:Wait())
		end)
		t.equal(coroutine.status(thread), "suspended")
		t.equal(results, nil)
		signal:Fire("x", nil, 3)
		t.equal(results.n, 3)
		t.equal(results[1], "x")
		t.equal(results[2], nil)
		t.equal(results[3], 3)
		t.equal(coroutine.status(thread), "dead")
	end)

	t.test("every waiting thread is resumed once, and only by the next Fire", function()
		local signal = Signal.new()
		local log = {}
		for index = 1, 3 do
			task.spawn(function()
				local value = signal:Wait()
				table.insert(log, index .. ":" .. value)
			end)
		end
		signal:Fire("a")
		signal:Fire("b")
		t.equal(log, { "1:a", "2:a", "3:a" })
	end)

	t.test("a thread can Wait again from inside its own wake-up", function()
		local signal = Signal.new()
		local seen = {}
		task.spawn(function()
			for _ = 1, 3 do
				table.insert(seen, (signal:Wait()))
			end
		end)
		signal:Fire(1)
		signal:Fire(2)
		signal:Fire(3)
		signal:Fire(4)
		t.equal(seen, { 1, 2, 3 })
	end)

	t.test("a waiter resumed by someone else (timeout pattern) is not resumed again by Fire", function()
		local signal = Signal.new()
		local log = {}
		local thread = task.spawn(function()
			local first = signal:Wait()
			table.insert(log, "wait:" .. tostring(first))
			local second = coroutine.yield()
			table.insert(log, "yield:" .. tostring(second))
		end)
		task.spawn(thread, "timeout")
		t.equal(log, { "wait:timeout" })
		signal:Fire("late")
		t.equal(log, { "wait:timeout" }, "Fire must not resume a thread that is no longer waiting on the signal")
		task.spawn(thread, "done")
		t.equal(log, { "wait:timeout", "yield:done" })
	end)

	t.test("a cancelled waiter is ignored by Fire", function()
		local signal = Signal.new()
		local resumed = false
		local thread = task.spawn(function()
			signal:Wait()
			resumed = true
		end)
		task.cancel(thread)
		local ok, message = pcall(function()
			signal:Fire()
		end)
		t.truthy(ok, "Fire threw for a cancelled waiter: " .. tostring(message))
		t.equal(resumed, false)
	end)

	t.test("DisconnectAll removes handlers but keeps waiters", function()
		local signal = Signal.new()
		local calls = 0
		local woke
		local first = signal:Connect(function()
			calls += 1
		end)
		local second = signal:Once(function()
			calls += 1
		end)
		task.spawn(function()
			woke = signal:Wait()
		end)
		signal:DisconnectAll()
		t.equal(first.Connected, false)
		t.equal(second.Connected, false)
		signal:Fire("still here")
		t.equal(calls, 0)
		t.equal(woke, "still here")
		-- the signal stays usable
		signal:Connect(function()
			calls += 1
		end)
		signal:Fire()
		t.equal(calls, 1)
	end)

	t.test("DisconnectAll during Fire skips the remaining handlers", function()
		local signal = Signal.new()
		local log = {}
		signal:Connect(function()
			table.insert(log, "first")
			signal:DisconnectAll()
		end)
		signal:Connect(function()
			table.insert(log, "second")
		end)
		signal:Fire()
		signal:Fire()
		t.equal(log, { "first" })
	end)

	t.test("Destroy disconnects, wakes waiters with nothing and makes the signal inert", function()
		local signal = Signal.new()
		local calls = 0
		local waiterResults
		local connection = signal:Connect(function()
			calls += 1
		end)
		task.spawn(function()
			waiterResults = table.pack(signal:Wait())
		end)
		signal:Destroy()
		t.equal(connection.Connected, false)
		t.truthy(waiterResults, "the waiting thread must be released")
		t.equal(waiterResults.n, 0)
		signal:Fire("ignored")
		t.equal(calls, 0)
		local late = signal:Connect(function()
			calls += 1
		end)
		t.equal(late.Connected, false)
		late:Disconnect()
		signal:Fire()
		t.equal(calls, 0)
		t.throws(function()
			signal:Wait()
		end, "Wait on a destroyed signal must error instead of hanging")
		signal:Destroy()
	end)

	t.test("Connect and Once reject non-functions", function()
		local signal = Signal.new()
		t.throws(function()
			signal:Connect(nil)
		end)
		t.throws(function()
			signal:Once("nope")
		end)
	end)

	t.test("signals are independent of each other", function()
		local a, b = Signal.new(), Signal.new()
		local log = {}
		a:Connect(function()
			table.insert(log, "a")
		end)
		b:Connect(function()
			table.insert(log, "b")
		end)
		a:Fire()
		b:DisconnectAll()
		a:Fire()
		b:Fire()
		t.equal(log, { "a", "a" })
	end)
end
