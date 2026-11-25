# Test harness: headless Roblox for Lune

`Env.new()` (see `Env.luau`) builds the DataModel from `default.project.json` and then calls `Mocks.install(env)`
(`Mocks.luau`, implementation in `mocks/*.luau`). After that ordinary game code - server Scripts, client
LocalScripts, ModuleScripts, UI code - runs in one Lune process. Spec files get the same globals as game code
(`game`, `workspace`, `Instance`, `task`, `Enum`, `Vector3` ...) plus `t.env` and `t.env.mocks`.

```lua
return function(t)
    local env, mocks = t.env, t.env.mocks
    t.test("a player joins and gets data", function()
        mocks.startServer()                                   -- run the Scripts in ServerScriptService
        local player = mocks.addPlayer({ userId = 1, name = "Ada" })   -- PlayerAdded (+ character)
        mocks.waitFor(function() return player:GetAttribute("DataLoaded") end, 10)
        mocks.bootClient(player)                              -- LocalPlayer + run the client scripts
        local ok, payload = mocks.invokeServer(player, "BuyHammer", "stone")
        mocks.removePlayer(player)                            -- PlayerRemoving
        t.truthy(mocks.dataStores[storeName]["u_1"])          -- what was saved
        t.equal(env.errors, {})                               -- nothing failed in any thread
    end)
end
```

## How it works (what you need to know)

**Instances** are implemented in Luau (`mocks/Instances.luau`), not by Lune: a real tree, every property of the
Roblox API stored and type-checked (`Unable to assign property Size. Vector3 expected, got number`), defaults
from Lune's reflection database, attributes, tags, `Clone`, `Destroy`, `WaitForChild`, and **every event of every
class** as an `RBXScriptSignal`. Member access is checked against the API dump (`mocks/ApiData.luau`):

| access | result |
|---|---|
| property / event / callback of the class | works generically |
| method with a mock | works |
| method (or engine-computed read-only property) without a mock | `HARNESS: Part.SubtractAsync is not mocked (add it in tests/harness/Mocks.luau)` |
| deprecated member | `HARNESS: ... is deprecated in Roblox and is not mocked` |
| plugin/Roblox-only member | `HARNESS: ... cannot be used by game scripts` |
| anything else (typo) | `Sizee is not a valid member of Part "Workspace.Part"` like in Studio |

**Sides.** One DataModel, two sides with their own globals (`game`, `_G`, `shared`, `require` ...) and their own
ModuleScript cache, like Roblox's server and client VMs. On the client side `RunService:IsClient()` is true and
`Players.LocalPlayer` is the player set with `mocks.setLocalPlayer` / `bootClient`; `RenderStepped` and
`BindToRenderStep` refuse the server side. Scripts run on the side of their class (`Script` -> server,
`LocalScript` or `RunContext = Client` -> client); spec files and `env:require` / `env:loadString` use the server
side unless told otherwise:

```lua
env:require(module)                 env:requireAs("client", module)
env:loadString(source, name)        env:loadStringAs("client", source, name)   -- returns a function
env:runScript(scriptInstance)       env:runScript(scriptInstance, "client")
mocks.newScript("ModuleScript" | "Script" | "LocalScript", name, source, parent?)   -- inline scripts for tests
```

**Time is virtual.** `task.*`, `os.clock`, `os.time`, `tick`, `time`, `workspace:GetServerTimeNow`, `DateTime.now`,
tweens, Debris, respawns all use one virtual clock that starts at 2026-01-01 12:00:00 UTC and moves in frames:

- `mocks.advance(seconds, dt?)` runs that much time instantly (timers, Heartbeat/Stepped/RenderStepped, tweens);
  `mocks.step(dt?, n?)` runs single frames; `mocks.waitFor(predicate, timeout?)` steps until the predicate is
  truthy (returns it) or the virtual timeout passes (returns nil).
- While the test function itself waits (`task.wait(5)`, `WaitForChild`, `signal:Wait()`, `InvokeServer` ...) time
  advances automatically and instantly until it is resumed. Nothing advances while no test is waiting, so runs
  are deterministic. `mocks.stopTicker()` turns this off; `mocks.startTicker({ realTime = true })` uses real time.

