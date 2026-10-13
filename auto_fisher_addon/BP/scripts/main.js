import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

/**
 * Production-ready Auto-Fisherman NPC Script
 * Minecraft Bedrock Edition (1.21.x+)
 * Version: 1.5.0 - Player-Like Fishing Mechanics & 3D Rod System
 * Author: kurofy
 * 
 * Major Features in v1.5.0:
 * - 3D Visible Fishing Rod rendered in hand via custom geometry & render controller
 * - Authentic Player-Like Fishing Mechanics:
 *   * Rod casting with water landing splash
 *   * Visible fishing line particles connecting rod tip to the water bobber
 *   * Surface ripple & approaching fish wake bubble trails
 *   * Realistic bite splash & reel audio
 *   * Caught items fly through the air towards the NPC's feet (applyImpulse)
 *   * Reel animation pulling the rod back into the air
 * - Fixed persistent session lifecycle (eliminated sound spamming & lack of output)
 * - Dual Rod Giving System:
 *   1) UI button takes rod directly from player inventory (no need to hold)
 *   2) Players can drop a fishing rod onto the NPC to equip it automatically
 * - Stored Experience (EXP) System: collects 1-6 EXP per catch; collect via UI
 * - Strict Inactive state enforcement when NPC has no rod
 */

const CONFIG = {
  VERSION: "1.5.0",
  PANEL_TITLE: "§6FISHERMAN Control Panel (v1.5.0)",
  POLL_INTERVAL_TICKS: 10, // 0.5 seconds for smooth line & particle updates
  NPC_IDENTIFIER: "custom:fisherman_npc",
  SPAWN_EGG_IDENTIFIER: "custom:fisherman_spawn_egg",
  ROD_IDENTIFIER: "minecraft:fishing_rod",
  NPC_NAME_TAG: "§6FISHERMAN",
  TAG_HAS_ROD: "has_rod",
  TAG_PAUSED: "fisher_paused",
  TAG_FISHING: "fishing",
  PROPERTY_IS_FISHING: "custom:is_fishing",
  PROPERTY_HAS_ROD: "custom:has_rod",
  PROPERTY_IS_REELING: "custom:is_reeling",
  MIN_WAIT_TICKS: 100, // 5 seconds
  MAX_WAIT_TICKS: 180, // 9 seconds
  EXP_OBJECTIVE_NAME: "fisher_exp",
};

// Vanilla Fishing Loot distribution
const LOOT_CATEGORIES = [
  {
    category: "fish",
    weight: 85,
    entries: [
      { id: "minecraft:cod", weight: 60, min: 1, max: 1 },
      { id: "minecraft:salmon", weight: 25, min: 1, max: 1 },
      { id: "minecraft:pufferfish", weight: 13, min: 1, max: 1 },
      { id: "minecraft:tropical_fish", weight: 2, min: 1, max: 1 },
    ],
  },
  {
    category: "junk",
    weight: 10,
    entries: [
      { id: "minecraft:lily_pad", weight: 17, min: 1, max: 1 },
      { id: "minecraft:leather_boots", weight: 10, min: 1, max: 1 },
      { id: "minecraft:leather", weight: 10, min: 1, max: 1 },
      { id: "minecraft:bone", weight: 10, min: 1, max: 2 },
      { id: "minecraft:string", weight: 10, min: 1, max: 2 },
      { id: "minecraft:potion", weight: 10, min: 1, max: 1 }, // Water bottle
      { id: "minecraft:fishing_rod", weight: 2, min: 1, max: 1 },
      { id: "minecraft:bowl", weight: 10, min: 1, max: 1 },
      { id: "minecraft:stick", weight: 5, min: 1, max: 2 },
      { id: "minecraft:ink_sac", weight: 1, min: 1, max: 3 },
      { id: "minecraft:tripwire_hook", weight: 10, min: 1, max: 1 },
      { id: "minecraft:rotten_flesh", weight: 10, min: 1, max: 2 },
    ],
  },
  {
    category: "treasure",
    weight: 5,
    entries: [
      { id: "minecraft:bow", weight: 1, min: 1, max: 1 },
      { id: "minecraft:enchanted_book", weight: 1, min: 1, max: 1 },
      { id: "minecraft:fishing_rod", weight: 1, min: 1, max: 1 },
      { id: "minecraft:name_tag", weight: 1, min: 1, max: 1 },
      { id: "minecraft:nautilus_shell", weight: 1, min: 1, max: 1 },
      { id: "minecraft:saddle", weight: 1, min: 1, max: 1 },
    ],
  },
];

/**
 * @typedef {Object} SessionState
 * @property {"IDLE" | "WAITING" | "REELING"} state
 * @property {{x: number, y: number, z: number} | null} targetWater
 * @property {{x: number, y: number, z: number} | null} bobberPos
 * @property {number} waitTicks
 * @property {boolean} biteAlerted
 */

/** @type {Map<string, SessionState>} */
const activeSessions = new Map();

// -------------------------------------------------------------
// EXP SCOREBOARD MANAGEMENT
// -------------------------------------------------------------

/**
 * Retrieve or create scoreboard objective for storing Fisherman EXP
 * @returns {import("@minecraft/server").ScoreboardObjective | null}
 */
