import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

/**
 * Auto-Fisherman NPC Script
 * Minecraft Bedrock Edition (1.21.x+)
 * 
 * Core Features:
 * - Vanilla Held Fishing Rod in mainhand (rightItem socket with standard humanoid idle pose)
 * - Accumulated Stored XP System via dynamic property ("stored_xp")
 * - 1 to 6 XP awarded per successful catch across Fish, Junk, and Treasure categories
 * - "Claim Stored XP" button in UI granting XP to player and resetting counter
 * - Dynamic Enchantment Detection:
 *   * Lure I-III: Dynamically reduces catch cycle time from 15-25s down to 5-10s
 *   * Luck of the Sea I-III: Dynamically shifts loot weights (+2/4/6% treasure, -2/4/6% junk)
 * - Immersion Particles: water_splash_particle & bubble_column_up_particle with bite splash audio
 * - Infinite Durability: Fishing rod never loses durability or breaks
 * - Dual Rod Giving System (Inventory Button + Dropped Rod on NPC)
 */

const CONFIG = {
  POLL_INTERVAL_TICKS: 10, // 0.5s ticks for responsive particles and timing
  NPC_IDENTIFIER: "custom:fisherman_npc",
  SPAWN_EGG_IDENTIFIER: "custom:fisherman_spawn_egg",
  ROD_IDENTIFIER: "minecraft:fishing_rod",
  NPC_NAME_TAG: "§6FISHERMAN",
  TAG_HAS_ROD: "has_rod",
  TAG_PAUSED: "fisher_paused",
  DYNAMIC_PROP_XP: "stored_xp",
};

// Base Vanilla Fishing Loot distribution
const BASE_LOOT_TABLE = {
  fish: [
    { id: "minecraft:cod", weight: 60, min: 1, max: 1 },
    { id: "minecraft:salmon", weight: 25, min: 1, max: 1 },
    { id: "minecraft:pufferfish", weight: 13, min: 1, max: 1 },
    { id: "minecraft:tropical_fish", weight: 2, min: 1, max: 1 },
  ],
  junk: [
    { id: "minecraft:lily_pad", weight: 17, min: 1, max: 1 },
    { id: "minecraft:leather_boots", weight: 10, min: 1, max: 1 },
    { id: "minecraft:leather", weight: 10, min: 1, max: 1 },
    { id: "minecraft:bone", weight: 10, min: 1, max: 2 },
    { id: "minecraft:string", weight: 10, min: 1, max: 2 },
    { id: "minecraft:potion", weight: 10, min: 1, max: 1 },
    { id: "minecraft:fishing_rod", weight: 2, min: 1, max: 1 },
    { id: "minecraft:bowl", weight: 10, min: 1, max: 1 },
    { id: "minecraft:stick", weight: 5, min: 1, max: 2 },
    { id: "minecraft:ink_sac", weight: 1, min: 1, max: 3 },
    { id: "minecraft:tripwire_hook", weight: 10, min: 1, max: 1 },
    { id: "minecraft:rotten_flesh", weight: 10, min: 1, max: 2 },
  ],
  treasure: [
    { id: "minecraft:bow", weight: 1, min: 1, max: 1 },
    { id: "minecraft:enchanted_book", weight: 1, min: 1, max: 1 },
    { id: "minecraft:fishing_rod", weight: 1, min: 1, max: 1 },
    { id: "minecraft:name_tag", weight: 1, min: 1, max: 1 },
    { id: "minecraft:nautilus_shell", weight: 1, min: 1, max: 1 },
    { id: "minecraft:saddle", weight: 1, min: 1, max: 1 },
  ],
};

/**
 * @typedef {Object} SessionState
 * @property {"IDLE" | "WAITING"} state
 * @property {{x: number, y: number, z: number} | null} targetWater
 * @property {{x: number, y: number, z: number} | null} bobberPos
 * @property {number} waitTicks
 * @property {boolean} biteAlerted
 */

/** @type {Map<string, SessionState>} */
const activeSessions = new Map();

// -------------------------------------------------------------
// DYNAMIC PROPERTIES: STORED XP SYSTEM
// -------------------------------------------------------------

/**
 * Get stored XP for an NPC instance using dynamic property
 * @param {import("@minecraft/server").Entity} npc
 * @returns {number}
 */