**Events are deferred** (like `Workspace.SignalBehavior = Deferred`): handlers run when the code that fired the
event yields or finishes, not inside the firing call. Every `env.mocks` action (addPlayer, click, fire, buyProduct
...) runs the pending handlers before it returns; after changing instances directly from a test call
`mocks.flush()` (or `task.wait()`). Set `mocks.config.signalBehavior = "Immediate"` for the old behaviour.
Remote events/functions are always delivered deferred, with arguments copied the way Roblox serialises them.

**Errors never vanish.** An error in any thread or event handler is appended to `env.errors` (message with
traceback) and printed to stderr (`mocks.config.printErrors = false` silences). `warn(...)` goes to
`env.warnings`, `print(...)` to stdout and `env.output`. Run with `HARNESS_VERBOSE=1` to see warnings live.

`WaitForChild` without a timeout raises `HARNESS: infinite yield: ...` after `mocks.config.waitForChildTimeout`
(2) virtual seconds instead of hanging; with a timeout it returns nil as usual.

## env.mocks reference

Time: `step(dt?, n?)`, `advance(seconds, dt?)`, `flush()`, `waitFor(predicate, timeout?, dt?)`, `now()`,
`setTime(unixTime)`, `stopTicker()`, `startTicker(options?)`.

Booting: `startServer()` (all enabled Scripts in ServerScriptService/Workspace), `bootClient(player)`
(sets the local player; runs LocalScripts of ReplicatedFirst, then the player's PlayerScripts copies of
StarterPlayerScripts, then PlayerGui), `shutdown(timeout?)` (runs `game:BindToClose` callbacks, true if all
finished), `newScript(...)`.

Players: `addPlayer({ userId?, name?, displayName?, membership?, accountAge?, locale?, isLocal?, character = false?,
rigType = "R6"? })` -> Player (with PlayerGui, PlayerScripts, Backpack; fires PlayerAdded, spawns an R15/R6 rig
when `Players.CharacterAutoLoads`), `removePlayer(player)`, `setLocalPlayer(player)`, `spawnCharacter(player)`,
`setFriends(a, b, areFriends?)`, `setGroupRank(player, groupId, rank, role?)`, `setMembership(player, type)`,
`setMouse({ X, Y, Target, Hit })`, `kicks` (list of `{ player, userId, message }`).

Events and input: `fire(instance, "EventName", ...)`, `fireChanged(instance, "Property")`, `click(button,
{ force? })`, `hover(guiObject, entering?)`, `typeText(textBox, text, enterPressed?)`, `input(key, options?)` /
`inputBegan` / `inputEnded` (key = `Enum.KeyCode.X` or `Enum.UserInputType.X`, options `{ gameProcessed?,
position? }`), `triggerAction(name, state?)` (ContextActionService), `triggerPrompt(prompt, player?)`,
`chat(player, text, channel?)` (returns what `TextChatService.OnIncomingMessage` returned),
`setViewportSize(Vector2)`, `setRaycastHandler(fn)` / `setRaycastTarget(part)` / `newRaycastResult(fields)`.
`click`/`typeText`/`triggerPrompt` raise when the player could not do it (hidden, disabled, not in Workspace).