function getExpObjective() {
  try {
    let obj = world.scoreboard.getObjective(CONFIG.EXP_OBJECTIVE_NAME);
    if (!obj) {
      obj = world.scoreboard.addObjective(CONFIG.EXP_OBJECTIVE_NAME, "Fisher EXP");
    }
    return obj;
  } catch {
    return null;
  }
}

/**
 * Get stored EXP for a fisherman NPC
 * @param {import("@minecraft/server").Entity} npc
 * @returns {number}
 */
function getStoredExp(npc) {
  try {
    const obj = getExpObjective();
    if (!obj) return 0;
    return obj.getScore(npc) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Add EXP to a fisherman NPC
 * @param {import("@minecraft/server").Entity} npc
 * @param {number} amount
 * @returns {number}
 */
function addStoredExp(npc, amount) {
  try {
    const obj = getExpObjective();
    if (!obj) return 0;
    const current = obj.getScore(npc) ?? 0;
    const next = current + amount;
    obj.setScore(npc, next);
    return next;
  } catch {
    return 0;
  }
}

/**
 * Clear stored EXP for a fisherman NPC
 * @param {import("@minecraft/server").Entity} npc
 */
function clearStoredExp(npc) {
  try {
    const obj = getExpObjective();
    if (obj) {
      obj.setScore(npc, 0);
    }
  } catch {}
}

// -------------------------------------------------------------
// WATER DETECTION HELPERS
// -------------------------------------------------------------

/**
 * Check if a block position contains liquid water
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
function isWaterBlock(dimension, pos) {
  try {
    const block = dimension.getBlock(pos);
    if (!block) return false;
    return (
      block.typeId === "minecraft:water" ||
      block.typeId === "minecraft:flowing_water" ||
      block.isWaterlogged
    );
  } catch {
    return false;
  }
}

/**
 * Check if there is water directly in front of the placement position
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{x: number, y: number, z: number}} spawnPos
 * @param {{x: number, z: number}} forwardDir
 * @returns {boolean}
 */
function hasWaterInFront(dimension, spawnPos, forwardDir) {
  const dirX = forwardDir.x;
  const dirZ = forwardDir.z;

  const perpX = -dirZ;
  const perpZ = dirX;

  for (const dist of [1, 2, 3]) {
    for (const side of [-1, -0.5, 0, 0.5, 1]) {
      const targetX = Math.floor(spawnPos.x + dirX * dist + perpX * side);
      const targetZ = Math.floor(spawnPos.z + dirZ * dist + perpZ * side);

      for (let dy = -2; dy <= 1; dy++) {
        const checkPos = {
          x: targetX,
          y: Math.floor(spawnPos.y) + dy,
          z: targetZ,
        };
        if (isWaterBlock(dimension, checkPos)) {
          return true;
        }
      }
    }
  }

  // 360-degree fallback check around spawn position within 2 blocks
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 0; dy++) {
        const checkPos = {
          x: Math.floor(spawnPos.x) + dx,
          y: Math.floor(spawnPos.y) + dy,
          z: Math.floor(spawnPos.z) + dz,
        };
        if (isWaterBlock(dimension, checkPos)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Find water block positioned in front of or near the NPC
 * @param {import("@minecraft/server").Entity} entity
 * @returns {{x: number, y: number, z: number} | null}
 */
function findWaterInFront(entity) {
  const dimension = entity.dimension;
  const loc = entity.location;

  let dirX = 0;
  let dirZ = 1;

  try {
    const rot = entity.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    dirX = -Math.sin(rad);
    dirZ = Math.cos(rad);
  } catch {
    try {
      const view = entity.getViewDirection();
      const mag = Math.hypot(view.x, view.z);
      if (mag > 0.001) {
        dirX = view.x / mag;
        dirZ = view.z / mag;
      }
    } catch {}
  }

  const perpX = -dirZ;
  const perpZ = dirX;

  let closestWater = null;
  let minDistanceSq = Infinity;

  // 1. Search forward cone (1 to 3 blocks in front, up to 1.5 blocks to sides, -2 to 1 dy)
  for (const dist of [1, 1.5, 2, 2.5, 3]) {
    for (const side of [-1.2, -0.6, 0, 0.6, 1.2]) {
      const targetX = Math.floor(loc.x + dirX * dist + perpX * side);
      const targetZ = Math.floor(loc.z + dirZ * dist + perpZ * side);

      for (let dy = -2; dy <= 1; dy++) {
        const checkPos = {
          x: targetX,
          y: Math.floor(loc.y) + dy,
          z: targetZ,
        };

        if (isWaterBlock(dimension, checkPos)) {
          const dX = checkPos.x + 0.5 - loc.x;
          const dY = checkPos.y + 0.5 - loc.y;
          const dZ = checkPos.z + 0.5 - loc.z;
          const distSq = dX * dX + dY * dY + dZ * dZ;

          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            closestWater = checkPos;
          }
        }
      }
    }
  }

  // 2. If no water in forward cone, scan surrounding 3-block radius as fallback
  if (!closestWater) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dy = -2; dy <= 1; dy++) {
          const checkPos = {
            x: Math.floor(loc.x) + dx,
            y: Math.floor(loc.y) + dy,
            z: Math.floor(loc.z) + dz,
          };

          if (isWaterBlock(dimension, checkPos)) {
            const dX = checkPos.x + 0.5 - loc.x;
            const dY = checkPos.y + 0.5 - loc.y;
            const dZ = checkPos.z + 0.5 - loc.z;
            const distSq = dX * dX + dY * dY + dZ * dZ;

            if (distSq < minDistanceSq) {
              minDistanceSq = distSq;
              closestWater = checkPos;
            }
          }
        }
      }
    }

    // Orient NPC towards found water
    if (closestWater) {
      try {
        const dX = closestWater.x + 0.5 - loc.x;
        const dZ = closestWater.z + 0.5 - loc.z;
        const yaw = Math.atan2(-dX, dZ) * (180 / Math.PI);
        entity.setRotation({ x: 0, y: yaw });
      } catch {}
    }
  }

  return closestWater;
}

