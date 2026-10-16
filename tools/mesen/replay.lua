-- Replays a retrowright movie in MesenCE's --testrunner mode and dumps memory
-- (harness/mesen.ts writes the inputs and runs it; MesenCE runs it, so this
-- uses only MesenCE's own Lua API: emu.addEventCallback, emu.setInput,
-- emu.read, emu.write, emu.takeScreenshot, emu.stop).
--
-- Environment:
--   RW_INPUTS  one line per frame, pad 1 as a decimal bit mask in the
--              movie's order (A 1, B 2, Select 4, Start 8, Up 16, Down 32,
--              Left 64, Right 128); line N is held during frame N-1.
--              MesenCE raises inputPolled at scanline 241, just after the
--              endFrame event at scanline 240, so the pads set there are the
--              ones the game reads in the vertical blank that follows; the
--              first poll comes after frame 0, so line 1 cannot take effect.
--   RW_FRAMES  frames to run, then stop with code 0
--   RW_DUMP    file the memory records are written to
--   RW_FIRST   first frame count to dump at (default 1)
--   RW_EVERY   dump every this many frames from RW_FIRST on (default 1)
--   RW_INIT    optional: 2048 bytes of work RAM then 8192 bytes of cartridge
--              RAM, written before the first frame runs
--   RW_SHOT_AT, RW_SHOT  optional: a PNG of the picture after RW_SHOT_AT frames
--
-- A record is the frame count (frames run so far, 32-bit little-endian),
-- work RAM $0000-$07FF and cartridge RAM $6000-$7FFF, read after the frame's
-- endFrame event. A cartridge without 8 KB of battery RAM dumps zeros there.
-- MesenCE only logs errors raised in callbacks and keeps running, so each is
-- caught, written to RW_DUMP .. ".error" and turned into stop code 1.
-- Needs --debug.scriptWindow.allowIoOsAccess=true for os and io.

local WORK_RAM_SIZE = 0x800
local CART_RAM_SIZE = 0x2000
local CHUNK = 1024

local dumpPath = os.getenv("RW_DUMP")
local inputsPath = os.getenv("RW_INPUTS")
local frames = tonumber(os.getenv("RW_FRAMES") or "")
local first = tonumber(os.getenv("RW_FIRST") or "1")
local every = tonumber(os.getenv("RW_EVERY") or "1")
local initPath = os.getenv("RW_INIT")
local shotAt = tonumber(os.getenv("RW_SHOT_AT") or "")
local shotPath = os.getenv("RW_SHOT")

if not dumpPath or not inputsPath or not frames or not first or not every or every < 1 then
  emu.log("RW_DUMP, RW_INPUTS and RW_FRAMES must be set; RW_FIRST and RW_EVERY must be numbers")
  emu.stop(2)
  return
end

local finished = false

local function fail(message)
  finished = true
  local file = io.open(dumpPath .. ".error", "wb")
  if file then
    file:write(tostring(message) .. "\n")
    file:close()
  end
  emu.stop(1)
end

local function readAll(path)
  local file = assert(io.open(path, "rb"))
  local data = file:read("a")
  file:close()
  return data
end

-- The cartridge's battery-backed 8 KB at $6000, or nil for a cartridge
-- without; harness/jsnesDump.ts likewise dumps zeros unless it has battery RAM.
local cartRam = nil
if emu.getMemorySize(emu.memType.nesSaveRam) >= CART_RAM_SIZE then
  cartRam = emu.memType.nesSaveRam
end

local BUTTONS = {
  { "a", 1 }, { "b", 2 }, { "select", 4 }, { "start", 8 },
  { "up", 16 }, { "down", 32 }, { "left", 64 }, { "right", 128 },
}

local pads = {}
for line in readAll(inputsPath):gmatch("[^\n]+") do
  local pad = line:match("^(%d+)$")
  if not pad then
    fail("bad line in " .. inputsPath .. ": " .. line)
    return
  end
  pads[#pads + 1] = tonumber(pad)
end

if initPath then
  local image = readAll(initPath)
  if #image ~= WORK_RAM_SIZE + CART_RAM_SIZE then
    fail(initPath .. " must hold " .. (WORK_RAM_SIZE + CART_RAM_SIZE) .. " bytes, has " .. #image)
    return
  end
  for address = 0, WORK_RAM_SIZE - 1 do
    emu.write(address, image:byte(address + 1), emu.memType.nesInternalRam)
  end
  if cartRam then
    for offset = 0, CART_RAM_SIZE - 1 do
      emu.write(offset, image:byte(WORK_RAM_SIZE + offset + 1), cartRam)
    end
  end
end

local dump = assert(io.open(dumpPath, "wb"))
local frame = 0

local function padTable(mask)
  local input = {}
  for _, button in ipairs(BUTTONS) do
    input[button[1]] = (mask & button[2]) ~= 0
  end
  return input
end

local function readRange(memType, size, parts)
  for start = 0, size - 1, CHUNK do
    local bytes = {}
    for offset = 0, CHUNK - 1 do
      bytes[offset + 1] = memType and emu.read(start + offset, memType) or 0
    end
    parts[#parts + 1] = string.char(table.unpack(bytes))
  end
end

local function writeRecord()
  local parts = { string.pack("<i4", frame) }
  readRange(emu.memType.nesInternalRam, WORK_RAM_SIZE, parts)
  readRange(cartRam, CART_RAM_SIZE, parts)
  dump:write(table.concat(parts))
end

local function guarded(callback)
  return function()
    if finished then
      return
    end
    local ok, err = pcall(callback)
    if not ok then
      dump:close()
      fail(err)
    end
  end
end

-- Every button of pad 1 is set, pressed or not, so nothing is left to
-- MesenCE's own input settings. Past the last line the pad is released.
-- Deliberate: pad 2 is never set. In MesenCE 2.2.1 emu.setInput(input, 1)
-- (and port 2) changed pad 1, as emu.getInput(0) and the game's own reads
-- of $4016 showed, so the Node side refuses a movie that uses pad 2.
emu.addEventCallback(guarded(function()
  emu.setInput(padTable(pads[frame + 1] or 0), 0)
end), emu.eventType.inputPolled)

emu.addEventCallback(guarded(function()
  frame = frame + 1
  if frame >= first and (frame - first) % every == 0 then
    writeRecord()
  end
  if shotAt and shotPath and frame == shotAt then
    local file = assert(io.open(shotPath, "wb"))
    file:write(emu.takeScreenshot())
    file:close()
  end
  if frame >= frames then
    finished = true
    dump:close()
    emu.stop(0)
  end
end), emu.eventType.endFrame)
