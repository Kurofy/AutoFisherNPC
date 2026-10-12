import { world, system, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

/**
 * Production-ready Auto-Fisherman NPC Script
 * Minecraft Bedrock Edition (1.21.x+)
 * Author: kurofy
 * 
 * Features:
 * - Survival Crafting & Placement via custom:fisherman_spawn_egg
 * - Stationary, push-immune fisherman entity
 * - ModalFormData configuration UI on empty-hand interaction:
 *   - Status Toggle: [Active / Paused]
 *   - Output Mode Dropdown: Container / World Drop / Player Inventory
 *   - Rod Enchantment Dropdown: Standard / Lure III / Luck of the Sea III
 *   - Recall Entity: Despawns NPC and returns spawn egg
 * - Direction-aware 3x3 water scanning with confusion particles when dry
 * - Authentic sound effects, splash/wake particles, and vanilla fishing loot distribution
 */

const CONFIG = {
  POLL_INTERVAL_TICKS: 20, // 1 second
  NPC_IDENTIFIER: "custom:fisherman_npc",
  SPAWN_EGG_IDENTIFIER: "custom:fisherman_spawn_egg",
  PROPERTY_IS_FISHING: "custom:is_fishing",
  TAG_FISHING: "fishing",
};

// Rod Tiers with authentic cycle durations (in ticks) & loot biases
const ROD_TIERS = [
  {
    name: "Standard Rod",
    minTicks: 300, // 15 seconds
    maxTicks: 500, // 25 seconds
    weights: { fish: 85, junk: 10, treasure: 5 },
  },
  {
    name: "Lure III Tier",
    minTicks: 160, // 8 seconds
    maxTicks: 240, // 12 seconds
    weights: { fish: 85, junk: 10, treasure: 5 },
  },
  {
    name: "Luck of the Sea III Tier",
    minTicks: 300, // 15 seconds
    maxTicks: 500, // 25 seconds
    weights: { fish: 65, junk: 5, treasure: 30 },
  },
];

// Loot Items definition
const LOOT_ITEMS = {
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
    { id: "minecraft:potion", weight: 10, min: 1, max: 1 }, // Water bottle
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

const CONTAINER_BLOCK_IDS = new Set([
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:shulker_box",
  "minecraft:undyed_shulker_box",
]);

/**
 * Active in-memory session tracking
 * @typedef {Object} SessionState
 * @property {string} state - "IDLE" | "CASTING" | "WAITING" | "REELING" | "COOLDOWN"
 * @property {{x: number, y: number, z: number} | null} targetWater
 * @property {number} waitTicksRemaining
 * @property {number} totalWaitTicks
 * @property {number} cooldownTicksRemaining
 * @property {boolean} biteNotified
 */

/** @type {Map<string, SessionState>} */
const activeSessions = new Map();

/**
 * Retrieve persistent configuration from entity dynamic properties
 * @param {import("@minecraft/server").Entity} entity
 */
function getNPCConfig(entity) {
  let isActive = true;
  let outputMode = 0; // 0 = Container, 1 = Ground, 2 = Player
  let rodTier = 0;    // 0 = Standard, 1 = Lure III, 2 = Luck III
  let ownerId = "";

  try {
    const val = entity.getDynamicProperty("is_active");
    if (val !== undefined) isActive = Boolean(val);
  } catch {}

  try {
    const val = entity.getDynamicProperty("output_mode");
    if (val !== undefined) outputMode = Number(val);
  } catch {}

  try {
    const val = entity.getDynamicProperty("rod_tier");
    if (val !== undefined) rodTier = Number(val);
  } catch {}

  try {
    const val = entity.getDynamicProperty("owner_id");
    if (val !== undefined) ownerId = String(val);
  } catch {}

  return { isActive, outputMode, rodTier, ownerId };
}

/**
 * Save persistent configuration to entity dynamic properties
 * @param {import("@minecraft/server").Entity} entity
 * @param {boolean} isActive
 * @param {number} outputMode
 * @param {number} rodTier
 * @param {string} [ownerId]
 */
function saveNPCConfig(entity, isActive, outputMode, rodTier, ownerId) {
  try {
    entity.setDynamicProperty("is_active", isActive);
    entity.setDynamicProperty("output_mode", outputMode);
    entity.setDynamicProperty("rod_tier", rodTier);
    if (ownerId !== undefined) {
      entity.setDynamicProperty("owner_id", ownerId);
    }
  } catch (err) {
    console.warn(`[AutoFisher] Failed to save NPC config: ${err}`);
  }
}

/**
 * Roll fishing loot according to selected rod tier
 * @param {number} rodTierIndex
 * @returns {ItemStack}
 */
function rollFishingLoot(rodTierIndex) {
  const tier = ROD_TIERS[rodTierIndex] || ROD_TIERS[0];
  const weights = tier.weights;
  const totalCatWeight = weights.fish + weights.junk + weights.treasure;

  let roll = Math.random() * totalCatWeight;
  let categoryKey = "fish";

  if (roll < weights.treasure) {
    categoryKey = "treasure";
  } else if (roll < weights.treasure + weights.junk) {
    categoryKey = "junk";
  } else {
    categoryKey = "fish";
  }

  const entries = LOOT_ITEMS[categoryKey];
  const totalItemWeight = entries.reduce((acc, e) => acc + e.weight, 0);
  let itemRoll = Math.random() * totalItemWeight;
  let selected = entries[0];

  for (const entry of entries) {
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
 * Direction-aware water scan:
 * Inspects a 3x3 perimeter 1-2 blocks below eye level in the direction the NPC is facing
 * @param {import("@minecraft/server").Entity} entity
 * @returns {{x: number, y: number, z: number} | null}
 */
function findDirectionalWater(entity) {
  const dimension = entity.dimension;
  const loc = entity.location;

  // Derive forward direction vector
  let dirX = 0;
  let dirZ = 1;
  try {
    const view = entity.getViewDirection();
    const mag = Math.hypot(view.x, view.z);
    if (mag > 0.001) {
      dirX = view.x / mag;
      dirZ = view.z / mag;
    }
  } catch {}

  // Center the 3x3 scan 1.5 blocks in the facing direction
  const scanCenterX = Math.floor(loc.x + dirX * 1.5);
  const scanCenterZ = Math.floor(loc.z + dirZ * 1.5);
  const baseBlockY = Math.floor(loc.y);

  let closestWater = null;
  let minDistanceSq = Infinity;

  // Scan 3x3 perimeter horizontally, and vertical levels -1 to 0 (1-2 blocks below eye level)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 0; dy++) {
        const checkPos = {
          x: scanCenterX + dx,
          y: baseBlockY + dy,
          z: scanCenterZ + dz,
        };

        try {
          const block = dimension.getBlock(checkPos);
          if (!block) continue;

          const isWater =
            block.typeId === "minecraft:water" ||
            block.typeId === "minecraft:flowing_water" ||
            block.isWaterlogged;

          if (isWater) {
            const dX = checkPos.x + 0.5 - loc.x;
            const dY = checkPos.y + 0.5 - loc.y;
            const dZ = checkPos.z + 0.5 - loc.z;
            const distSq = dX * dX + dY * dY + dZ * dZ;

            if (distSq < minDistanceSq) {
              minDistanceSq = distSq;
              closestWater = checkPos;
            }
          }
        } catch {}
      }
    }
  }

  // Fallback: check immediate 3x3 around NPC feet if facing area has no water
  if (!closestWater) {
    const feetX = Math.floor(loc.x);
    const feetZ = Math.floor(loc.z);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 0; dy++) {
          if (dx === 0 && dz === 0 && dy === 0) continue;

          const checkPos = { x: feetX + dx, y: baseBlockY + dy, z: feetZ + dz };
          try {
            const block = dimension.getBlock(checkPos);
            if (
              block &&
              (block.typeId === "minecraft:water" ||
                block.typeId === "minecraft:flowing_water" ||
                block.isWaterlogged)
            ) {
              return checkPos;
            }
          } catch {}
        }
      }
    }
  }

  return closestWater;
}