// -------------------------------------------------------------
// LOOT & EQUIPMENT HELPERS
// -------------------------------------------------------------

/**
 * Generate a random fishing loot item stack
 * @returns {ItemStack}
 */
function rollFishingLoot() {
  const totalCatWeight = LOOT_CATEGORIES.reduce((acc, c) => acc + c.weight, 0);
  let roll = Math.random() * totalCatWeight;
  let selectedCat = LOOT_CATEGORIES[0];

  for (const cat of LOOT_CATEGORIES) {
    if (roll < cat.weight) {
      selectedCat = cat;
      break;
    }
    roll -= cat.weight;
  }

  const totalItemWeight = selectedCat.entries.reduce((acc, e) => acc + e.weight, 0);
  let itemRoll = Math.random() * totalItemWeight;
  let selected = selectedCat.entries[0];

  for (const entry of selectedCat.entries) {
    if (itemRoll < entry.weight) {
      selected = entry;
      break;
    }
    itemRoll -= entry.weight;
  }

  const count = Math.floor(Math.random() * (selected.max - selected.min + 1)) + selected.min;
  try {
    return new ItemStack(selected.id, count);
  } catch {
    return new ItemStack("minecraft:cod", 1);
  }
}

/**
 * Set entity client-side states (fishing rod visibility, fishing state, reeling)
 * @param {import("@minecraft/server").Entity} entity
 * @param {boolean} hasRod
 * @param {boolean} isFishing
 * @param {boolean} isReeling
 */
function syncEntityVisuals(entity, hasRod, isFishing, isReeling = false) {
  try {
    entity.setProperty(CONFIG.PROPERTY_HAS_ROD, hasRod);
  } catch {}
  try {
    entity.setProperty(CONFIG.PROPERTY_IS_FISHING, isFishing);
  } catch {}
  try {
    entity.setProperty(CONFIG.PROPERTY_IS_REELING, isReeling);
  } catch {}

  // Sync tags
  try {
    if (hasRod) {
      if (!entity.hasTag(CONFIG.TAG_HAS_ROD)) entity.addTag(CONFIG.TAG_HAS_ROD);
    } else {
      if (entity.hasTag(CONFIG.TAG_HAS_ROD)) entity.removeTag(CONFIG.TAG_HAS_ROD);
    }

    if (isFishing) {
      if (!entity.hasTag(CONFIG.TAG_FISHING)) entity.addTag(CONFIG.TAG_FISHING);
    } else {
      if (entity.hasTag(CONFIG.TAG_FISHING)) entity.removeTag(CONFIG.TAG_FISHING);
    }
  } catch {}
}

/**
 * Equip a Fishing Rod in the NPC's mainhand socket & show 3D rod model
 * @param {import("@minecraft/server").Entity} npc
 */