function getStoredXp(npc) {
  try {
    const val = npc.getDynamicProperty(CONFIG.DYNAMIC_PROP_XP);
    return typeof val === "number" ? val : 0;
  } catch {
    return 0;
  }
}

/**
 * Add XP to an NPC instance using dynamic property
 * @param {import("@minecraft/server").Entity} npc
 * @param {number} amount
 * @returns {number}
 */
function addStoredXp(npc, amount) {
  try {
    const current = getStoredXp(npc);
    const next = current + amount;
    npc.setDynamicProperty(CONFIG.DYNAMIC_PROP_XP, next);
    return next;
  } catch {
    return 0;
  }
}

/**
 * Reset stored XP for an NPC instance to 0
 * @param {import("@minecraft/server").Entity} npc
 */
function clearStoredXp(npc) {
  try {
    npc.setDynamicProperty(CONFIG.DYNAMIC_PROP_XP, 0);
  } catch {}
}

// -------------------------------------------------------------
// ENCHANTMENT DETECTION & DURABILITY PROTECTION
// -------------------------------------------------------------

/**
 * Inspect the rod for Lure and Luck of the Sea enchantments
 * @param {ItemStack | undefined} rodItem
 * @returns {{ lureLevel: number, luckLevel: number }}
 */
function getRodEnchantments(rodItem) {
  let lureLevel = 0;
  let luckLevel = 0;

  if (!rodItem) return { lureLevel, luckLevel };

  // 1. Try ItemEnchantableComponent ("minecraft:enchantable" or "enchantable")
  try {
    const enchantable = rodItem.getComponent("minecraft:enchantable") || rodItem.getComponent("enchantable");
    if (enchantable) {
      if (typeof enchantable.getEnchantment === "function") {
        const lure = enchantable.getEnchantment("lure") || enchantable.getEnchantment("minecraft:lure");
        if (lure) lureLevel = Math.max(lureLevel, lure.level);

        const luck = enchantable.getEnchantment("luck_of_the_sea") || enchantable.getEnchantment("minecraft:luck_of_the_sea");
        if (luck) luckLevel = Math.max(luckLevel, luck.level);
      } else if (typeof enchantable.getEnchantments === "function") {
        const enchants = enchantable.getEnchantments();
        for (const e of enchants) {
          const typeId = String(e.type?.id || e.id || "");
          if (typeId.includes("lure")) lureLevel = Math.max(lureLevel, e.level);
          if (typeId.includes("luck_of_the_sea")) luckLevel = Math.max(luckLevel, e.level);
        }
      }
    }
  } catch {}

  // 2. Try legacy ItemEnchantsComponent ("minecraft:enchants" or "enchants")
  try {
    const enchantsComp = rodItem.getComponent("minecraft:enchants") || rodItem.getComponent("enchants");
    if (enchantsComp && enchantsComp.enchantments) {
      const enchantsList = enchantsComp.enchantments;
      if (typeof enchantsList.getEnchantment === "function") {
        const lure = enchantsList.getEnchantment("lure") || enchantsList.getEnchantment("minecraft:lure");
        if (lure) lureLevel = Math.max(lureLevel, lure.level);

        const luck = enchantsList.getEnchantment("luck_of_the_sea") || enchantsList.getEnchantment("minecraft:luck_of_the_sea");
        if (luck) luckLevel = Math.max(luckLevel, luck.level);
      }
    }
  } catch {}

  return { lureLevel, luckLevel };
}

/**
 * Ensure fishing rod never takes damage or breaks
 * @param {ItemStack} rodItem
 * @param {import("@minecraft/server").EntityEquippableComponent} equippable
 */
function ensureInfiniteDurability(rodItem, equippable) {
  try {
    const durComp = rodItem.getComponent("durability") || rodItem.getComponent("minecraft:durability");
    if (durComp && durComp.damage > 0) {
      durComp.damage = 0;
      equippable.setEquipment(EquipmentSlot.Mainhand, rodItem);
    }
  } catch {}
}

/**
 * Calculate dynamic cycle wait ticks based on Lure enchantment level
 * - Baseline (No Lure): 6–10 seconds (120–200 ticks)
 * - Lure I: 5–8 seconds (100–160 ticks)
 * - Lure II: 4–6 seconds (80–120 ticks)
 * - Lure III+: 2–4 seconds (40–80 ticks)
 * @param {number} lureLevel
 * @returns {number}
 */