/**
 * Route caught loot to appropriate target based on NPC output mode
 * @param {import("@minecraft/server").Entity} entity
 * @param {ItemStack} itemStack
 * @param {number} outputMode - 0 = Container, 1 = Ground, 2 = Player
 * @param {string} [ownerId]
 */
function routeLoot(entity, itemStack, outputMode, ownerId) {
  const dimension = entity.dimension;
  const loc = entity.location;
  const dropPos = { x: loc.x, y: loc.y + 0.3, z: loc.z };

  // Mode 1: Drop as world entity (for Hopper/Water Streams)
  if (outputMode === 1) {
    try {
      dimension.spawnItem(itemStack, dropPos);
    } catch (e) {
      console.warn(`[AutoFisher] Failed to drop loot: ${e}`);
    }
    return;
  }

  // Mode 2: Deposit to Interacting Player
  if (outputMode === 2 && ownerId) {
    let deposited = false;
    try {
      const player = dimension.getEntities({ type: "minecraft:player" }).find((p) => p.id === ownerId);
      if (player && player.isValid()) {
        const inv = player.getComponent("inventory");
        if (inv && inv.container) {
          const leftover = inv.container.addItem(itemStack);
          if (!leftover || leftover.amount === 0) {
            deposited = true;
          } else {
            // Drop leftover near player
            dimension.spawnItem(leftover, player.location);
            deposited = true;
          }
        }
      }
    } catch {}

    if (deposited) return;
    // If player offline or not found, fall through to Mode 0 (adjacent container or drop)
  }

  // Mode 0: Adjacent Container (Chest/Barrel)
  // Scans 1 block north, south, east, west, and down
  const basePos = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
  const scanOffsets = [
    { x: 0, y: 0, z: -1 }, // North
    { x: 0, y: 0, z: 1 },  // South
    { x: 1, y: 0, z: 0 },  // East
    { x: -1, y: 0, z: 0 }, // West
    { x: 0, y: -1, z: 0 }, // Down
    { x: 0, y: 1, z: 0 },  // Up
  ];

  let remaining = itemStack;

  for (const offset of scanOffsets) {
    if (!remaining || remaining.amount <= 0) break;

    const targetPos = {
      x: basePos.x + offset.x,
      y: basePos.y + offset.y,
      z: basePos.z + offset.z,
    };

    try {
      const block = dimension.getBlock(targetPos);
      if (!block) continue;

      const isContainer =
        CONTAINER_BLOCK_IDS.has(block.typeId) ||
        block.typeId.includes("chest") ||
        block.typeId.includes("barrel");

      const invComponent = block.getComponent("inventory") || block.getComponent("minecraft:inventory");

      if ((isContainer || invComponent) && invComponent?.container) {
        remaining = invComponent.container.addItem(remaining);
      }
    } catch {}
  }

  // If container is full or absent, cleanly fail over to dropping at NPC base
  if (remaining && remaining.amount > 0) {
    try {
      dimension.spawnItem(remaining, dropPos);
    } catch (err) {
      console.warn(`[AutoFisher] Failed to spawn fallback loot: ${err}`);
    }
  }
}