function equipRodOnNpc(npc) {
  syncEntityVisuals(npc, true, false, false);
  try {
    npc.triggerEvent("custom:give_rod");
  } catch {}
  try {
    const equip = npc.getComponent("equippable");
    if (equip) {
      equip.setEquipment("Mainhand", new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
    }
  } catch {}
}

/**
 * Unequip the Fishing Rod from the NPC's mainhand & hide 3D rod model
 * @param {import("@minecraft/server").Entity} npc
 */
function unequipRodFromNpc(npc) {
  syncEntityVisuals(npc, false, false, false);
  try {
    npc.triggerEvent("custom:take_rod");
  } catch {}
  try {
    const equip = npc.getComponent("equippable");
    if (equip) {
      equip.setEquipment("Mainhand", undefined);
    }
  } catch {}
}

// -------------------------------------------------------------
// PLAYER-LIKE FISHING MECHANISM (v1.5.0)
// -------------------------------------------------------------

/**
 * Start casting the fishing line into the target water block (like a player)
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 * @param {{x: number, y: number, z: number}} waterPos
 */
function startCasting(entity, session, waterPos) {
  const dimension = entity.dimension;
  const bobberPos = {
    x: waterPos.x + 0.5,
    y: waterPos.y + 0.85,
    z: waterPos.z + 0.5,
  };

  session.state = "WAITING";
  session.targetWater = waterPos;
  session.bobberPos = bobberPos;
  session.waitTicks = Math.floor(
    Math.random() * (CONFIG.MAX_WAIT_TICKS - CONFIG.MIN_WAIT_TICKS + 1)
  ) + CONFIG.MIN_WAIT_TICKS;
  session.biteAlerted = false;

  syncEntityVisuals(entity, true, true, false);
  try {
    entity.triggerEvent("custom:start_fishing");
  } catch {}

  // Initial cast splash sound & particles on the water bobber
  try {
    dimension.playSound("random.splash", bobberPos, { volume: 0.8, pitch: 1.0 });
    dimension.spawnParticle("minecraft:water_splash_particle", bobberPos);
  } catch {}
}

/**
 * Render authentic fishing line particles from NPC's rod tip to the water bobber
 * @param {import("@minecraft/server").Entity} entity
 * @param {{x: number, y: number, z: number}} bobberPos
 */
function renderFishingLine(entity, bobberPos) {
  try {
    const loc = entity.location;
    const rot = entity.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    const dirX = -Math.sin(rad);
    const dirZ = Math.cos(rad);

    // Position of the 3D fishing rod tip extending from the right hand
    const rodTipPos = {
      x: loc.x + dirX * 0.75 - dirZ * 0.25,
      y: loc.y + 1.25,
      z: loc.z + dirZ * 0.75 + dirX * 0.25,
    };

    const dim = entity.dimension;

    // Draw 3 subtle line particles along the line vector
    for (const t of [0.3, 0.6, 0.85]) {
      const px = rodTipPos.x + (bobberPos.x - rodTipPos.x) * t;
      const py = rodTipPos.y + (bobberPos.y - rodTipPos.y) * t;
      const pz = rodTipPos.z + (bobberPos.z - rodTipPos.z) * t;

      dim.spawnParticle("minecraft:falling_dust_gravel_particle", {
        x: px,
        y: py,
        z: pz,
      });
    }
  } catch {}
}

/**
 * Complete the reel-in: trigger bite splash, fly caught item to player/NPC feet, and collect EXP
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 */
function completeReelIn(entity, session) {
  const dimension = entity.dimension;
  const bobberPos = session.bobberPos || {
    x: entity.location.x,
    y: entity.location.y,
    z: entity.location.z,
  };

  // 1. Splash & reel sounds
  try {
    dimension.playSound("random.splash", bobberPos, { volume: 1.0, pitch: 1.3 });
    dimension.playSound("random.bowhit", entity.location, { volume: 1.0, pitch: 1.2 });
  } catch {}

  // 2. Splash and wake particle explosion at water bobber
  try {
    dimension.spawnParticle("minecraft:water_splash_particle", bobberPos);
    dimension.spawnParticle("minecraft:water_wake_particle", bobberPos);
  } catch {}

  // 3. Trigger reel animation on NPC
  syncEntityVisuals(entity, true, true, true);
  try {
    entity.triggerEvent("custom:catch_fish");
  } catch {}

  // 4. Roll fishing loot and spawn item with physical impulse flying to NPC feet
  const loot = rollFishingLoot();
  try {
    const itemEntity = dimension.spawnItem(loot, bobberPos);
    if (itemEntity) {
      const dx = entity.location.x - bobberPos.x;
      const dy = entity.location.y - bobberPos.y;
      const dz = entity.location.z - bobberPos.z;
      const dist = Math.hypot(dx, dz) || 1;

      itemEntity.clearVelocity?.();
      itemEntity.applyImpulse({
        x: (dx / dist) * Math.min(dist * 0.22, 0.5),
        y: 0.38 + Math.max(dy * 0.08, 0),
        z: (dz / dist) * Math.min(dist * 0.22, 0.5),
      });
    }
  } catch (err) {
    console.warn(`[AutoFisher] Failed to spawn/launch caught item: ${err}`);
  }

  // 5. Collect 1 to 6 EXP points into NPC stored EXP
  const expGained = Math.floor(Math.random() * 6) + 1;
  addStoredExp(entity, expGained);

  try {
    dimension.spawnParticle("minecraft:villager_happy", {
      x: entity.location.x,
      y: entity.location.y + 1.6,
      z: entity.location.z,
    });
  } catch {}

  // 6. Enter REELING state (1.5 seconds cooldown) to let reel animation & item flight complete
  session.state = "REELING";
  session.waitTicks = 30; // 30 ticks = 1.5 seconds
}

// -------------------------------------------------------------
// DROPPED ROD CHECK (OPTION 2: DROP ROD ON NPC)
// -------------------------------------------------------------

/**
 * Scan for dropped fishing rod items directly near the NPC (Option 2)
 * @param {import("@minecraft/server").Entity} npc
 */
function checkForDroppedRod(npc) {
  if (!npc.isValid() || npc.hasTag(CONFIG.TAG_HAS_ROD)) return;

  try {
    const nearbyItems = npc.dimension.getEntities({
      location: npc.location,
      maxDistance: 2.0,
      type: "minecraft:item",
    });

    for (const itemEntity of nearbyItems) {
      if (!itemEntity.isValid()) continue;
      const itemComp = itemEntity.getComponent("item");
      if (!itemComp) continue;

      const stack = itemComp.itemStack;
      if (stack && stack.typeId === CONFIG.ROD_IDENTIFIER) {
        // Consume 1 rod from dropped stack
        if (stack.amount > 1) {
          stack.amount -= 1;
          itemComp.itemStack = stack;
        } else {
          itemEntity.remove();
        }

        equipRodOnNpc(npc);

        const loc = npc.location;
        const dim = npc.dimension;
        dim.playSound("armor.equip_generic", loc, { volume: 1.0, pitch: 1.0 });
        dim.playSound("random.orb", loc, { volume: 0.8, pitch: 1.2 });
        dim.spawnParticle("minecraft:villager_happy", {
          x: loc.x,
          y: loc.y + 1.2,
          z: loc.z,
        });

        // Notify nearby players
        const nearbyPlayers = dim.getPlayers({ location: loc, maxDistance: 8.0 });
        for (const p of nearbyPlayers) {
          p.onScreenDisplay?.setActionBar("§a[Fisherman] Picked up dropped Fishing Rod! Now ACTIVE.");
        }
        break;
      }
    }
  } catch {}
}

// -------------------------------------------------------------
// MASTER UPDATE TICK FOR INDIVIDUAL NPC
// -------------------------------------------------------------

/**
 * Main evaluation tick for an individual Fisherman NPC
 * @param {import("@minecraft/server").Entity} entity
 */
function updateFisherman(entity) {
  if (!entity.isValid()) {
    activeSessions.delete(entity.id);
    return;
  }

  // Enforce name tag is always §6FISHERMAN
  if (entity.nameTag !== CONFIG.NPC_NAME_TAG) {
    entity.nameTag = CONFIG.NPC_NAME_TAG;
  }

  let session = activeSessions.get(entity.id);
  if (!session) {
    session = {
      state: "IDLE",
      targetWater: null,
      bobberPos: null,
      waitTicks: 0,
      biteAlerted: false,
    };
    activeSessions.set(entity.id, session);
  }

  // Check if NPC has a Fishing Rod
  let hasRod = entity.hasTag(CONFIG.TAG_HAS_ROD);

  // If no rod yet, check for dropped rods on the ground (Option 2)
  if (!hasRod) {
    checkForDroppedRod(entity);
    hasRod = entity.hasTag(CONFIG.TAG_HAS_ROD);
  }

  // INACTIVE ENFORCEMENT: When there is NO rod, NPC must be completely inactive!
  if (!hasRod) {
    syncEntityVisuals(entity, false, false, false);
    session.state = "IDLE";
    session.targetWater = null;
    session.bobberPos = null;
    session.waitTicks = 0;
    return;
  }

  // Ensure 3D rod is visible when rod is equipped
  syncEntityVisuals(entity, true, session.state !== "IDLE", session.state === "REELING");

  // Check if manually paused via toggle
  const isPaused = entity.hasTag(CONFIG.TAG_PAUSED);
  if (isPaused) {
    if (session.state !== "IDLE") {
      session.state = "IDLE";
      session.targetWater = null;
      session.bobberPos = null;
      session.waitTicks = 0;
      syncEntityVisuals(entity, true, false, false);
      try {
        entity.triggerEvent("custom:stop_fishing");
      } catch {}
    }
    return;
  }

  // Scan for water block
  const waterPos = findWaterInFront(entity);
  if (!waterPos) {
    if (session.state !== "IDLE") {
      session.state = "IDLE";
      session.targetWater = null;
      session.bobberPos = null;
      session.waitTicks = 0;
      syncEntityVisuals(entity, true, false, false);
      try {
        entity.triggerEvent("custom:stop_fishing");
      } catch {}
    }
    // Ambient confusion particles when facing dry ground
    try {
      entity.dimension.spawnParticle("minecraft:villager_angry", {
        x: entity.location.x,
        y: entity.location.y + 1.9,
        z: entity.location.z,
      });
    } catch {}
    return;
  }

  // State Machine Execution
  switch (session.state) {
    case "IDLE":
      startCasting(entity, session, waterPos);
      break;

    case "WAITING":
      session.waitTicks -= CONFIG.POLL_INTERVAL_TICKS;

      if (session.bobberPos) {
        // 1. Water ripple bubbles at bobber
        try {
          entity.dimension.spawnParticle("minecraft:water_wake_particle", session.bobberPos);
        } catch {}

        // 2. Fishing line connecting rod tip to bobber
        renderFishingLine(entity, session.bobberPos);

        // 3. Approaching fish wake bubbles (last 30 ticks / 1.5 seconds before bite)
        if (session.waitTicks <= 30 && !session.biteAlerted) {
          session.biteAlerted = true;
          try {
            entity.dimension.playSound("random.splash", session.bobberPos, { volume: 0.9, pitch: 1.1 });
            entity.dimension.spawnParticle("minecraft:water_splash_particle", session.bobberPos);
          } catch {}
        }
      }

      // Time to bite & reel!
      if (session.waitTicks <= 0) {
        completeReelIn(entity, session);
      }
      break;

    case "REELING":
      session.waitTicks -= CONFIG.POLL_INTERVAL_TICKS;

      // When reeling duration finishes, reset to idle to begin next cast
      if (session.waitTicks <= 0) {
        syncEntityVisuals(entity, true, false, false);
        try {
          entity.triggerEvent("custom:end_reel");
        } catch {}
        session.state = "IDLE";
      }
      break;
  }
}

// -------------------------------------------------------------
// CONTROL PANEL UI (v1.5.0)
// -------------------------------------------------------------

/**
 * Open Control Panel Dialog for player (safely works even while holding any item)
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} npc
 */
function openFishermanControlPanel(player, npc) {
  if (!npc.isValid() || !player.isValid()) return;

  const isPaused = npc.hasTag(CONFIG.TAG_PAUSED);
  const hasRod = npc.hasTag(CONFIG.TAG_HAS_ROD);
  const storedExp = getStoredExp(npc);

  let statusText = "§c🔴 INACTIVE (No Fishing Rod)";
  if (hasRod) {
    statusText = isPaused ? "§6⏸ PAUSED (Manually Paused)" : "§a🟢 ACTIVE (Fishing)";
  }

  const form = new ActionFormData()
    .title(CONFIG.PANEL_TITLE)
    .body(
      `§7Manage this Fisherman NPC:\n\n` +
      `§f• Status: ${statusText}\n` +
      `§f• Fishing Rod: ${hasRod ? "§aEquipped (Holding 3D Rod)" : "§cNone (Give rod to activate)"}\n` +
      `§f• Stored EXP: §a${storedExp} XP\n` +
      `§f• Output: §bDrops directly at feet\n\n` +
      `§7💡 Tip: Drop a Fishing Rod near the NPC to equip it automatically!`
    )
    .button(
      !hasRod
        ? "⏸ Inactive (Give Rod First)"
        : isPaused
        ? "▶ Resume Fishing (Set ACTIVE)"
        : "⏸ Pause Fishing (Set PAUSED)"
    )
    .button(hasRod ? "🎣 Take Back Fishing Rod" : "🎣 Give Fishing Rod (From Inventory)")
    .button(storedExp > 0 ? `✨ Collect Stored EXP (${storedExp} XP)` : "✨ Collect Stored EXP (0 XP)")
    .button("❌ Delete Fisherman NPC")
    .button("Close");

  const tryShow = (attempt = 0) => {
    if (!player.isValid() || !npc.isValid()) return;

    form.show(player).then((response) => {
      if (response.canceled) {
        if (response.cancelationReason === "UserBusy" && attempt < 10) {
          system.runTimeout(() => tryShow(attempt + 1), 3);
        }
        return;
      }

      if (response.selection === undefined) return;
      const action = response.selection;

      // Button 0: Toggle Status (Active / Paused)
      if (action === 0) {
        if (!hasRod) {
          player.dimension.playSound("note.bass", player.location, { volume: 1.0, pitch: 0.8 });
          player.onScreenDisplay?.setActionBar(
            "§c[Fisherman] Cannot activate: Equip or drop a Fishing Rod first!"
          );
          return;
        }

        if (isPaused) {
          npc.removeTag(CONFIG.TAG_PAUSED);
          player.onScreenDisplay?.setActionBar("§a[Fisherman] Status set to ACTIVE!");
          player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 1.2 });
        } else {
          npc.addTag(CONFIG.TAG_PAUSED);
          syncEntityVisuals(npc, true, false, false);
          try {
            npc.triggerEvent("custom:stop_fishing");
          } catch {}
          const session = activeSessions.get(npc.id);
          if (session) {
            session.state = "IDLE";
            session.waitTicks = 0;
          }
          player.onScreenDisplay?.setActionBar("§c[Fisherman] Status set to PAUSED!");
          player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 0.8 });
        }
        return;
      }

      // Button 1: Give / Take Rod (Option 1: Grab from player inventory)
      if (action === 1) {
        if (hasRod) {
          // Take back rod
          npc.removeTag(CONFIG.TAG_HAS_ROD);
          unequipRodFromNpc(npc);

          const session = activeSessions.get(npc.id);
          if (session) {
            session.state = "IDLE";
            session.waitTicks = 0;
            session.targetWater = null;
            session.bobberPos = null;
          }

          giveOrDropItem(player, new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
          player.dimension.playSound("random.pop", npc.location, { volume: 1.0, pitch: 1.0 });
          player.onScreenDisplay?.setActionBar("§e[Fisherman] Took back your Fishing Rod. NPC is now INACTIVE.");
        } else {
          // Option 1: Give rod directly from player inventory (does not require holding it)
          if (playerHasFishingRod(player)) {
            consumeFishingRodFromPlayer(player);
            equipRodOnNpc(npc);

            player.dimension.playSound("armor.equip_generic", npc.location, { volume: 1.0, pitch: 1.0 });
            player.dimension.spawnParticle("minecraft:villager_happy", {
              x: npc.location.x,
              y: npc.location.y + 1.2,
              z: npc.location.z,
            });
            player.onScreenDisplay?.setActionBar(
              "§a[Fisherman] Equipped Fishing Rod from your inventory! Now ACTIVE."
            );
          } else {
            player.dimension.playSound("note.bass", player.location, { volume: 1.0, pitch: 0.8 });
            player.onScreenDisplay?.setActionBar(
              "§c[Fisherman] No Fishing Rod found in your inventory or hand!"
            );
          }
        }
        return;
      }

      // Button 2: Collect Stored EXP
      if (action === 2) {
        const currentExp = getStoredExp(npc);
        if (currentExp > 0) {
          player.addExperience(currentExp);
          clearStoredExp(npc);
          player.dimension.playSound("random.orb", player.location, { volume: 1.0, pitch: 1.2 });
          player.dimension.spawnParticle("minecraft:villager_happy", {
            x: player.location.x,
            y: player.location.y + 1.2,
            z: player.location.z,
          });
          player.onScreenDisplay?.setActionBar(`§a[Fisherman] Collected ${currentExp} EXP!`);
        } else {
          player.dimension.playSound("note.bass", player.location, { volume: 0.8, pitch: 0.8 });
          player.onScreenDisplay?.setActionBar(
            "§e[Fisherman] No EXP collected yet! (NPC gains 1-6 XP per catch)"
          );
        }
        return;
      }

      // Button 3: Delete Fisherman NPC
      if (action === 3) {
        deleteFishermanNPC(npc, player);
        return;
      }
    }).catch(() => {});
  };

  tryShow();
}