Remotes: `fireServer(player, remoteOrName, ...)`, `invokeServer(player, remoteOrName, ...)` (act as that
player's client without client code), `sent` (everything the server sent: `{ remote, instance, player?, args }`),
`sentTo(player, remoteName?)` -> list of argument lists, `clearSent()`.

Data stores: `dataStores[storeName][key]` and `orderedDataStores[...]` (raw contents; assign to seed data; a
scope other than "global" is `"name/scope"`), `dataStoreCalls` (request log), `failDataStore(count | true,
message?, filter?)` (fail the next N requests / all until `failDataStore(0)`), `dataStoreErrors`
(`studioApiAccess`, `apiServices`, `throttled`, `unpublished` message strings). Values that Roblox could not
store (Instances, functions, NaN, mixed/sparse tables, non-string keys) raise errors.

Marketplace: `prompts` (recorded prompts `{ kind, player, id }`), `setGamePassOwned(player, passId, owned?)`,
`completeGamePassPurchase(player, passId, purchased)`, `buyProduct(playerOrUserId, productId, { price? })` ->
`decision, receipt` (calls `MarketplaceService.ProcessReceipt`), `deliverReceipt(receipt)` (again, for
idempotency), `pendingReceipts`, `receipts`, `cancelProductPurchase`, `completePremiumPurchase`,
`setProductInfo(id, info, infoType?)`, `setAssetOwned`.

Recorded calls: `analytics` (`{ method, args }`), `badgesAwarded`, `invites`, `teleports`, `coreCalls`
(StarterGui SetCore/SetCoreGuiEnabled), `soundsPlayed`, `systemMessages`, `defaultLoadingScreenRemoved`;
`setBadgeOwned`, `closeGameInvite`.

`mocks.config` (change any time): `signalBehavior`, `printErrors`, `verbose`, `waitForChildTimeout`,
`asyncLatency` (virtual seconds every mocked `*Async` call yields; 0 = yields but resumes in the same resumption
cycle), `randomSeed`, `epoch`, `placeId` (0 simulates an unpublished place), `gameId`, `jobId`, `creatorId`,
`isStudio`, `viewportSize`, `guiInset`, `input = { touch, keyboard, mouse, gamepad }`, `rigType`, `userNames`,
`policy` / `policyByUserId` / `policyError`, `badgeError`, `canSendGameInvite`, `productInfo`,
`receiptRedeliveryDelay`, `dataStoreBudget`, `invokeTimeout`, `setCoreFailures`, `httpHandler`, `textFilter`.

## Adding a missing mock

When game code hits `HARNESS: X.Y is not mocked`, add it next to the class in `mocks/*.luau` (World, Characters,
Players, Gui, Input, Services ...); `mocks/Instances.luau` documents the API:

```lua
local Part = H.class("BasePart")                 -- applies to every class inheriting from BasePart
Part.methods.GetMass = function(self) return ... end
Part.props.Position = { get = function(self) ... end, set = function(self, value) ... end }
Part.defaults.Anchored = false                   -- also makes a read-only property readable
```

`mocks/ApiData.luau` is generated: `lune run tests/harness/tools/gen-api-data.luau <API-Dump.json>`.

## Limitations

- No physics, rendering, replication lag, or streaming: parts do not fall or collide, welded parts do not move
  together (`Model:PivotTo` / `BasePart:PivotTo` move descendants rigidly; setting one part's CFrame moves only
  that part), `Touched` only fires through `mocks.fire`, `workspace:Raycast` hits nothing without a handler,
  `GetPartBoundsInRadius`/`InBox`/`GetPartsInPart` are coarse bounding-sphere checks, `Humanoid:MoveTo` reports
  completion without moving.
- One DataModel for both sides: a "local" change made by client code (hiding a gate, changing Lighting) is
  visible to server code too, and there is exactly one client (the local player). `player.Parent`, `script.Parent`
  chains etc. return the shared instance; only `game`, `game:GetService("RunService")` and
  `game:GetService("Players")` reached through the client's `game` are client views.
- UI layout is approximate (see `mocks/Gui.luau`): no UIListLayout/UIGridLayout positioning, constraints, UIScale,
  AutomaticSize or text measuring beyond a rough estimate; computed properties fire no change signals.
- Tweens interpolate numbers, Vector2/3, Color3, UDim, UDim2 and CFrame; other types switch at the end.
- `Random`, `math.random`, GUIDs are deterministic but not Roblox's exact sequences. Mock objects implemented as
  tables (signals, connections, TweenInfo, Random, DateTime, RaycastParams, data stores) report the right
  `typeof` but `type()` is "table".
- Lune's datatypes are used as they are: `Vector3` is a userdata (not the native `vector` type), legacy enum item
  names (`Enum.KeyCode.Unknown`) do not exist - use the current ones (`Enum.KeyCode.None`), `EnumItem:IsA` is
  missing.
- Reading a property of a destroyed instance works (as in Roblox); errors from `coroutine.resume`/`coroutine.wrap`
  carry Lune's "runtime error:" prefix and traceback.
- Services not listed in `mocks/*.luau` (MemoryStoreService, PathfindingService, AssetService ...) exist as
  instances with properties and events but their methods raise the "not mocked" error.
