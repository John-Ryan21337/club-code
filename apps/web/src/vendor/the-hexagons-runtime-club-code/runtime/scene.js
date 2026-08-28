import { buildTessellationGrid, hexVertices, tessellationBoundary, threeRhombi } from "./geometry.js";
import { qualityLimits } from "./config.js";
import { tilePatternOffset } from "./pattern.js";

const TAU = Math.PI * 2;
const ZERO_SHIFT = [0, 0];
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

function hash32(a, b, seed) {
  let value = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function tileAxial(tile) {
  return { q: tile.column, r: tile.row - Math.floor(tile.column / 2) };
}

function axialDistance(aq, ar, bq, br) {
  const dq = aq - bq;
  const dr = ar - br;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function axialPoint(tile, q, r, grid) {
  const own = tileAxial(tile);
  const dq = q - own.q;
  const dr = r - own.r;
  return {
    x: tile.x + grid.radius * 1.5 * dq,
    y: tile.y + grid.radius * Math.sqrt(3) * (dr + dq / 2),
  };
}

function pistonGroup(q, r, tile, grid, settings, role) {
  const point = axialPoint(tile, q, r, grid);
  return {
    id: `${role}:${q}:${r}`,
    q,
    r,
    x: point.x,
    y: point.y,
    phase: (hash32(q, r, settings.seed ^ 0x50495354) / 0xffffffff) * TAU,
  };
}

function offsetTwelveRhombusGroup(tile, facet, grid, settings) {
  const { q, r } = tileAxial(tile);
  let centerQ;
  let centerR;
  if (positiveModulo(q, 2) === 0) {
    centerQ = q;
    centerR = facet === 0 ? Math.ceil(r / 2) * 2 : Math.floor(r / 2) * 2;
  } else if (positiveModulo(r, 2) === 0) {
    centerQ = facet === 0 ? q + 1 : q - 1;
    centerR = r;
  } else {
    centerQ = facet === 2 ? q + 1 : q - 1;
    centerR = facet === 2 ? r - 1 : r + 1;
  }
  return pistonGroup(centerQ, centerR, tile, grid, settings, "twelve");
}

function starHexMembership(tile, facet, grid, settings, role) {
  const { q, r } = tileAxial(tile);
  const qEven = positiveModulo(q, 2) === 0;
  const rEven = positiveModulo(r, 2) === 0;
  let centerQ;
  let centerR;
  let inner = false;

  if (qEven && rEven) {
    centerQ = q;
    centerR = r;
    inner = facet === 0 || facet === 2;
  } else if (!qEven && !rEven) {
    centerQ = q - 1;
    centerR = r + 1;
    inner = facet === 0 || facet === 1;
  } else if (!qEven && rEven) {
    centerQ = q - 1;
    centerR = r;
    inner = facet === 1 || facet === 2;
  } else if (facet === 0) {
    centerQ = q;
    centerR = r + 1;
  } else if (facet === 1) {
    centerQ = q - 2;
    centerR = r + 1;
  } else {
    centerQ = q;
    centerR = r - 1;
  }

  const group = pistonGroup(centerQ, centerR, tile, grid, settings, role);
  group.x += grid.radius;
  return { group, inner };
}

function rhombusGroup(tile, facet, grid, settings, role) {
  const { q, r } = tileAxial(tile);
  const polygon = threeRhombi(tile.x, tile.y, grid.radius)[facet];
  const center = polygon.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  return {
    id: `${role}:${q}:${r}:${facet}`,
    q,
    r,
    x: center[0] / polygon.length,
    y: center[1] / polygon.length,
    phase: (hash32(q * 3 + facet, r, settings.seed ^ 0x52484f4d) / 0xffffffff) * TAU,
  };
}

function nearestStarCenter(tile, grid, settings) {
  const { q, r } = tileAxial(tile);
  const approximateQ = Math.round(q / 6);
  const approximateR = Math.round(r / 6);
  let best = null;
  for (let qOffset = -1; qOffset <= 1; qOffset += 1) {
    for (let rOffset = -1; rOffset <= 1; rOffset += 1) {
      const centerQ = (approximateQ + qOffset) * 6;
      const centerR = (approximateR + rOffset) * 6;
      const distance = axialDistance(q, r, centerQ, centerR);
      if (!best || distance < best.distance || (distance === best.distance && (centerQ < best.q || (centerQ === best.q && centerR < best.r)))) {
        best = { q: centerQ, r: centerR, distance };
      }
    }
  }
  return { ...best, group: pistonGroup(best.q, best.r, tile, grid, settings, "star") };
}

function buildPistonProfiles(grid, settings) {
  return grid.tiles.map((tile) => {
    const axial = tileAxial(tile);
    if (grid.mode !== "rhombille" || settings.pistonPattern === "individual") {
      const group = pistonGroup(axial.q, axial.r, tile, grid, settings, "tile");
      return { active: true, role: "individual", group, facets: [group, group, group], facetRoles: ["individual", "individual", "individual"] };
    }
    if (settings.pistonPattern === "twelve-rhombus") {
      const facets = [0, 1, 2].map((facet) => offsetTwelveRhombusGroup(tile, facet, grid, settings));
      return { active: true, role: "twelve-rhombus", group: facets[0], facets, facetRoles: ["offset-twelve", "offset-twelve", "offset-twelve"] };
    }
    if (settings.pistonPattern === "star-hex-twelve") {
      const memberships = [0, 1, 2].map((facet) => starHexMembership(tile, facet, grid, settings, "star-hex-twelve"));
      return {
        active: true,
        role: "star-hex-twelve",
        group: memberships[0].group,
        facets: memberships.map(({ group }) => group),
        facetRoles: memberships.map(({ inner }) => inner ? "star-core" : "outer-ring"),
      };
    }
    if (settings.pistonPattern === "rhombus-six-one") {
      const memberships = [0, 1, 2].map((facet) => starHexMembership(tile, facet, grid, settings, "rhombus-star"));
      const facets = memberships.map(({ group, inner }, facet) => inner ? group : rhombusGroup(tile, facet, grid, settings, "rhombus-chain"));
      return {
        active: true,
        role: "rhombus-six-one",
        group: facets[0],
        facets,
        facetRoles: memberships.map(({ inner }) => inner ? "rhombus-star" : "rhombus-chain"),
      };
    }
    const star = nearestStarCenter(tile, grid, settings);
    if (star.distance === 1) return { active: true, role: "star", group: star.group, facets: [star.group, star.group, star.group], facetRoles: ["tile-star", "tile-star", "tile-star"] };
    const chain = positiveModulo(axial.q, 6) === 0 || positiveModulo(axial.r, 6) === 0 || positiveModulo(axial.q + axial.r, 6) === 0;
    if (star.distance !== 0 && chain) {
      const group = pistonGroup(axial.q, axial.r, tile, grid, settings, "chain");
      return { active: true, role: "chain", group, facets: [group, group, group], facetRoles: ["tile-chain", "tile-chain", "tile-chain"] };
    }
    return { active: false, role: "inactive", group: null, facets: [null, null, null], facetRoles: ["inactive", "inactive", "inactive"] };
  });
}

function segmentKey(start, end) {
  const pointKey = ([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
  const a = pointKey(start);
  const b = pointKey(end);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function splitHexBoundary(centerX, centerY, radius, group) {
  const vertices = hexVertices(centerX, centerY, radius);
  const segments = [];
  for (let edge = 0; edge < vertices.length; edge += 1) {
    const start = vertices[edge];
    const end = vertices[(edge + 1) % vertices.length];
    const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    segments.push({ start, end: middle, group }, { start: middle, end, group });
  }
  return segments;
}

function buildRhombusGroupTraceSegments(grid, profiles) {
  const groups = new Map();
  for (let tileIndex = 0; tileIndex < grid.tiles.length; tileIndex += 1) {
    const tile = grid.tiles[tileIndex];
    const polygons = threeRhombi(tile.x, tile.y, grid.radius);
    for (let facet = 0; facet < 3; facet += 1) {
      const group = profiles[tileIndex].facets[facet];
      if (!group) continue;
      if (!groups.has(group.id)) groups.set(group.id, { group, edges: new Map() });
      const record = groups.get(group.id);
      const polygon = polygons[facet];
      for (let edge = 0; edge < polygon.length; edge += 1) {
        const start = polygon[edge];
        const end = polygon[(edge + 1) % polygon.length];
        const key = segmentKey(start, end);
        if (record.edges.has(key)) record.edges.delete(key);
        else record.edges.set(key, { start, end, group: record.group });
      }
    }
  }
  return [...groups.values()].flatMap(({ edges }) => [...edges.values()]);
}

function buildStarTraceSegments(grid, settings, profiles) {
  const stars = new Map();
  for (let tileIndex = 0; tileIndex < grid.tiles.length; tileIndex += 1) {
    const tile = grid.tiles[tileIndex];
    const polygons = threeRhombi(tile.x, tile.y, grid.radius);
    for (let facet = 0; facet < 3; facet += 1) {
      const membership = starHexMembership(tile, facet, grid, settings, "mesh-star");
      if (!membership.inner) continue;
      const starId = membership.group.id;
      if (!stars.has(starId)) stars.set(starId, { edges: new Map(), members: 0 });
      const star = stars.get(starId);
      star.members += 1;
      const { edges } = star;
      const polygon = polygons[facet];
      for (let edge = 0; edge < polygon.length; edge += 1) {
        const start = polygon[edge];
        const end = polygon[(edge + 1) % polygon.length];
        const key = segmentKey(start, end);
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, { start, end, group: profiles[tileIndex].facets[facet], starId });
      }
    }
  }
  return [...stars.values()].filter(({ members }) => members === 6).flatMap(({ edges }) => [...edges.values()]);
}

function buildPistonOnlyTraceSegments(grid, settings, profiles) {
  if (settings.pistonPattern === "individual") return null;
  if (settings.pistonPattern === "rhombus-six-one" || settings.pistonPattern === "star-hex-twelve") {
    return buildRhombusGroupTraceSegments(grid, profiles);
  }
  if (settings.pistonPattern === "twelve-rhombus") {
    const groups = new Map();
    for (const profile of profiles) for (const group of profile.facets) groups.set(group.id, group);
    return [...groups.values()].flatMap((group) => splitHexBoundary(group.x, group.y, grid.radius * 2, group));
  }
  const edges = new Map();
  for (let index = 0; index < grid.tiles.length; index += 1) {
    const profile = profiles[index];
    if (!profile.active) continue;
    const tile = grid.tiles[index];
    const vertices = hexVertices(tile.x, tile.y, grid.radius);
    for (let edge = 0; edge < vertices.length; edge += 1) {
      const start = vertices[edge];
      const end = vertices[(edge + 1) % vertices.length];
      const key = segmentKey(start, end);
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, { start, end, group: profile.group });
    }
  }
  return [...edges.values()];
}

function mergeTraceSegments(primary, starSegments) {
  const merged = new Map();
  for (const segment of primary ?? []) merged.set(`${segmentKey(segment.start, segment.end)}|${segment.group?.id ?? "none"}`, segment);
  for (const segment of starSegments) merged.set(`${segmentKey(segment.start, segment.end)}|${segment.group?.id ?? "none"}`, segment);
  return [...merged.values()];
}

function buildPistonTraceSegments(grid, settings, profiles) {
  if (grid.mode !== "rhombille" || settings.meshEnergyPattern === "tile-grid") return null;
  const pistonSegments = buildPistonOnlyTraceSegments(grid, settings, profiles);
  if (settings.meshEnergyPattern === "piston-groups") return pistonSegments;
  const starSegments = buildStarTraceSegments(grid, settings, profiles);
  if (settings.meshEnergyPattern === "six-point-stars") return starSegments;
  return mergeTraceSegments(pistonSegments, starSegments);
}

function buildGapParticles(grid, settings, traceSegments, maximumParticles) {
  const random = mulberry32(settings.seed ^ 0x50415254);
  const requestedMaximum = Math.floor(Number(maximumParticles));
  const maximum = Math.min(
    settings.particleCount,
    qualityLimits(settings.quality).meshParticles,
    Number.isFinite(requestedMaximum) ? Math.max(0, requestedMaximum) : Number.POSITIVE_INFINITY,
  );
  if (maximum === 0 || grid.tiles.length === 0 || (traceSegments && traceSegments.length === 0)) return [];
  const edgeCount = grid.mode === "hexagram" ? 12 : 6;
  const starRoutes = new Map();
  for (const segment of traceSegments ?? []) {
    if (!segment.starId) continue;
    if (!starRoutes.has(segment.starId)) starRoutes.set(segment.starId, []);
    starRoutes.get(segment.starId).push(segment);
  }
  const starGroups = [...starRoutes.entries()];
  const coverageCount = Math.min(maximum, starGroups.length);
  return Array.from({ length: maximum }, (_, index) => {
    const coverageGroup = index < coverageCount ? starGroups[Math.floor(index * starGroups.length / Math.max(1, coverageCount))] : null;
    const segment = coverageGroup
      ? coverageGroup[1][Math.floor(random() * coverageGroup[1].length)]
      : traceSegments?.[Math.floor(random() * traceSegments.length)];
    const tileIndex = segment ? -1 : Math.floor(random() * Math.max(1, grid.tiles.length));
    const edge = segment ? -1 : Math.floor(random() * edgeCount);
    const tile = segment ? null : grid.tiles[tileIndex];
    const vertices = segment ? null : tessellationBoundary(grid.mode, tile.x, tile.y, grid.radius);
    let start = segment?.start ?? vertices[edge % vertices.length];
    let end = segment?.end ?? vertices[(edge + 1) % vertices.length];
    if (settings.meshEnergyFlowMode === "directional") {
      const radians = settings.meshEnergyFlowAngle * Math.PI / 180;
      const directionX = Math.cos(radians);
      const directionY = Math.sin(radians);
      const routeX = end[0] - start[0];
      const routeY = end[1] - start[1];
      const forward = routeX * directionX + routeY * directionY;
      const lateral = routeX * -directionY + routeY * directionX;
      if (forward < -1e-9 || (Math.abs(forward) <= 1e-9 && lateral < 0)) [start, end] = [end, start];
    }
    return {
      tileIndex,
      edge,
      group: segment?.group ?? null,
      starId: segment?.starId ?? null,
      startX: start[0],
      startY: start[1],
      endX: end[0],
      endY: end[1],
      progress: random(),
      speed: settings.particleSpeed * (1 - settings.particleSpeedVariation + random() * settings.particleSpeedVariation * 2),
      size: (0.7 + random() * 2.1) * (segment?.starId ? 1.45 : 1),
      phase: random() * TAU,
    };
  });
}

export function createScene(viewport, display, settings, maximumTiles) {
  const grid = buildTessellationGrid(viewport, display, settings, maximumTiles);
  const pistonProfiles = buildPistonProfiles(grid, settings);
  const meshTraceSegments = buildPistonTraceSegments(grid, settings, pistonProfiles);
  const meshTraceGroups = meshTraceSegments ? [...new Set(meshTraceSegments.map((segment) => segment.group).filter(Boolean))] : [];
  const gapParticles = buildGapParticles(grid, settings, meshTraceSegments, maximumTiles);
  const facetCenters = new Float32Array(grid.tiles.length * 6);
  for (let tileIndex = 0; tileIndex < grid.tiles.length; tileIndex += 1) {
    const tile = grid.tiles[tileIndex];
    const groups = pistonProfiles[tileIndex].facets;
    const offset = tileIndex * 6;
    for (let facet = 0; facet < 3; facet += 1) {
      facetCenters[offset + facet] = groups[facet]?.x ?? tile.x;
      facetCenters[offset + 3 + facet] = groups[facet]?.y ?? tile.y;
    }
  }
  return {
    viewport: { ...viewport },
    display: { ...display },
    grid,
    time: 0,
    pistonProfiles,
    pistonHeights: new Map(),
    meshTraceSegments,
    meshTraceGroups,
    gapParticles,
    tileInstances: new Float32Array(grid.tiles.length * 8),
    facetHeights: new Float32Array(grid.tiles.length * 3),
    facetCenters,
    gapInstances: new Float32Array(Math.max(1, gapParticles.length) * 4),
    gapInstanceCount: 0,
  };
}

function pistonHeight(sample, scene, settings, pointer) {
  if (settings.pistonMode === "off") return 0;
  const { width, height } = scene.viewport;
  const nx = (sample.x - width / 2) / Math.max(1, width / 2);
  const ny = (sample.y - height / 2) / Math.max(1, height / 2);
  const radial = Math.min(1.4, Math.hypot(nx, ny));
  const clock = scene.time * settings.pistonSpeed * TAU;
  if (settings.pistonMode === "pit") {
    const distance = clamp(radial / 1.05, 0, 1);
    const bowl = distance * distance * (3 - 2 * distance);
    const breathing = 1 + Math.sin(clock * 0.22) * 0.04;
    let height = (bowl * 2.15 - 1) * settings.pitDepth * breathing;
    if (settings.pointerAttractionEnabled && pointer?.active) {
      const pointerDistance = Math.hypot(sample.x - pointer.x, sample.y - pointer.y);
      height += Math.exp(-pointerDistance / Math.max(80, scene.grid.radius * 9)) * settings.pitDepth * 0.12;
    }
    return clamp(height, -12, 12);
  }
  let wave = settings.pistonMode === "radial"
    ? Math.cos(radial * Math.PI * 2.4 - clock + sample.phase * 0.12)
    : Math.sin(nx * 5.2 + ny * 3.1 - clock + sample.phase * 0.18);
  wave = wave * 0.44 + (radial - 0.48) * 0.9;
  if (settings.pointerAttractionEnabled && pointer?.active) {
    const distance = Math.hypot(sample.x - pointer.x, sample.y - pointer.y);
    wave += Math.exp(-distance / Math.max(80, scene.grid.radius * 9)) * 0.9;
  }
  return clamp(wave * settings.pistonAmplitude, -1.25, 1.5);
}

function projectedPistonShift(group, height, scene, settings) {
  if (!group || height === 0) return [0, 0];
  const dx = group.x - scene.viewport.width / 2;
  const dy = group.y - scene.viewport.height / 2;
  const length = Math.max(1, Math.hypot(dx, dy));
  const pixels = height * scene.grid.radius * 1.18;
  return [
    (dx / length) * pixels * settings.perspectiveStrength * 0.34,
    (dy / length) * pixels * settings.perspectiveStrength * 0.34 - pixels * 0.42,
  ];
}

function tilePulse(tile, scene, settings) {
  if (!settings.emberPulse) return 0;
  if (settings.emberPattern !== "organic") return settings.emberIntensity * (0.78 + Math.sin(scene.time * 0.8) * 0.22);
  const carrier = Math.sin(scene.time * 0.78 + tile.phase * 3.7);
  return Math.pow(Math.max(0, carrier - 0.72) / 0.28, 2) * settings.emberIntensity;
}

function tileSeparation(tile, scene, settings) {
  if (settings.separationAmount <= 0 || settings.separationFrequency <= 0) return 0;
  const eligible = tile.random < settings.separationFrequency;
  if (!eligible) return 0;
  if (!settings.separationCycle) return settings.separationAmount;
  const cycle = Math.sin(scene.time * 0.42 + tile.phase);
  return Math.pow(Math.max(0, cycle - 0.35) / 0.65, 2) * settings.separationAmount;
}

function writeGapInstances(scene, settings) {
  let count = 0;
  const enabled = settings.gapParticles !== "off" && scene.grid.tiles.length > 0;
  const cycleOpacity = settings.gapParticles === "cycling" ? 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(scene.time * 0.31), 2) : 1;
  if (!enabled || cycleOpacity < 0.02) {
    scene.gapInstanceCount = 0;
    return;
  }
  for (const particle of scene.gapParticles) {
    const t = (particle.progress + scene.time * particle.speed * 0.18) % 1;
    const offset = count * 4;
    const shift = particle.group?.currentShift ?? ZERO_SHIFT;
    scene.gapInstances[offset] = particle.startX + (particle.endX - particle.startX) * t + shift[0];
    scene.gapInstances[offset + 1] = particle.startY + (particle.endY - particle.startY) * t + shift[1];
    scene.gapInstances[offset + 2] = particle.size;
    const shimmer = cycleOpacity * (0.45 + 0.55 * Math.sin(particle.phase + scene.time * 2.1) ** 2);
    scene.gapInstances[offset + 3] = Math.min(1, shimmer * (particle.starId ? 1.35 : 1));
    count += 1;
  }
  scene.gapInstanceCount = count;
}

export function advanceScene(scene, elapsedSeconds, settings, pointer) {
  const delta = clamp(Number(elapsedSeconds) || 0, 0, 0.1);
  scene.time += delta;
  const radius = scene.grid.radius;
  scene.pistonHeights.clear();
  const groupHeight = (group) => {
    if (!group) return 0;
    if (!scene.pistonHeights.has(group.id)) scene.pistonHeights.set(group.id, pistonHeight(group, scene, settings, pointer));
    return scene.pistonHeights.get(group.id);
  };
  for (let index = 0; index < scene.grid.tiles.length; index += 1) {
    const tile = scene.grid.tiles[index];
    const profile = scene.pistonProfiles[index];
    const heights = profile.facets.map(groupHeight);
    const commonHeight = profile.active ? groupHeight(profile.group) : 0;
    const offset = index * 8;
    scene.tileInstances[offset] = tile.x;
    scene.tileInstances[offset + 1] = tile.y;
    scene.tileInstances[offset + 2] = radius;
    scene.tileInstances[offset + 3] = commonHeight;
    scene.tileInstances[offset + 4] = tile.phase;
    scene.tileInstances[offset + 5] = tilePulse(tile, scene, settings);
    scene.tileInstances[offset + 6] = tileSeparation(tile, scene, settings);
    scene.tileInstances[offset + 7] = tilePatternOffset(tile, scene, settings);
    const facetOffset = index * 3;
    scene.facetHeights[facetOffset] = heights[0];
    scene.facetHeights[facetOffset + 1] = heights[1];
    scene.facetHeights[facetOffset + 2] = heights[2];
  }
  for (const group of scene.meshTraceGroups) {
    group.currentHeight = groupHeight(group);
    group.currentShift = projectedPistonShift(group, group.currentHeight, scene, settings);
  }
  writeGapInstances(scene, settings);
  return scene;
}

export function shouldAnimate({ enabled, reducedMotion, documentVisible, windowFocused, continueBackgroundAnimations }) {
  if (!enabled || reducedMotion) return false;
  return continueBackgroundAnimations || (documentVisible && windowFocused);
}