/**
 * Safely delete fisherman NPC and return spawn egg, rod, and collected EXP
 * @param {import("@minecraft/server").Entity} npc
 * @param {import("@minecraft/server").Player} [player]
 */
function deleteFishermanNPC(npc, player) {
  if (!npc.isValid()) return;

  const loc = npc.location;
  const dimension = npc.dimension;
  const hadRod = npc.hasTag(CONFIG.TAG_HAS_ROD);
  const storedExp = getStoredExp(npc);

  activeSessions.delete(npc.id);
  clearStoredExp(npc);
  npc.remove();

  dimension.playSound("random.pop", loc, { volume: 1.0, pitch: 1.2 });
  dimension.spawnParticle("minecraft:villager_happy", {
    x: loc.x,
    y: loc.y + 1.0,
    z: loc.z,
  });

  const eggItem = new ItemStack(CONFIG.SPAWN_EGG_IDENTIFIER, 1);
  if (player && player.isValid()) {
    giveOrDropItem(player, eggItem);
    if (hadRod) {
      giveOrDropItem(player, new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
    }
    if (storedExp > 0) {
      player.addExperience(storedExp);
    }
    player.onScreenDisplay?.setActionBar("§c[Fisherman] Fisherman deleted & refunded to inventory.");
  } else {
    dimension.spawnItem(eggItem, loc);
    if (hadRod) {
      dimension.spawnItem(new ItemStack(CONFIG.ROD_IDENTIFIER, 1), loc);
    }
  }
}

/**
 * Give item to player or drop at feet if inventory is full
 * @param {import("@minecraft/server").Player} player
 * @param {ItemStack} item
 */
function giveOrDropItem(player, item) {
  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      const leftover = inv.container.addItem(item);
      if (!leftover || leftover.amount === 0) return;
      player.dimension.spawnItem(leftover, player.location);
      return;
    }
  } catch {}
  player.dimension.spawnItem(item, player.location);
}

