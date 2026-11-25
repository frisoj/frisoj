--[[
	Virtual-time scheduler and the `task` library built on it.

	All game threads are plain coroutines resumed from here, which gives the harness three things Lune's own
	scheduler cannot: (1) errors in any thread are collected in env.errors, (2) a virtual clock: os.clock, os.time,
	tick, task.wait ... all read it, and tests can fast-forward it (env.mocks.advance(300) runs five minutes of
	timers and frames instantly), (3) determinism: time only moves in fixed frames.

	Time moves in three ways:
	  * explicitly: env.mocks.step / advance / waitFor;
	  * automatically while a test is waiting: when a thread that runs directly under Lune (the test function
	    started by the runner) yields into this scheduler - task.wait, WaitForChild, Signal:Wait, InvokeServer ... -
	    a background pump runs 1/60 s frames back to back until that thread has been resumed. So `task.wait(5)`
	    in a test returns after five virtual seconds but almost no real time, and nothing advances while no test
	    is waiting. env.mocks.stopTicker() switches this off (then only explicit stepping moves time);
	  * in real time, if a test asks for it: env.mocks.startTicker({ realTime = true }).

	One frame (H.sched.step(dt)) runs the registered phases in order, draining the deferred queue after each:
	render (BindToRenderStep, PreRender/RenderStepped) -> tweens -> PreAnimation/PreSimulation/Stepped ->
	timers (task.wait / task.delay) -> PostSimulation/Heartbeat.

	step/advance/flush are re-entrant: code running inside a frame may call them again.
]]
return function(H)
	local realTask = H.realTask
	local config = H.config

	local Scheduler = {}

	local now = 0 -- virtual seconds since the Env was created
	local frameCount = 0
	local sequence = 0
	local alive = true

	-- Binary min-heap of timers ordered by (time, seq).
	local heap: { any } = {}
	local heapSize = 0
	-- Deferred queue (FIFO): entries are { thread | fn, packed args, guard? }.
	local deferred: { any } = {}
	local deferredHead = 1
	local deferredTail = 0
	-- thread -> the timer that is allowed to resume it (cleared when something else resumes the thread first)
	local waiting = setmetatable({}, { __mode = "k" })
	-- frame phases: { order = number, fn = (dt) -> () }
	local phases: { any } = {}

	local FRAME = 1 / 60
	config.maxIdleWarp = 3600 -- virtual seconds the pump keeps running for a waiting test thread before giving up

	local tickerOn = false
	local tickerGeneration = 0
	local realTimeTicker = false
	-- "Foreign" threads run directly under Lune's scheduler (the runner's test threads) instead of being resumed
	-- from here. While one of them is suspended in this scheduler the pump advances virtual time for it.
	local resumeDepth = 0
	local foreign = setmetatable({}, { __mode = "k" })
	local foreignWaiting: { [thread]: boolean } = {}
	local foreignWaitingCount = 0
	local idleBudget = 0
	local pumpQueued = false
	local schedulePump

	local function less(a: any, b: any): boolean
		if a.time == b.time then
			return a.seq < b.seq
		end
		return a.time < b.time
	end

	local function heapPush(timer: any)
		heapSize += 1
		local index = heapSize
		heap[index] = timer
		while index > 1 do
			local parent = index // 2
			if less(heap[index], heap[parent]) then
				heap[index], heap[parent] = heap[parent], heap[index]
				index = parent
			else
				break
			end
		end
	end

	local function heapPop(): any
		local top = heap[1]
		heap[1] = heap[heapSize]
		heap[heapSize] = nil
		heapSize -= 1
		local index = 1
		while true do
			local left, right = index * 2, index * 2 + 1
			local smallest = index
			if left <= heapSize and less(heap[left], heap[smallest]) then
				smallest = left
			end
			if right <= heapSize and less(heap[right], heap[smallest]) then
				smallest = right
			end
			if smallest == index then
				break
			end
			heap[index], heap[smallest] = heap[smallest], heap[index]
			index = smallest
		end
		return top
	end

	-- Resumes a coroutine; an error inside it is recorded instead of propagating into the resumer.
	local function resume(thread: thread, ...): boolean
		if coroutine.status(thread) ~= "suspended" then
			return false
		end
		if foreignWaiting[thread] then
			foreignWaiting[thread] = nil
			foreignWaitingCount -= 1
		end
		resumeDepth += 1
		local ok, err = coroutine.resume(thread, ...)
		resumeDepth -= 1
		if not ok then
			H.reportError(err)
		end
		return ok
	end
	Scheduler.resume = resume

	-- Called right before the running thread yields into the scheduler.
	local function aboutToYield(thread: thread)
		if resumeDepth == 0 then
			foreign[thread] = true
		end
		if foreign[thread] and not foreignWaiting[thread] then
			foreignWaiting[thread] = true
			foreignWaitingCount += 1
			idleBudget = config.maxIdleWarp
			schedulePump()
		end
	end

	local function toThread(target: any, what: string): thread
		if type(target) == "thread" then
			return target
		elseif type(target) == "function" then
			return coroutine.create(target)
		end
		error(`{what}: expected a function or thread, got {typeof(target)}`, 3)
	end

	--------------------------------------------------------------------------------------------------------------
	-- task library
	--------------------------------------------------------------------------------------------------------------

	function Scheduler.spawn(target: any, ...): thread
		local thread = toThread(target, "task.spawn")
		waiting[thread] = nil
		resume(thread, ...)
		return thread
	end

	function Scheduler.defer(target: any, ...): thread
		local thread = toThread(target, "task.defer")
		deferredTail += 1
		deferred[deferredTail] = { thread, table.pack(...) }
		return thread
	end

	-- Queues a plain call (no coroutine is created until it runs). `guard`, when given, is an object whose
	-- `Connected` field must still be true at run time (a connection that was disconnected after the event fired
	-- must not run).
	function Scheduler.deferCall(fn: (...any) -> ...any, args: any, guard: any?)
		deferredTail += 1
		deferred[deferredTail] = { fn, args, guard }
	end

	function Scheduler.delay(seconds: number?, target: any, ...): thread
		local thread = toThread(target, "task.delay")
		local duration = if type(seconds) == "number" and seconds == seconds then math.max(seconds, 0) else 0
		sequence += 1
		local timer = { time = now + duration, seq = sequence, thread = thread, args = table.pack(...) }
		waiting[thread] = timer
		heapPush(timer)
		return thread
	end

	function Scheduler.wait(seconds: number?): number
		local thread = coroutine.running()
		if not coroutine.isyieldable() then
			error("task.wait: cannot yield here (not inside a coroutine)", 2)
		end
		local duration = if type(seconds) == "number" and seconds == seconds then math.max(seconds, 0) else 0
		local started = now
		sequence += 1
		local timer = { time = now + duration, seq = sequence, thread = thread }
		waiting[thread] = timer
		heapPush(timer)
		aboutToYield(thread)
		if foreignWaiting[thread] then
			idleBudget = math.max(idleBudget, duration + 1) -- a long explicit wait is not a stuck test
		end
		coroutine.yield()
		return now - started
	end

	function Scheduler.cancel(thread: thread)
		if type(thread) ~= "thread" then
			error(`task.cancel: expected a thread, got {typeof(thread)}`, 2)
		end
		waiting[thread] = nil
		if coroutine.status(thread) == "suspended" then
			pcall(coroutine.close, thread)
		end
	end

	-- Suspends the running thread until someone resumes it through the scheduler (Signal:Wait and friends).
	function Scheduler.suspend(): ...any
		local thread = coroutine.running()
		waiting[thread] = nil
		aboutToYield(thread)
		return coroutine.yield()
	end

	Scheduler.taskLibrary = table.freeze({
		spawn = Scheduler.spawn,
		defer = Scheduler.defer,
		delay = Scheduler.delay,
		wait = Scheduler.wait,
		cancel = Scheduler.cancel,
		synchronize = function() end,
		desynchronize = function() end,
	})

	--------------------------------------------------------------------------------------------------------------
	-- frames
	--------------------------------------------------------------------------------------------------------------

	-- Runs everything in the deferred queue, including entries queued while draining.
	function Scheduler.flush()
		local budget = 200000
		while deferredHead <= deferredTail do
			local entry = deferred[deferredHead]
			deferred[deferredHead] = nil
			deferredHead += 1
			local target, args, guard = entry[1], entry[2], entry[3]
			if type(target) == "thread" then
				waiting[target] = nil -- a pending task.wait timer must not resume this thread a second time
				resume(target, table.unpack(args, 1, args.n))
			elseif guard == nil or guard.Connected then
				resume(coroutine.create(target), table.unpack(args, 1, args.n))
			end
			budget -= 1
			if budget <= 0 then
				H.reportError("deferred queue did not settle after 200000 resumptions (an event keeps re-firing itself)")
				table.clear(deferred)
				deferredHead, deferredTail = 1, 0
				return
			end
		end
		if deferredHead > deferredTail then
			deferredHead, deferredTail = 1, 0
		end
	end

	local function runTimers()
		-- timers created while this loop runs (task.wait(0) inside a resumed thread) wait for the next frame
		local limit = sequence
		while heapSize > 0 do
			local top = heap[1]
			if top.time > now or top.seq > limit then
				break
			end
			heapPop()
			local thread = top.thread
			if waiting[thread] == top then
				waiting[thread] = nil
				if top.args then
					resume(thread, table.unpack(top.args, 1, top.args.n))
				else
					resume(thread)
				end
				Scheduler.flush()
			end
		end
	end

	-- Registers a per-frame callback.  Orders: < 400 run before task.wait/task.delay timers, > 400 after.
	function Scheduler.onStep(order: number, fn: (dt: number) -> ())
		table.insert(phases, { order = order, fn = fn })
		table.sort(phases, function(a, b)
			return a.order < b.order
		end)
	end
	Scheduler.onStep(400, runTimers)

	-- Advances the virtual clock by dt and runs one frame.
	function Scheduler.step(dt: number?)
		if not alive then
			return
		end
		local delta = dt or 1 / 60
		now += delta
		frameCount += 1
		Scheduler.flush()
		for index = 1, #phases do
			local ok, err = pcall(phases[index].fn, delta)
			if not ok then
				H.reportError(err, "harness frame phase")
			end
			Scheduler.flush()
		end
	end

	-- Runs frames of `dt` (default 1/60) until `seconds` of virtual time have passed.
	function Scheduler.advance(seconds: number, dt: number?)
		local frame = dt or 1 / 60
		local target = now + seconds
		while alive and now < target - 1e-9 do
			Scheduler.step(math.min(frame, target - now))
		end
	end

	-- Steps frames until predicate() returns a truthy value (returned) or `timeout` virtual seconds pass (nil).
	function Scheduler.waitFor(predicate: () -> any, timeout: number?, dt: number?): any
		local deadline = now + (timeout or 10)
		Scheduler.flush()
		while alive do
			local value = predicate()
			if value then
				return value
			end
			if now >= deadline then
				return nil
			end
			Scheduler.step(dt or 1 / 60)
		end
		return nil
	end

	-- Runs fn in a new thread and steps frames until it finishes. Returns ok, results... (ok = false, message on
	-- error or timeout). Used by test helpers that need the result of yielding game callbacks synchronously.
	function Scheduler.runToCompletion(timeout: number, fn: (...any) -> ...any, ...): ...any
		local results: any = nil
		local failure: string? = nil
		local thread = coroutine.create(function(...)
			local packed = table.pack(xpcall(fn, function(err)
				return tostring(err) .. "\n" .. debug.traceback()
			end, ...))
			if packed[1] then
				results = table.pack(table.unpack(packed, 2, packed.n))
			else
				failure = packed[2]
			end
		end)
		resume(thread, ...)
		-- when the callback yields, keep stepping frames until it finishes
		local deadline = now + timeout
		while alive and not results and not failure and coroutine.status(thread) ~= "dead" and now < deadline do
			Scheduler.step(1 / 60)
		end
		if results then
			return true, table.unpack(results, 1, results.n)
		end
		return false, failure or `did not finish within {timeout} s (virtual time)`
	end

	function Scheduler.frame(): number
		return frameCount
	end

	--------------------------------------------------------------------------------------------------------------
	-- clocks
	--------------------------------------------------------------------------------------------------------------

	-- Virtual seconds since the Env started (what os.clock(), time() and task.wait measure).
	function Scheduler.now(): number
		return now
	end
	Scheduler.frameTime = Scheduler.now

	function Scheduler.unixTime(): number
		return config.epoch + now
	end

	--------------------------------------------------------------------------------------------------------------
	-- background pump / real-time ticker
	--------------------------------------------------------------------------------------------------------------

	local function pruneForeignWaiting()
		-- a waiting test thread that was cancelled by the runner (timeout) will never be resumed: forget it
		for thread in foreignWaiting do
			if coroutine.status(thread) ~= "suspended" then
				foreignWaiting[thread] = nil
				foreignWaitingCount -= 1
			end
		end
	end

	local function pump()
		pumpQueued = false
		if not (alive and tickerOn) or realTimeTicker then
			return
		end
		pruneForeignWaiting()
		local sliceEnd = os.clock() + 0.002
		while foreignWaitingCount > 0 and idleBudget > 0 and alive and tickerOn do
			Scheduler.step(FRAME)
			idleBudget -= FRAME
			if os.clock() >= sliceEnd then
				break
			end
		end
		if foreignWaitingCount > 0 and alive and tickerOn then
			if idleBudget > 0 then
				schedulePump() -- let Lune run its other threads (the runner), then continue
			else
				H.stdio.ewrite(
					`[harness] a test thread has been waiting for {config.maxIdleWarp} virtual seconds without being resumed; `
						.. "virtual time stops advancing for it (waiting for something that never happens?)\n"
				)
			end
		end
	end

	schedulePump = function()
		if not pumpQueued and alive and tickerOn and not realTimeTicker then
			pumpQueued = true
			realTask.defer(pump)
		end
	end

	-- startTicker(options?): (re)enable automatic time. Default: virtual time advances only while a test thread
	-- waits (see the header). options.realTime = true: one frame per real 1/60 s instead, whether or not anybody
	-- waits.
	function Scheduler.startTicker(options: { [string]: any }?)
		if not alive then
			return
		end
		tickerOn = true
		tickerGeneration += 1
		realTimeTicker = options ~= nil and options.realTime == true
		if realTimeTicker then
			local generation = tickerGeneration
			realTask.spawn(function()
				local last = os.clock()
				while alive and tickerOn and generation == tickerGeneration do
					realTask.wait(FRAME)
					if not (alive and tickerOn and generation == tickerGeneration) then
						break
					end
					local current = os.clock()
					Scheduler.step(current - last)
					last = current
				end
			end)
		elseif foreignWaitingCount > 0 then
			idleBudget = config.maxIdleWarp
			schedulePump()
		end
	end

	-- stopTicker(): time only moves through env.mocks.step / advance / waitFor until startTicker is called
	function Scheduler.stopTicker()
		tickerOn = false
		tickerGeneration += 1
	end

	function Scheduler.isTickerRunning(): boolean
		return tickerOn
	end

	function Scheduler.destroy()
		Scheduler.stopTicker()
		alive = false
		table.clear(heap)
		heapSize = 0
		table.clear(deferred)
		deferredHead, deferredTail = 1, 0
	end

	H.sched = Scheduler

	-- Every mocked *Async call (data stores, marketplace, policy ...) passes through here to behave like a
	-- network call: the calling thread yields and other threads get to run. With config.asyncLatency == 0 it is
	-- resumed in the same resumption cycle (no frame passes); a positive value waits that many virtual seconds.
	config.asyncLatency = 0
	function H.yield()
		if not coroutine.isyieldable() then
			return
		end
		local latency = config.asyncLatency
		if type(latency) == "number" and latency > 0 then
			Scheduler.wait(latency)
		else
			Scheduler.defer(coroutine.running())
			Scheduler.suspend()
		end
	end

	-- test API -----------------------------------------------------------------------------------------------------
	local mocks = H.mocks
	-- step(dt?, n?): run n frames (default 1) of dt seconds (default 1/60)
	function mocks.step(dt: number?, count: number?)
		for _ = 1, count or 1 do
			Scheduler.step(dt)
		end
	end
	mocks.advance = Scheduler.advance
	mocks.flush = Scheduler.flush
	mocks.waitFor = Scheduler.waitFor
	mocks.startTicker = Scheduler.startTicker
	mocks.stopTicker = Scheduler.stopTicker
	-- now(): virtual seconds since the Env started; setTime(unix): make os.time() read `unix` right now
	mocks.now = Scheduler.now
	function mocks.setTime(unixTime: number)
		config.epoch = unixTime - Scheduler.now()
	end

	return Scheduler
end