/**
 * Update client-side fishing state property and tag
 * @param {import("@minecraft/server").Entity} entity
 * @param {boolean} isFishing
 */
function setEntityFishingState(entity, isFishing) {
  try {
    entity.setProperty(CONFIG.PROPERTY_IS_FISHING, isFishing);
  } catch {}

  try {
    if (isFishing) {
      if (!entity.hasTag(CONFIG.TAG_FISHING)) entity.addTag(CONFIG.TAG_FISHING);
    } else {
      if (entity.hasTag(CONFIG.TAG_FISHING)) entity.removeTag(CONFIG.TAG_FISHING);
    }
  } catch {}
}

/**
 * Perform cast sequence
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 * @param {number} rodTierIndex
 */
function handleCasting(entity, session, rodTierIndex) {
  const dimension = entity.dimension;
  const targetWater = session.targetWater;

  setEntityFishingState(entity, true);

  if (targetWater) {
    const splashPos = {
      x: targetWater.x + 0.5,
      y: targetWater.y + 0.85,
      z: targetWater.z + 0.5,
    };
    try {
      dimension.playSound("random.splash", splashPos, { volume: 0.8, pitch: 1.0 });
      dimension.spawnParticle("minecraft:water_splash_particle", splashPos);
    } catch {}
  }

  const tier = ROD_TIERS[rodTierIndex] || ROD_TIERS[0];
  const waitTicks = Math.floor(Math.random() * (tier.maxTicks - tier.minTicks + 1)) + tier.minTicks;

  session.state = "WAITING";
  session.waitTicksRemaining = waitTicks;
  session.totalWaitTicks = waitTicks;
  session.biteNotified = false;
}