/**
 * Check if player has a fishing rod in hand or inventory
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean}
 */
function playerHasFishingRod(player) {
  if (player.getGameMode?.() === "creative") return true;

  try {
    const equip = player.getComponent("equippable");
    if (equip) {
      const item = equip.getEquipment("Mainhand");
      if (item && item.typeId === CONFIG.ROD_IDENTIFIER) return true;
    }
  } catch {}

  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      for (let i = 0; i < inv.container.size; i++) {
        const item = inv.container.getItem(i);
        if (item && item.typeId === CONFIG.ROD_IDENTIFIER) return true;
      }
    }
  } catch {}

  return false;
}

/**
 * Consume 1 fishing rod from player's inventory or hand
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean}
 */
function consumeFishingRodFromPlayer(player) {
  const isCreative = player.getGameMode?.() === "creative";
  if (isCreative) return true;

  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      // 1. Check selected slot first
      const selected = inv.container.getItem(player.selectedSlotIndex);
      if (selected && selected.typeId === CONFIG.ROD_IDENTIFIER) {
        if (selected.amount > 1) {
          selected.amount -= 1;
          inv.container.setItem(player.selectedSlotIndex, selected);
        } else {
          inv.container.setItem(player.selectedSlotIndex, undefined);
        }
        return true;
      }

      // 2. Check all inventory slots
      for (let i = 0; i < inv.container.size; i++) {
        const item = inv.container.getItem(i);
        if (item && item.typeId === CONFIG.ROD_IDENTIFIER) {
          if (item.amount > 1) {
            item.amount -= 1;
            inv.container.setItem(i, item);
          } else {
            inv.container.setItem(i, undefined);
          }
          return true;
        }
      }
    }
  } catch {}

  return false;
}