function calculateWaitTicks(lureLevel) {
  let minSec = 6;
  let maxSec = 10;
  if (lureLevel === 1) {
    minSec = 5;
    maxSec = 8;
  } else if (lureLevel === 2) {
    minSec = 4;
    maxSec = 6;
  } else if (lureLevel >= 3) {
    minSec = 2;
    maxSec = 4;
  }
  const chosenSeconds = Math.random() * (maxSec - minSec) + minSec;
  return Math.floor(chosenSeconds * 20);
}

/**
 * Roll random fishing loot based on Luck of the Sea enchantment level
 * Base: Fish 85%, Junk 10%, Treasure 5%
 * Luck I: Fish 85%, Junk 8%, Treasure 7%
 * Luck II: Fish 85%, Junk 6%, Treasure 9%
 * Luck III: Fish 85%, Junk 4%, Treasure 11%
 * @param {number} luckLevel
 * @returns {ItemStack}
 */
function rollFishingLoot(luckLevel) {
  const treasureWeight = 5 + Math.min(luckLevel, 3) * 2;
  const junkWeight = Math.max(2, 10 - Math.min(luckLevel, 3) * 2);
  const fishWeight = 85;

  const totalCatWeight = fishWeight + junkWeight + treasureWeight;
  let catRoll = Math.random() * totalCatWeight;

  let selectedCategory = "fish";
  if (catRoll < fishWeight) {
    selectedCategory = "fish";
  } else if (catRoll < fishWeight + junkWeight) {
    selectedCategory = "junk";
  } else {
    selectedCategory = "treasure";
  }

  const entries = BASE_LOOT_TABLE[selectedCategory];
  const totalItemWeight = entries.reduce((acc, e) => acc + e.weight, 0);
  let itemRoll = Math.random() * totalItemWeight;
  let selectedEntry = entries[0];

  for (const entry of entries) {
    if (itemRoll < entry.weight) {
      selectedEntry = entry;
      break;
    }
    itemRoll -= entry.weight;
  }

  const count = Math.floor(Math.random() * (selectedEntry.max - selectedEntry.min + 1)) + selectedEntry.min;
  try {
    const item = new ItemStack(selectedEntry.id, count);
    if (
      selectedEntry.id === "minecraft:fishing_rod" ||
      selectedEntry.id === "minecraft:bow" ||
      selectedEntry.id === "minecraft:leather_boots"
    ) {
      try {
        const dur = item.getComponent("minecraft:durability") || item.getComponent("durability");
        if (dur && dur.maxDurability) {
          dur.damage = Math.floor(Math.random() * (dur.maxDurability * 0.7)) + Math.floor(dur.maxDurability * 0.1);
        }
      } catch {}
    }
    return item;
  } catch {
    return new ItemStack("minecraft:cod", 1);
  }
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
 * Check if there is water directly in front of or near placement position
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

  // 1. Search forward cone (1 to 3 blocks in front)
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

  // 2. Fallback search 3-block radius around NPC
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
// EQUIPMENT & ROD MANAGEMENT
// -------------------------------------------------------------

/**
 * Equip a Fishing Rod in the NPC's mainhand socket using EquipmentSlot.Mainhand
 * @param {import("@minecraft/server").Entity} npc
 * @param {ItemStack} [rodItem]
 */
function equipRodOnNpc(npc, rodItem) {
  try {
    const equip = npc.getComponent("minecraft:equippable") || npc.getComponent("equippable");
    if (equip) {
      const itemToEquip = rodItem ?? new ItemStack(CONFIG.ROD_IDENTIFIER, 1);
      equip.setEquipment(EquipmentSlot.Mainhand, itemToEquip);
    }
  } catch (err) {
    console.warn(`[AutoFisher] Failed to set mainhand equipment: ${err}`);
  }
  if (!npc.hasTag(CONFIG.TAG_HAS_ROD)) npc.addTag(CONFIG.TAG_HAS_ROD);
}

/**
 * Unequip the Fishing Rod from the NPC's mainhand
 * @param {import("@minecraft/server").Entity} npc
 * @returns {ItemStack | undefined}
 */
function unequipRodFromNpc(npc) {
  let existingRod;
  try {
    const equip = npc.getComponent("minecraft:equippable") || npc.getComponent("equippable");
    if (equip) {
      existingRod = equip.getEquipment(EquipmentSlot.Mainhand);
      equip.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  } catch {}
  if (npc.hasTag(CONFIG.TAG_HAS_ROD)) npc.removeTag(CONFIG.TAG_HAS_ROD);
  return existingRod;
}

// -------------------------------------------------------------
// FISHING LINE PARTICLE TRAIL & VECTOR INTERPOLATION
// -------------------------------------------------------------

/**
 * Calculate approximate rod tip coordinate based on NPC position, eye height, and facing direction offset
 * @param {import("@minecraft/server").Entity} entity
 * @returns {{x: number, y: number, z: number}}
 */
function getRodTipLocation(entity) {
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

  return {
    x: loc.x + dirX * 0.6 - perpX * 0.25,
    y: loc.y + 1.2,
    z: loc.z + dirZ * 0.6 - perpZ * 0.25,
  };
}

/**
 * Render simulated fishing line particle trail between rod tip and water bobber using linear interpolation
 * @param {import("@minecraft/server").Dimension} dimension
 * @param {{x: number, y: number, z: number}} p1 Rod tip coordinate
 * @param {{x: number, y: number, z: number}} p2 Water bobber coordinate
 * @param {number} [steps=6] Number of interpolation steps
 */
function spawnFishingLineTrail(dimension, p1, p2, steps = 6) {
  if (!p1 || !p2 || !dimension) return;
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const interpPos = {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t - Math.sin(t * Math.PI) * 0.12,
      z: p1.z + (p2.z - p1.z) * t,
    };
    try {
      dimension.spawnParticle("minecraft:basic_crit_particle", interpPos);
    } catch {
      try {
        dimension.spawnParticle("minecraft:endrod", interpPos);
      } catch {}
    }
  }
}

// -------------------------------------------------------------
// VANILLA /LOOT CATCH GENERATION & CHEST OFFLOADING
// -------------------------------------------------------------

/**
 * Attempt to offload spawned item entities near targetPos into adjacent containers (chests/barrels/hoppers)
 * If containers are full or none are found, items remain intact on the ground.
 * @param {import("@minecraft/server").Entity} npc
 * @param {{x: number, y: number, z: number}} targetPos
 */
function tryOffloadItemsToContainer(npc, targetPos) {
  if (!npc.isValid()) return;
  const dimension = npc.dimension;
  const loc = npc.location;

  const blockX = Math.floor(loc.x);
  const blockY = Math.floor(loc.y);
  const blockZ = Math.floor(loc.z);

  // Search adjacent blocks around NPC for containers (under, cardinal sides, diagonal, top)
  const offsets = [
    { dx: 0, dy: -1, dz: 0 }, // under NPC (chest/hopper)
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 1 },
    { dx: 0, dy: 0, dz: -1 },
    { dx: 1, dy: -1, dz: 0 },
    { dx: -1, dy: -1, dz: 0 },
    { dx: 0, dy: -1, dz: 1 },
    { dx: 0, dy: -1, dz: -1 },
    { dx: 0, dy: 1, dz: 0 },
  ];

  const containers = [];
  for (const off of offsets) {
    try {
      const block = dimension.getBlock({
        x: blockX + off.dx,
        y: blockY + off.dy,
        z: blockZ + off.dz,
      });
      if (!block) continue;

      const invComp = block.getComponent("inventory");
      if (invComp && invComp.container && !containers.includes(invComp.container)) {
        containers.push(invComp.container);
      }
    } catch {}
  }

  // If no container found, leave item entities intact on the floor
  if (containers.length === 0) return;

  // Query spawned item entities within a 2.5-block radius of the spawn position
  try {
    const itemEntities = dimension.getEntities({
      location: targetPos,
      maxDistance: 2.5,
      type: "minecraft:item",
    });

    for (const itemEntity of itemEntities) {
      if (!itemEntity.isValid()) continue;
      const itemComp = itemEntity.getComponent("item") || itemEntity.getComponent("minecraft:item");
      if (!itemComp || !itemComp.itemStack) continue;

      let remainingStack = itemComp.itemStack.clone();
      const initialAmount = remainingStack.amount;

      for (const container of containers) {
        if (!remainingStack || remainingStack.amount <= 0) break;
        try {
          remainingStack = container.addItem(remainingStack);
        } catch {}
      }

      if (!remainingStack || remainingStack.amount <= 0) {
        // Completely inserted into container, despawn item entity
        itemEntity.remove();
      } else if (remainingStack.amount < initialAmount) {
        // Partially inserted, update entity item stack
        itemComp.itemStack = remainingStack;
      }
      // If container is full, remaining item entity stays intact on the floor
    }
  } catch (err) {
    console.warn(`[AutoFisher] Container offloading failed: ${err}`);
  }
}