/**
 * Perform reeling sequence and distribute loot
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 * @param {number} rodTierIndex
 * @param {number} outputMode
 * @param {string} [ownerId]
 */
function handleReeling(entity, session, rodTierIndex, outputMode, ownerId) {
  const dimension = entity.dimension;
  const targetWater = session.targetWater;

  if (targetWater) {
    const splashPos = {
      x: targetWater.x + 0.5,
      y: targetWater.y + 0.85,
      z: targetWater.z + 0.5,
    };
    try {
      dimension.playSound("random.bowhit", entity.location, { volume: 1.0, pitch: 1.2 });
      dimension.playSound("random.splash", splashPos, { volume: 1.0, pitch: 1.2 });
      dimension.spawnParticle("minecraft:water_splash_particle", splashPos);
      dimension.spawnParticle("minecraft:water_wake_particle", splashPos);
    } catch {}
  }

  try {
    entity.triggerEvent("custom:catch_fish");
  } catch {}

  const loot = rollFishingLoot(rodTierIndex);
  routeLoot(entity, loot, outputMode, ownerId);

  session.state = "COOLDOWN";
  session.cooldownTicksRemaining = 30; // 1.5 second pause before re-casting
}

/**
 * Tick evaluation for an active Fisherman entity
 * @param {import("@minecraft/server").Entity} entity
 */