/**
 * Consume 1 item from player's mainhand in survival mode
 * @param {import("@minecraft/server").Player} player
 */
function consumeHandItem(player) {
  const isCreative = player.getGameMode?.() === "creative";
  if (isCreative) return;

  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      const slot = player.selectedSlotIndex;
      const current = inv.container.getItem(slot);
      if (current) {
        if (current.amount > 1) {
          current.amount -= 1;
          inv.container.setItem(slot, current);
        } else {
          inv.container.setItem(slot, undefined);
        }
      }
    }
  } catch {}
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------

// 1. Placement via custom:fisherman_spawn_egg (Enforces water in front or nearby)
world.beforeEvents.itemUseOn.subscribe((event) => {
  const { itemStack, source: player, block, blockFace } = event;
  if (!itemStack || itemStack.typeId !== CONFIG.SPAWN_EGG_IDENTIFIER) return;

  event.cancel = true;

  system.run(() => {
    if (!player.isValid()) return;
    const dimension = player.dimension;

    const faceOffsets = {
      Up: { x: 0.5, y: 1.0, z: 0.5 },
      Down: { x: 0.5, y: -1.0, z: 0.5 },
      North: { x: 0.5, y: 0.0, z: -0.5 },
      South: { x: 0.5, y: 0.0, z: 1.5 },
      East: { x: 1.5, y: 0.0, z: 0.5 },
      West: { x: -0.5, y: 0.0, z: 0.5 },
    };
    const offset = faceOffsets[blockFace] || { x: 0.5, y: 1.0, z: 0.5 };
    const spawnPos = {
      x: block.x + offset.x,
      y: block.y + offset.y,
      z: block.z + offset.z,
    };

    // Calculate facing direction away from player
    const pLoc = player.location;
    const dx = spawnPos.x - pLoc.x;
    const dz = spawnPos.z - pLoc.z;
    const mag = Math.hypot(dx, dz) || 1;
    const forwardDir = { x: dx / mag, z: dz / mag };

    // Water verification
    const waterDetected = hasWaterInFront(dimension, spawnPos, forwardDir);
    if (!waterDetected) {
      dimension.playSound("note.bass", player.location, { volume: 1.0, pitch: 0.8 });
      player.onScreenDisplay?.setActionBar(
        "§cCannot place: There must be water nearby or directly in front of the Fisherman!"
      );
      return;
    }

    try {
      const npc = dimension.spawnEntity(CONFIG.NPC_IDENTIFIER, spawnPos);
      npc.nameTag = CONFIG.NPC_NAME_TAG;

      // Orient facing the water
      const yaw = Math.atan2(-forwardDir.x, forwardDir.z) * (180 / Math.PI);
      npc.setRotation({ x: 0, y: yaw });

      dimension.playSound("random.pop", spawnPos, { volume: 1.0, pitch: 1.0 });
      dimension.spawnParticle("minecraft:villager_happy", {
        x: spawnPos.x,
        y: spawnPos.y + 1.0,
        z: spawnPos.z,
      });

      consumeHandItem(player);
      player.onScreenDisplay?.setActionBar(
        "§aFisherman placed! Configure via UI or drop a Fishing Rod on the NPC."
      );
    } catch (err) {
      console.warn(`[AutoFisher] Failed to spawn fisherman: ${err}`);
    }
  });
});

