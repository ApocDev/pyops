-- Sushi-loop tools: trace the belt loop from a seed belt, set one
-- "read belt contents — hold (entire belt)" reader per belt segment, stitch the
-- segments onto one red-wire network, measure the loop, and push the
-- measurement to the app (sushi.trace). Untrace removes exactly what the
-- matching trace added. Entry points are plain functions (hotkey today, panel
-- button / shortcut later) plus a remote interface for tooling.
local Sushi = {}

-- injected by control.lua (like Tasks.send) — sends a bridge request
Sushi.send = nil

local BELT_TYPES = {
  ["transport-belt"] = true,
  ["underground-belt"] = true,
  ["splitter"] = true,
}

-- flood-fill safety cap: a sushi loop is hundreds of tiles; hitting this means
-- the seed leaks into a bus and we bail instead of wiring half the factory
local MAX_ENTITIES = 4000

local function dist(a, b)
  local dx, dy = a.position.x - b.position.x, a.position.y - b.position.y
  return math.sqrt(dx * dx + dy * dy)
end

-- All belt-graph neighbours of an entity: belt_neighbours both ways, plus the
-- buried other half of an underground pair.
local function neighbours_of(e)
  local out = {}
  local bn = e.belt_neighbours or {}
  for _, list in pairs(bn) do
    for _, n in ipairs(list) do
      out[#out + 1] = n
    end
  end
  if e.type == "underground-belt" and e.neighbours then
    out[#out + 1] = e.neighbours
  end
  return out
end

-- A belt already carrying player circuit config we must not touch: existing
-- wires on either connector, or read behavior someone configured.
local function is_configured(e)
  for _, wire in ipairs({ defines.wire_connector_id.circuit_red, defines.wire_connector_id.circuit_green }) do
    local c = e.get_wire_connector(wire, false)
    if c and c.connection_count > 0 then
      return true
    end
  end
  local cb = e.get_control_behavior()
  return cb ~= nil and (cb.read_contents or cb.circuit_enable_disable)
end

-- Flood-fill the belt component from `seed`. DFS order on purpose: consecutive
-- entities then mostly follow the physical belt path, so the wire chain hugs
-- the loop instead of zigzagging across it (BFS alternates directions).
-- Returns entities (array), a by-unit-number set, and whether we blew the cap.
local function collect_component(seed)
  local queue, entities, seen = { seed }, {}, {}
  seen[seed.unit_number] = true
  while #queue > 0 do
    local e = table.remove(queue)
    entities[#entities + 1] = e
    if #entities > MAX_ENTITIES then
      return entities, seen, true
    end
    for _, n in ipairs(neighbours_of(e)) do
      if n.valid and BELT_TYPES[n.type] and not seen[n.unit_number] then
        seen[n.unit_number] = true
        queue[#queue + 1] = n
      end
    end
  end
  return entities, seen, false
end

-- Prune feed-in/feed-off spurs: the loop proper is the flow core where every
-- belt is both fed and feeding within the component. A pickup stub for an
-- inserter, or a lane feeding ONTO the loop, dead-ends on one side — drop
-- those (repeatedly, so whole spur arms unravel) and keep only the cycles.
local function prune_spurs(entities, seen)
  local removed = 0
  local changed = true
  while changed do
    changed = false
    for i = #entities, 1, -1 do
      local e = entities[i]
      local bn = e.belt_neighbours or {}
      local ins, outs = 0, 0
      for _, n in ipairs(bn.inputs or {}) do
        if n.valid and seen[n.unit_number] then
          ins = ins + 1
        end
      end
      for _, n in ipairs(bn.outputs or {}) do
        if n.valid and seen[n.unit_number] then
          outs = outs + 1
        end
      end
      if e.type == "underground-belt" and e.neighbours and seen[e.neighbours.unit_number] then
        -- the buried link is this end's missing flow direction
        if e.belt_to_ground_type == "input" then
          outs = outs + 1
        else
          ins = ins + 1
        end
      end
      if ins == 0 or outs == 0 then
        seen[e.unit_number] = nil
        table.remove(entities, i)
        removed = removed + 1
        changed = true
      end
    end
  end
  return removed
end

-- Belt tiles the component covers: belts 1, splitters 2, undergrounds 1 each
-- plus the buried gap (counted once per pair).
local function measure_tiles(entities)
  local tiles = 0
  for _, e in ipairs(entities) do
    if e.type == "splitter" then
      tiles = tiles + 2
    elseif e.type == "underground-belt" then
      tiles = tiles + 1
      local pair = e.neighbours
      if pair and pair.valid and e.unit_number < pair.unit_number then
        tiles = tiles + math.max(0, math.floor(dist(e, pair) + 0.5) - 1)
      end
    else
      tiles = tiles + 1
    end
  end
  return tiles
end

-- Does feeding belt `a` continue the same game segment as `b`? A lone input
-- makes a curve (same segment); with several inputs only the one sitting
-- directly BEHIND `b` continues its line — side-positioned feeders SIDELOAD,
-- which ends their segment (verified: a reader on the main line does not see
-- a sideloading branch). Positional, not direction-based: a curve's direction
-- is its output heading, so direction equality mis-splits curves.
local function same_segment(a, b)
  local inputs = (b.belt_neighbours or {}).inputs or {}
  if #inputs <= 1 then
    return true
  end
  local dx, dy = 0, 0
  if b.direction == defines.direction.north then
    dy = 1
  elseif b.direction == defines.direction.south then
    dy = -1
  elseif b.direction == defines.direction.east then
    dx = -1
  elseif b.direction == defines.direction.west then
    dx = 1
  end
  return a.position.x == b.position.x + dx and a.position.y == b.position.y + dy
end

-- Segments = the game's "entire belt" units: contiguous belt lines ending at
-- splitters and at sideload merges — and NOTHING else. Undergrounds continue
-- the segment, buried span included (probed in-game: readers on opposite
-- sides of a long underground return identical signals). One reader per
-- segment is the fewest read points that still see the whole loop.
local function split_segments(entities, seen)
  local segments, assigned = {}, {}
  local function walkable(n)
    return n.valid
      and (n.type == "transport-belt" or n.type == "underground-belt")
      and seen[n.unit_number]
      and not assigned[n.unit_number]
  end
  for _, e in ipairs(entities) do
    if e.type == "transport-belt" and not assigned[e.unit_number] then
      local seg, queue = {}, { e }
      assigned[e.unit_number] = true
      while #queue > 0 do
        local cur = table.remove(queue, 1)
        seg[#seg + 1] = cur
        local bn = cur.belt_neighbours or {}
        for _, n in ipairs(bn.outputs or {}) do
          if walkable(n) and (n.type ~= "transport-belt" or same_segment(cur, n)) then
            assigned[n.unit_number] = true
            queue[#queue + 1] = n
          end
        end
        for _, n in ipairs(bn.inputs or {}) do
          if walkable(n) and (cur.type ~= "transport-belt" or same_segment(n, cur)) then
            assigned[n.unit_number] = true
            queue[#queue + 1] = n
          end
        end
        if cur.type == "underground-belt" and cur.neighbours and walkable(cur.neighbours) then
          assigned[cur.neighbours.unit_number] = true
          queue[#queue + 1] = cur.neighbours
        end
      end
      segments[#segments + 1] = seg
    end
  end
  return segments
end

local function red_connector(e)
  return e.get_wire_connector(defines.wire_connector_id.circuit_red, true)
end

local function reach_of(e)
  local ok, r = pcall(function()
    return e.prototype.get_max_circuit_wire_distance(e.quality)
  end)
  return (ok and r and r > 0) and r or 9
end

-- Player-legal wire: only connect when the span is within BOTH prototypes'
-- wire reach — scripts may cheat longer wires, but the player couldn't rebuild
-- or edit them, so we never make one.
local function try_connect(a, b)
  if not (a and b) or a == b then
    return false
  end
  if dist(a, b) > math.min(reach_of(a), reach_of(b)) then
    return false
  end
  local ca, cb = red_connector(a), red_connector(b)
  return ca ~= nil and cb ~= nil and ca.connect_to(cb, false)
end

local function network_id(e)
  local net = e.get_circuit_network(defines.wire_connector_id.circuit_red)
  return net and net.network_id or nil
end

local function traces_store()
  storage.pyops_sushi_traces = storage.pyops_sushi_traces or {}
  return storage.pyops_sushi_traces
end

-- Trace the loop from `seed` for `player`: measure, set readers, wire, record,
-- report. Returns true when a trace was made.
function Sushi.trace(player, seed)
  seed = seed or player.selected
  if not (seed and seed.valid and BELT_TYPES[seed.type]) then
    player.print({ "", "PyOps sushi: hover a belt of the loop first." })
    return false
  end

  local entities, seen, overflow = collect_component(seed)
  if overflow then
    player.print({
      "",
      "PyOps sushi: stopped after " .. MAX_ENTITIES .. " belt entities — this doesn't look like a closed loop.",
    })
    return false
  end

  -- keep only the circulating core: feed-on/feed-off spurs are not loop stock
  -- (their items are en route, not riding the loop) — don't measure, read, or
  -- wire them. An empty core means there's no cycle at all.
  local spurs = prune_spurs(entities, seen)
  local closed = #entities > 0
  if not closed then
    player.print({ "", "PyOps sushi: no closed loop found from that belt — nothing traced." })
    return false
  end

  local tiles = measure_tiles(entities)
  local segments = split_segments(entities, seen)

  local wires = {}
  local function link(a, b)
    if try_connect(a, b) then
      wires[#wires + 1] = { a = a, b = b }
      return true
    end
    return false
  end

  -- Minimal wiring: a reader sees its WHOLE run from anywhere on it, so the
  -- only wires needed are reader↔reader. Runs converge at junctions, so a
  -- minimum spanning tree over "closest belt pair between two runs" keeps
  -- every wire short and clustered (the hand-optimal pattern) instead of
  -- touring the ring with anchors.
  local n = #segments
  local best = {}
  for i = 1, n do
    best[i] = {}
    for j = i + 1, n do
      local bd, ba, bb = math.huge, nil, nil
      for _, a in ipairs(segments[i]) do
        if a.type == "transport-belt" then -- only plain belts hold wires
          for _, b in ipairs(segments[j]) do
            if b.type == "transport-belt" then
              local d = dist(a, b)
              if d < bd then
                bd, ba, bb = d, a, b
              end
            end
          end
        end
      end
      best[i][j] = { a = ba, b = bb, d = bd }
    end
  end
  local function edge(i, j)
    return i < j and best[i][j] or best[j][i]
  end

  -- Prim's MST, edges capped at wire reach; unreachable runs stay islands.
  local in_tree, tree_edges = { [1] = true }, {}
  local tree_size = 1
  while tree_size < n do
    local bi, bj, bd = nil, nil, math.huge
    for i = 1, n do
      if in_tree[i] then
        for j = 1, n do
          if not in_tree[j] then
            local e = edge(i, j)
            if e.d < bd and e.a and e.d <= math.min(reach_of(e.a), reach_of(e.b)) then
              bi, bj, bd = i, j, e.d
            end
          end
        end
      end
    end
    if not bi then
      break -- remaining runs are beyond belt reach — reported as islands below
    end
    in_tree[bj] = true
    tree_size = tree_size + 1
    tree_edges[#tree_edges + 1] = { i = bi, j = bj, pair = edge(bi, bj) }
  end

  local function run_of(e)
    for i = 1, n do
      for _, b in ipairs(segments[i]) do
        if b == e then
          return i
        end
      end
    end
  end
  -- a run can carry SEVERAL tree-edge endpoints (it's a belt, not a wire —
  -- being on the same run connects nothing electrically), so keep them all
  -- and chain every one of them to the run's reader below
  local wire_points = {}
  for i = 1, n do
    wire_points[i] = {}
  end
  for _, te in ipairs(tree_edges) do
    local ra, rb = run_of(te.pair.a), run_of(te.pair.b)
    table.insert(wire_points[ra], te.pair.a)
    table.insert(wire_points[rb], te.pair.b)
  end

  -- One reader per run — the fewest read points that still see the whole loop
  -- ("entire belt" covers a run from anywhere on it). Place it AT the run's
  -- wire point so the readers cluster at the junctions and the tree edges
  -- connect them directly; fall back to the nearest unconfigured belt when
  -- the wire point is already circuit-configured (skip-and-warn).
  local readers, run_reader, skipped = {}, {}, 0
  for i = 1, n do
    local wp = wire_points[i][1]
    if not wp then
      for _, b in ipairs(segments[i]) do
        if b.type == "transport-belt" then
          wp = b
          break
        end
      end
    end
    local reader = nil
    if wp and not is_configured(wp) then
      reader = wp
    elseif wp then
      local sorted = {}
      for _, b in ipairs(segments[i]) do
        if b.type == "transport-belt" then
          sorted[#sorted + 1] = b
        end
      end
      table.sort(sorted, function(x, y)
        return dist(wp, x) < dist(wp, y)
      end)
      for _, b in ipairs(sorted) do
        if not is_configured(b) then
          reader = b
          break
        end
      end
    end
    if reader then
      local cb = reader.get_or_create_control_behavior()
      cb.read_contents = true
      cb.read_contents_mode = defines.control_behavior.transport_belt.content_read_mode.entire_belt_hold
      run_reader[i] = reader
      readers[#readers + 1] = reader
    else
      skipped = skipped + 1
    end
  end
  if #readers == 0 then
    player.print({ "", "PyOps sushi: every run is already circuit-configured — nothing to wire." })
    return false
  end

  for _, te in ipairs(tree_edges) do
    link(te.pair.a, te.pair.b)
  end

  -- chain every wire point of a run to its reader: direct when in reach, else
  -- greedy full-reach strides along the run's own belts toward the reader
  for i = 1, n do
    local r = run_reader[i]
    for _, wp in ipairs(wire_points[i]) do
      if r and r ~= wp and network_id(r) ~= network_id(wp) then
        local cur, guard = wp, 0
        while guard < 64 do
          guard = guard + 1
          if link(cur, r) then
            break
          end
          local best_b, best_d = nil, dist(cur, r)
          for _, b in ipairs(segments[i]) do
            if
              b ~= cur
              and b.type == "transport-belt"
              and dist(cur, b) <= math.min(reach_of(cur), reach_of(b))
            then
              local d = dist(b, r)
              if d < best_d then
                best_b, best_d = b, d
              end
            end
          end
          if not (best_b and link(cur, best_b)) then
            break
          end
          cur = best_b
        end
      end
    end
  end

  local trace = { readers = readers, wires = wires, tiles = tiles, tick = game.tick }
  local store = traces_store()
  store[#store + 1] = trace

  -- did everything land on ONE network? (a reader per remaining island)
  local island_of, islands = {}, {}
  for _, r in ipairs(readers) do
    local id = network_id(r)
    if id and not island_of[id] then
      island_of[id] = r
      islands[#islands + 1] = r
    end
  end

  local parts = {
    "PyOps sushi: " .. tiles .. " tiles, " .. #segments .. " segment(s), " .. #readers .. " reader(s) set",
  }
  if skipped > 0 then
    parts[#parts + 1] = ", " .. skipped .. " segment(s) skipped (already configured)"
  end
  if spurs > 0 then
    parts[#parts + 1] = ", " .. spurs .. " spur belt(s) excluded"
  end
  if #islands <= 1 then
    parts[#parts + 1] = ". Loop contents are on one red network — connect your set-point combinator anywhere on it."
  else
    parts[#parts + 1] = ". Couldn't stitch it into one network with player-legal wires — bridge these with a power pole:"
    player.print({ "", table.concat(parts) })
    for i = 2, math.min(#islands, 4) do
      local a, b = islands[1], islands[i]
      player.print({
        "",
        "  · wire near [gps=" .. a.position.x .. "," .. a.position.y .. "] to [gps=" .. b.position.x .. "," .. b.position.y .. "]",
      })
    end
    parts = nil
  end
  if parts then
    player.print({ "", table.concat(parts) })
  end

  if Sushi.send then
    Sushi.send(player, "sushi.trace", {
      tiles = tiles,
      belts = #entities,
      segments = #segments,
      readers = #readers,
      skipped = skipped,
      closed = closed,
    })
  end
  return true
end

-- Remove the most recent trace: our wires, then our readers' read flags.
function Sushi.untrace(player)
  local store = traces_store()
  local trace = table.remove(store)
  if not trace then
    player.print({ "", "PyOps sushi: no trace to remove." })
    return false
  end
  local wires_removed = 0
  for _, w in ipairs(trace.wires or {}) do
    if w.a.valid and w.b.valid then
      if red_connector(w.a).disconnect_from(red_connector(w.b)) then
        wires_removed = wires_removed + 1
      end
    end
  end
  local readers_reset = 0
  for _, r in ipairs(trace.readers or {}) do
    if r.valid then
      local cb = r.get_control_behavior()
      if cb then
        cb.read_contents = false
        readers_reset = readers_reset + 1
      end
    end
  end
  player.print({
    "",
    "PyOps sushi: removed " .. wires_removed .. " wire(s), reset " .. readers_reset .. " reader(s).",
  })
  return true
end

return Sushi