function updateFisherman(entity) {
  if (!entity.isValid()) {
    activeSessions.delete(entity.id);
    return;
  }

  const config = getNPCConfig(entity);

  let session = activeSessions.get(entity.id);
  if (!session) {
    session = {
      state: "IDLE",
      targetWater: null,
      waitTicksRemaining: 0,
      totalWaitTicks: 0,
      cooldownTicksRemaining: 0,
      biteNotified: false,
    };
    activeSessions.set(entity.id, session);
  }

  // If status is Paused via UI, suspend loop cleanly
  if (!config.isActive) {
    if (session.state !== "IDLE") {
      setEntityFishingState(entity, false);
      session.state = "IDLE";
      session.targetWater = null;
    }
    return;
  }

  // Check directional water in front of NPC
  const waterPos = findDirectionalWater(entity);

  if (!waterPos) {
    // No water detected: log idle state, set client state to idle, spawn confusion particles
    if (session.state !== "IDLE") {
      setEntityFishingState(entity, false);
      session.state = "IDLE";
      session.targetWater = null;
    }

    // Spawn ambient confusion particles above head
    try {
      entity.dimension.spawnParticle("minecraft:villager_angry", {
        x: entity.location.x,
        y: entity.location.y + 1.9,
        z: entity.location.z,
      });
    } catch {}
    return;
  }

  session.targetWater = waterPos;

  switch (session.state) {
    case "IDLE":
      handleCasting(entity, session, config.rodTier);
      break;

    case "WAITING":
      session.waitTicksRemaining -= CONFIG.POLL_INTERVAL_TICKS;

      // Mid-cycle / bite notification: trigger splash particle and splash sound emulating fish biting
      if (!session.biteNotified && session.waitTicksRemaining <= 40) {
        session.biteNotified = true;
        if (session.targetWater) {
          const bitePos = {
            x: session.targetWater.x + 0.5,
            y: session.targetWater.y + 0.85,
            z: session.targetWater.z + 0.5,
          };
          try {
            entity.dimension.playSound("random.splash", bitePos, { volume: 0.9, pitch: 1.1 });
            entity.dimension.spawnParticle("minecraft:water_splash_particle", bitePos);
            entity.dimension.spawnParticle("minecraft:water_wake_particle", bitePos);
          } catch {}
        }
      } else if (session.waitTicksRemaining > 40 && session.waitTicksRemaining % 40 === 0) {
        // Subtle ambient water wake while waiting
        if (session.targetWater) {
          try {
            entity.dimension.spawnParticle("minecraft:water_wake_particle", {
              x: session.targetWater.x + 0.5,
              y: session.targetWater.y + 0.85,
              z: session.targetWater.z + 0.5,
            });
          } catch {}
        }
      }

      if (session.waitTicksRemaining <= 0) {
        session.state = "REELING";
        handleReeling(entity, session, config.rodTier, config.outputMode, config.ownerId);
      }
      break;

    case "COOLDOWN":
      session.cooldownTicksRemaining -= CONFIG.POLL_INTERVAL_TICKS;
      if (session.cooldownTicksRemaining <= 0) {
        handleCasting(entity, session, config.rodTier);
      }
      break;
  }
}

/**
 * Open ModalFormData configuration dialog for player
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} npc
 */
function openFishermanConfigUI(player, npc) {
  if (!npc.isValid() || !player.isValid()) return;

  const currentConfig = getNPCConfig(npc);

  const form = new ModalFormData()
    .title("Fisherman Configuration")
    .toggle("Status (Active / Paused)", currentConfig.isActive)
    .dropdown(
      "Output Mode",
      [
        "Adjacent Container (Chest/Barrel)",
        "Drop as World Entity (Hopper/Stream)",
        "Deposit to Interacting Player",
      ],
      currentConfig.outputMode
    )
    .dropdown(
      "Rod Enchantment Tier",
      [
        "Standard Rod (Vanilla rates, 15-25s)",
        "Lure III Tier (Fast catch, 8-12s)",
        "Luck of the Sea III Tier (High Treasure, 15-25s)",
      ],
      currentConfig.rodTier
    )
    .toggle("Recall Entity (Return Egg to Inventory)", false);

  form.show(player).then((response) => {
    if (response.canceled || !response.formValues) return;
    if (!npc.isValid() || !player.isValid()) return;

    const [newStatus, newOutputMode, newRodTier, recall] = response.formValues;

    // Handle Recall Entity
    if (recall) {
      try {
        const eggStack = new ItemStack(CONFIG.SPAWN_EGG_IDENTIFIER, 1);
        const inv = player.getComponent("inventory");
        let added = false;
        if (inv && inv.container) {
          const leftover = inv.container.addItem(eggStack);
          if (!leftover || leftover.amount === 0) {
            added = true;
          }
        }
        if (!added) {
          player.dimension.spawnItem(eggStack, player.location);
        }

        player.dimension.playSound("random.pop", npc.location, { volume: 1.0, pitch: 1.2 });
        player.dimension.spawnParticle("minecraft:villager_happy", {
          x: npc.location.x,
          y: npc.location.y + 1.0,
          z: npc.location.z,
        });

        activeSessions.delete(npc.id);
        npc.remove();

        player.onScreenDisplay?.setActionBar("§e[Fisherman] Recalled into your inventory.");
      } catch (err) {
        console.warn(`[AutoFisher] Error recalling NPC: ${err}`);
      }
      return;
    }

    // Save updated settings
    saveNPCConfig(npc, Boolean(newStatus), Number(newOutputMode), Number(newRodTier), player.id);

    // Refresh in-memory session if status was toggled
    const session = activeSessions.get(npc.id);
    if (session && !newStatus) {
      setEntityFishingState(npc, false);
      session.state = "IDLE";
    }

    player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 1.2 });
    player.onScreenDisplay?.setActionBar("§a[Fisherman] Configuration saved successfully!");
  });
}