// 2. Interaction handling (Opens Control Panel cleanly when holding any item or rod)
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { target: npc, player } = event;
  if (!npc || npc.typeId !== CONFIG.NPC_IDENTIFIER) return;

  event.cancel = true;

  // Run on next tick to resolve interact tick and prevent UserBusy state
  system.runTimeout(() => {
    if (!npc.isValid() || !player.isValid()) return;
    openFishermanControlPanel(player, npc);
  }, 1);
});

// 3. Melee hit handling (Sneak + Hit = break/retrieve, Standing Hit = protected)
world.afterEvents.entityHitEntity.subscribe((event) => {
  const { damagingEntity, hitEntity } = event;
  if (!hitEntity || hitEntity.typeId !== CONFIG.NPC_IDENTIFIER) return;
  if (!damagingEntity || damagingEntity.typeId !== "minecraft:player") return;

  const player = damagingEntity;
  const npc = hitEntity;

  if (player.isSneaking) {
    system.run(() => {
      if (npc.isValid()) {
        deleteFishermanNPC(npc, player);
      }
    });
  } else {
    try {
      player.dimension.playSound("armor.equip_generic", npc.location, { volume: 0.8, pitch: 1.5 });
    } catch {}
    player.onScreenDisplay?.setActionBar(
      "§eFisherman is protected! Sneak + Hit (Jongkok + Pukul) to pick up."
    );
  }
});

// 4. Entity Death (Refunds egg and rod on death)
world.afterEvents.entityDie.subscribe((event) => {
  const { deadEntity } = event;
  if (deadEntity && deadEntity.typeId === CONFIG.NPC_IDENTIFIER) {
    activeSessions.delete(deadEntity.id);
    const loc = deadEntity.location;
    const dim = deadEntity.dimension;
    dim.spawnItem(new ItemStack(CONFIG.SPAWN_EGG_IDENTIFIER, 1), loc);
    if (deadEntity.hasTag(CONFIG.TAG_HAS_ROD)) {
      dim.spawnItem(new ItemStack(CONFIG.ROD_IDENTIFIER, 1), loc);
    }
    clearStoredExp(deadEntity);
  }
});

// 5. Master tick polling loop (runs every 10 ticks / 0.5s)
system.runInterval(() => {
  const dimensions = ["overworld", "nether", "the_end"];

  for (const dimName of dimensions) {
    try {
      const dimension = world.getDimension(dimName);
      if (!dimension) continue;

      const entities = dimension.getEntities({
        type: CONFIG.NPC_IDENTIFIER,
      });

      for (const entity of entities) {
        try {
          updateFisherman(entity);
        } catch (err) {
          console.warn(`[AutoFisher] Error updating NPC: ${err}`);
        }
      }
    } catch {}
  }

  // Safe prune of stale sessions using world.getEntity
  for (const [entityId] of activeSessions) {
    try {
      const e = world.getEntity(entityId);
      if (!e || !e.isValid()) {
        activeSessions.delete(entityId);
      }
    } catch {
      activeSessions.delete(entityId);
    }
  }
}, CONFIG.POLL_INTERVAL_TICKS);

console.info(`[AutoFisher] Auto-Fisherman NPC v${CONFIG.VERSION} initialized successfully.`);