// -------------------------------------------------------------
// FISHING CYCLE EXECUTION
// -------------------------------------------------------------

/**
 * Start casting the fishing line into target water block
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 * @param {{x: number, y: number, z: number}} waterPos
 * @param {number} lureLevel
 */
function startCasting(entity, session, waterPos, lureLevel) {
  const dimension = entity.dimension;
  const bobberPos = {
    x: waterPos.x + 0.5,
    y: waterPos.y + 0.9,
    z: waterPos.z + 0.5,
  };

  session.state = "WAITING";
  session.targetWater = waterPos;
  session.bobberPos = bobberPos;
  session.waitTicks = calculateWaitTicks(lureLevel);
  session.biteAlerted = false;

  try {
    dimension.playSound("random.splash", bobberPos, { volume: 0.8, pitch: 1.0 });
    dimension.spawnParticle("minecraft:water_splash_particle", bobberPos);
  } catch {}
}

/**
 * Complete the reel-in: trigger vanilla /loot command, offload to chest if present, award 1-6 XP
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 * @param {number} luckLevel
 */
function completeReel(entity, session, luckLevel) {
  const dimension = entity.dimension;
  const bobberPos = session.bobberPos || entity.location;

  // 1. Reel audio & bite splash
  try {
    dimension.playSound("random.splash", bobberPos, { volume: 1.0, pitch: 1.3 });
    dimension.playSound("random.bowhit", entity.location, { volume: 1.0, pitch: 1.2 });
  } catch {}

  // 2. Water splash particles at surface
  try {
    dimension.spawnParticle("minecraft:water_splash_particle", bobberPos);
  } catch {}

  // Trigger entity reeling animation
  try {
    entity.triggerEvent("custom:catch_fish");
    system.runTimeout(() => {
      if (entity.isValid()) {
        entity.triggerEvent("custom:end_reel");
      }
    }, 20);
  } catch {}

  // 3. Compute forward spawn position in front of the NPC (right at feet on shore)
  let dir = { x: 0, z: 1 };
  try {
    const rot = entity.getRotation();
    const rad = (rot.y * Math.PI) / 180;
    dir.x = -Math.sin(rad);
    dir.z = Math.cos(rad);
  } catch {
    try {
      const view = entity.getViewDirection();
      const mag = Math.hypot(view.x, view.z);
      if (mag > 0.001) {
        dir.x = view.x / mag;
        dir.z = view.z / mag;
      }
    } catch {}
  }

  const spawnPos = {
    x: entity.location.x + dir.x * 0.5,
    y: entity.location.y + 0.25,
    z: entity.location.z + dir.z * 0.5,
  };

  const spawnX = spawnPos.x.toFixed(2);
  const spawnY = spawnPos.y.toFixed(2);
  const spawnZ = spawnPos.z.toFixed(2);

  // 4. Trigger authentic vanilla fishing loot table
  // Bedrock vanilla loot tables: "gameplay/fishing", sub-tables: "treasure", "junk", "fish"
  let tableToUse = "gameplay/fishing";
  if (luckLevel > 0) {
    const treasureChance = 5 + Math.min(luckLevel, 3) * 2;
    const junkChance = Math.max(2, 10 - Math.min(luckLevel, 3) * 2);
    const roll = Math.random() * 100;
    if (roll < treasureChance) {
      tableToUse = "gameplay/fishing/treasure";
    } else if (roll < treasureChance + junkChance) {
      tableToUse = "gameplay/fishing/junk";
    } else {
      tableToUse = "gameplay/fishing/fish";
    }
  }

  let spawned = false;
  try {
    const cmdResult = dimension.runCommand(`loot spawn ${spawnX} ${spawnY} ${spawnZ} loot "${tableToUse}"`);
    if (cmdResult && (cmdResult.successCount ?? 0) > 0) {
      spawned = true;
    }
  } catch (cmdErr) {
    console.warn(`[AutoFisher] /loot command failed (cheats disabled or permission issue): ${cmdErr}`);
  }

  // Guaranteed Vanilla Drop Fallback if /loot produced 0 items or failed
  if (!spawned) {
    try {
      const fallbackLoot = rollFishingLoot(luckLevel);
      dimension.spawnItem(fallbackLoot, spawnPos);
    } catch (spawnErr) {
      console.warn(`[AutoFisher] Direct fallback item spawn failed: ${spawnErr}`);
    }
  }

  // 5. Integration with Chest Offloading (if adjacent chest/barrel/hopper is present)
  tryOffloadItemsToContainer(entity, spawnPos);
  system.runTimeout(() => {
    if (entity.isValid()) {
      tryOffloadItemsToContainer(entity, spawnPos);
    }
  }, 1);

  // 6. Stored XP System: Roll 1 to 6 XP per successful catch
  const xpRoll = Math.floor(Math.random() * 6) + 1;
  addStoredXp(entity, xpRoll);

  try {
    dimension.spawnParticle("minecraft:villager_happy", {
      x: entity.location.x,
      y: entity.location.y + 1.6,
      z: entity.location.z,
    });
  } catch {}

  // Reset session to start next cast
  session.state = "IDLE";
  session.waitTicks = 0;
  session.biteAlerted = false;
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
        let rodToEquip;
        if (stack.amount > 1) {
          stack.amount -= 1;
          itemComp.itemStack = stack;
          rodToEquip = new ItemStack(CONFIG.ROD_IDENTIFIER, 1);
        } else {
          rodToEquip = stack.clone();
          itemEntity.remove();
        }

        equipRodOnNpc(npc, rodToEquip);

        const loc = npc.location;
        const dim = npc.dimension;
        dim.playSound("armor.equip_generic", loc, { volume: 1.0, pitch: 1.0 });
        dim.playSound("random.orb", loc, { volume: 0.8, pitch: 1.2 });
        dim.spawnParticle("minecraft:villager_happy", {
          x: loc.x,
          y: loc.y + 1.2,
          z: loc.z,
        });

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

  // If no tag yet, check if entity already holds a rod (e.g. from equipment loot table)
  if (!hasRod) {
    const equippable = entity.getComponent("minecraft:equippable") || entity.getComponent("equippable");
    if (equippable) {
      const held = equippable.getEquipment(EquipmentSlot.Mainhand);
      if (held && held.typeId === CONFIG.ROD_IDENTIFIER) {
        entity.addTag(CONFIG.TAG_HAS_ROD);
        hasRod = true;
      }
    }
  }

  // If still no rod, check if a player dropped one nearby (Option 2)
  if (!hasRod) {
    checkForDroppedRod(entity);
    hasRod = entity.hasTag(CONFIG.TAG_HAS_ROD);
  }

  // INACTIVE ENFORCEMENT: When there is NO rod, NPC must be completely inactive!
  if (!hasRod) {
    session.state = "IDLE";
    session.targetWater = null;
    session.bobberPos = null;
    session.waitTicks = 0;
    return;
  }

  // Inspect equipped rod in mainhand & protect infinite durability
  const equippable = entity.getComponent("minecraft:equippable") || entity.getComponent("equippable");
  let heldRod;
  if (equippable) {
    heldRod = equippable.getEquipment(EquipmentSlot.Mainhand);
    if (!heldRod || heldRod.typeId !== CONFIG.ROD_IDENTIFIER) {
      equipRodOnNpc(entity);
      heldRod = equippable.getEquipment(EquipmentSlot.Mainhand);
    } else {
      ensureInfiniteDurability(heldRod, equippable);
    }
  }

  // Read enchantments dynamically from held rod (Lure & Luck of the Sea)
  const { lureLevel, luckLevel } = getRodEnchantments(heldRod);

  // Check if manually paused via toggle
  const isPaused = entity.hasTag(CONFIG.TAG_PAUSED);
  if (isPaused) {
    if (session.state !== "IDLE") {
      session.state = "IDLE";
      session.targetWater = null;
      session.bobberPos = null;
      session.waitTicks = 0;
    }
    return;
  }

  // Water verification: If waiting and target water is still liquid, keep it!
  // Otherwise, search for water block in front
  let waterPos = null;
  if (session.state === "WAITING" && session.targetWater) {
    if (isWaterBlock(entity.dimension, session.targetWater)) {
      waterPos = session.targetWater;
    }
  }

  if (!waterPos) {
    waterPos = findWaterInFront(entity);
  }

  if (!waterPos) {
    if (session.state !== "IDLE") {
      session.state = "IDLE";
      session.targetWater = null;
      session.bobberPos = null;
      session.waitTicks = 0;
    }
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
      startCasting(entity, session, waterPos, lureLevel);
      break;

    case "WAITING":
      session.waitTicks -= CONFIG.POLL_INTERVAL_TICKS;

      // Simulated Fishing Line Particle Trail from rod tip to bobber
      if (session.bobberPos) {
        const rodTip = getRodTipLocation(entity);
        spawnFishingLineTrail(entity.dimension, rodTip, session.bobberPos, 6);

        // Water surface bobber particles
        try {
          entity.dimension.spawnParticle("minecraft:bubble_column_up_particle", session.bobberPos);
          entity.dimension.spawnParticle("minecraft:water_splash_particle", session.bobberPos);
        } catch {}

        // Play sound random.splash right before reel-in to indicate a fish biting
        if (session.waitTicks <= 20 && !session.biteAlerted) {
          session.biteAlerted = true;
          try {
            entity.dimension.playSound("random.splash", session.bobberPos, { volume: 1.0, pitch: 1.2 });
          } catch {}
        }
      }

      // Time to complete catch!
      if (session.waitTicks <= 0) {
        completeReel(entity, session, luckLevel);
      }
      break;
  }
}