/**
 * Check if player has empty hand
 * @param {import("@minecraft/server").Player} player
 */
function isPlayerHandEmpty(player) {
  try {
    const equip = player.getComponent("equippable");
    if (equip) {
      const item = equip.getEquipment("Mainhand");
      if (item && item.typeId && item.typeId !== "minecraft:air") {
        return false;
      }
    }
  } catch {}

  try {
    const inv = player.getComponent("inventory");
    if (inv && inv.container) {
      const item = inv.container.getItem(player.selectedSlotIndex);
      if (item && item.typeId && item.typeId !== "minecraft:air") {
        return false;
      }
    }
  } catch {}

  return true;
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------

// 1. Placement via custom:fisherman_spawn_egg
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

    try {
      const npc = dimension.spawnEntity(CONFIG.NPC_IDENTIFIER, spawnPos);

      // Face away from placing player
      const pLoc = player.location;
      const dx = spawnPos.x - pLoc.x;
      const dz = spawnPos.z - pLoc.z;
      const yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
      npc.setRotation({ x: 0, y: yaw });

      // Initialize persistent defaults
      saveNPCConfig(npc, true, 0, 0, player.id);

      dimension.playSound("random.pop", spawnPos, { volume: 1.0, pitch: 1.0 });
      dimension.spawnParticle("minecraft:villager_happy", {
        x: spawnPos.x,
        y: spawnPos.y + 1.0,
        z: spawnPos.z,
      });

      // Deduct spawn egg if in Survival mode
      const isCreative = player.getGameMode?.() === "creative";
      if (!isCreative) {
        const inv = player.getComponent("inventory");
        if (inv && inv.container) {
          const slot = player.selectedSlotIndex;
          const currentItem = inv.container.getItem(slot);
          if (currentItem && currentItem.amount > 1) {
            currentItem.amount -= 1;
            inv.container.setItem(slot, currentItem);
          } else {
            inv.container.setItem(slot, undefined);
          }
        }
      }
    } catch (err) {
      console.warn(`[AutoFisher] Failed to spawn fisherman NPC: ${err}`);
    }
  });
});

// 2. Interaction & Configuration UI
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { target: npc, player } = event;
  if (!npc || npc.typeId !== CONFIG.NPC_IDENTIFIER) return;

  // Intercept when player interacts with an empty hand
  if (isPlayerHandEmpty(player)) {
    event.cancel = true;

    system.run(() => {
      openFishermanConfigUI(player, npc);
    });
  }
});

// 3. Execution Loop (every 20 ticks / 1 second)
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
          console.warn(`[AutoFisher] Error updating NPC ${entity.id}: ${err}`);
        }
      }
    } catch {}
  }

  // Cleanup sessions for unloaded or destroyed entities
  for (const [entityId] of activeSessions) {
    let exists = false;
    for (const dimName of dimensions) {
      try {
        const dimension = world.getDimension(dimName);
        if (dimension && dimension.getEntity(entityId)) {
          exists = true;
          break;
        }
      } catch {}
    }
    if (!exists) {
      activeSessions.delete(entityId);
    }
  }
}, CONFIG.POLL_INTERVAL_TICKS);

console.info("[AutoFisher] Auto-Fisherman NPC (Hybrid UI Edition) initialized successfully.");