// -------------------------------------------------------------
// CONTROL PANEL UI
// -------------------------------------------------------------

/**
 * Open Control Panel Dialog for player
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} npc
 */
function openFishermanControlPanel(player, npc) {
  if (!npc.isValid() || !player.isValid()) return;

  const isPaused = npc.hasTag(CONFIG.TAG_PAUSED);
  const hasRod = npc.hasTag(CONFIG.TAG_HAS_ROD);
  const storedXp = getStoredXp(npc);

  const equippable = npc.getComponent("equippable");
  const heldRod = equippable?.getEquipment(EquipmentSlot.Mainhand);
  const { lureLevel, luckLevel } = getRodEnchantments(heldRod);

  let statusText = "§c🔴 INACTIVE (No Fishing Rod)";
  if (hasRod) {
    statusText = isPaused ? "§6⏸ PAUSED (Manually Paused)" : "§a🟢 ACTIVE (Fishing)";
  }

  let rodInfo = "§cNone (Give rod to activate)";
  if (hasRod) {
    const enchantNotes = [];
    if (lureLevel > 0) enchantNotes.push(`Lure ${lureLevel}`);
    if (luckLevel > 0) enchantNotes.push(`Luck of the Sea ${luckLevel}`);
    const notesStr = enchantNotes.length > 0 ? ` (${enchantNotes.join(", ")})` : "";
    rodInfo = `§aEquipped${notesStr}`;
  }

  const form = new ActionFormData()
    .title("§6FISHERMAN Control Panel (v1.6.0)")
    .body(
      `§7Manage this Fisherman NPC:\n\n` +
      `§f• Status: ${statusText}\n` +
      `§f• Fishing Rod: ${rodInfo}\n` +
      `§f• Stored XP: §a${storedXp}\n` +
      `§f• Output: §bAdjacent Chest / Dropped at feet\n\n` +
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
    .button("✨ Claim Stored XP")
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

      // Button 1: Give / Take Rod
      if (action === 1) {
        if (hasRod) {
          const removedRod = unequipRodFromNpc(npc);

          const session = activeSessions.get(npc.id);
          if (session) {
            session.state = "IDLE";
            session.waitTicks = 0;
            session.targetWater = null;
            session.bobberPos = null;
          }

          giveOrDropItem(player, removedRod ?? new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
          player.dimension.playSound("random.pop", npc.location, { volume: 1.0, pitch: 1.0 });
          player.onScreenDisplay?.setActionBar("§e[Fisherman] Took back your Fishing Rod. NPC is now INACTIVE.");
        } else {
          if (playerHasFishingRod(player)) {
            const consumedRod = consumeFishingRodFromPlayer(player);
            equipRodOnNpc(npc, consumedRod);

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

      // Button 2: Claim Stored XP
      if (action === 2) {
        const currentXp = getStoredXp(npc);
        if (currentXp > 0) {
          // Trigger XP reward to player
          try {
            player.addExperience(currentXp);
          } catch {}
          try {
            player.dimension.spawnEntity("minecraft:xp_orb", player.location);
          } catch {}

          clearStoredXp(npc);

          player.dimension.playSound("random.orb", player.location, { volume: 1.0, pitch: 1.2 });
          player.dimension.spawnParticle("minecraft:villager_happy", {
            x: player.location.x,
            y: player.location.y + 1.2,
            z: player.location.z,
          });
          player.onScreenDisplay?.setActionBar(`§a[Fisherman] Claimed ${currentXp} XP!`);
        } else {
          player.dimension.playSound("note.bass", player.location, { volume: 1.0, pitch: 0.8 });
          player.onScreenDisplay?.setActionBar("§e[Fisherman] No stored XP to claim yet!");
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
 * Safely delete fisherman NPC and refund items & stored XP
 * @param {import("@minecraft/server").Entity} npc
 * @param {import("@minecraft/server").Player} [player]
 */
function deleteFishermanNPC(npc, player) {
  if (!npc.isValid()) return;

  const loc = npc.location;
  const dimension = npc.dimension;
  const hadRod = npc.hasTag(CONFIG.TAG_HAS_ROD);
  const storedXp = getStoredXp(npc);

  let heldRod;
  try {
    const equip = npc.getComponent("equippable");
    if (equip) heldRod = equip.getEquipment(EquipmentSlot.Mainhand);
  } catch {}

  activeSessions.delete(npc.id);
  clearStoredXp(npc);
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
      giveOrDropItem(player, heldRod ?? new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
    }
    if (storedXp > 0) {
      try {
        player.addExperience(storedXp);
      } catch {}
    }
    player.onScreenDisplay?.setActionBar("§c[Fisherman] Fisherman deleted & refunded to inventory.");
  } else {
    dimension.spawnItem(eggItem, loc);
    if (hadRod) {
      dimension.spawnItem(heldRod ?? new ItemStack(CONFIG.ROD_IDENTIFIER, 1), loc);
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
      const item = equip.getEquipment(EquipmentSlot.Mainhand);
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
 * Consume 1 fishing rod from player's inventory or hand and return it
 * @param {import("@minecraft/server").Player} player
 * @returns {ItemStack | undefined}
 */
function consumeFishingRodFromPlayer(player) {
  const isCreative = player.getGameMode?.() === "creative";
  if (isCreative) return new ItemStack(CONFIG.ROD_IDENTIFIER, 1);

  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      // 1. Check selected slot first
      const selected = inv.container.getItem(player.selectedSlotIndex);
      if (selected && selected.typeId === CONFIG.ROD_IDENTIFIER) {
        const cloned = selected.clone();
        cloned.amount = 1;
        if (selected.amount > 1) {
          selected.amount -= 1;
          inv.container.setItem(player.selectedSlotIndex, selected);
        } else {
          inv.container.setItem(player.selectedSlotIndex, undefined);
        }
        return cloned;
      }

      // 2. Check all inventory slots
      for (let i = 0; i < inv.container.size; i++) {
        const item = inv.container.getItem(i);
        if (item && item.typeId === CONFIG.ROD_IDENTIFIER) {
          const cloned = item.clone();
          cloned.amount = 1;
          if (item.amount > 1) {
            item.amount -= 1;
            inv.container.setItem(i, item);
          } else {
            inv.container.setItem(i, undefined);
          }
          return cloned;
        }
      }
    }
  } catch {}

  return undefined;
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

      // Automatically equip fishing rod upon placement
      equipRodOnNpc(npc);

      dimension.playSound("random.pop", spawnPos, { volume: 1.0, pitch: 1.0 });
      dimension.spawnParticle("minecraft:villager_happy", {
        x: spawnPos.x,
        y: spawnPos.y + 1.0,
        z: spawnPos.z,
      });

      consumeHandItem(player);
      player.onScreenDisplay?.setActionBar(
        "§aFisherman placed! Equipped with Fishing Rod and ready to fish."
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

// 4. Entity Death (Refunds egg, rod, and stored XP on death)
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
    clearStoredXp(deadEntity);
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

console.info("[AutoFisher] Auto-Fisherman NPC initialized successfully.");
