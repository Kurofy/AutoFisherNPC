import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

/**
 * Production-ready Auto-Fisherman NPC Script
 * Minecraft Bedrock Edition (1.21.x+)
 * Author: kurofy
 * 
 * Key Features:
 * - Placement requires water directly in front of the NPC
 * - Real Minecraft Fishing Rod held in hand (given by player)
 * - Name tag fixed to "§6FISHERMAN"
 * - Direction-aware forward water detection for casting
 * - Regular player item drops (drops directly below/at NPC base)
 * - Accessible control panel even when holding an item in hand
 * - Persistent On/Off status toggle via tags
 * - Delete NPC button and punch-to-break behavior
 * - Authentic splash sounds, bubble wake particles, and vanilla fishing loot
 */

const CONFIG = {
  POLL_INTERVAL_TICKS: 20, // 1 second
  NPC_IDENTIFIER: "custom:fisherman_npc",
  SPAWN_EGG_IDENTIFIER: "custom:fisherman_spawn_egg",
  ROD_IDENTIFIER: "minecraft:fishing_rod",
  NPC_NAME_TAG: "§6FISHERMAN",
  TAG_HAS_ROD: "has_rod",
  TAG_PAUSED: "fisher_paused",
  TAG_FISHING: "fishing",
  PROPERTY_IS_FISHING: "custom:is_fishing",
  MIN_WAIT_TICKS: 100, // 5 seconds
  MAX_WAIT_TICKS: 200, // 10 seconds
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
 * @property {string} state - "IDLE" | "WAITING" | "COOLDOWN"
 * @property {{x: number, y: number, z: number} | null} targetWater
 * @property {number} waitTicksRemaining
 * @property {number} cooldownTicksRemaining
 * @property {boolean} biteNotified
 */

/** @type {Map<string, SessionState>} */
const activeSessions = new Map();

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

  for (const dist of [1, 2]) {
    for (const side of [-0.6, 0, 0.6]) {
      const targetX = Math.floor(spawnPos.x + dirX * dist + perpX * side);
      const targetZ = Math.floor(spawnPos.z + dirZ * dist + perpZ * side);

      for (let dy = -2; dy <= 0; dy++) {
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
  return false;
}

/**
 * Find water block positioned directly in front of the NPC
 * @param {import("@minecraft/server").Entity} entity
 * @returns {{x: number, y: number, z: number} | null}
 */
function findWaterInFront(entity) {
  const dimension = entity.dimension;
  const loc = entity.location;

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

  const perpX = -dirZ;
  const perpZ = dirX;

  let closestWater = null;
  let minDistanceSq = Infinity;

  // Search forward cone (1 to 2.5 blocks in front, up to 1 block to sides, 0 to 2 blocks down)
  for (const dist of [1, 1.5, 2, 2.5]) {
    for (const side of [-1, -0.5, 0, 0.5, 1]) {
      const targetX = Math.floor(loc.x + dirX * dist + perpX * side);
      const targetZ = Math.floor(loc.z + dirZ * dist + perpZ * side);

      for (let dy = -2; dy <= 0; dy++) {
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

  return closestWater;
}

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
 * Set entity client-side fishing state
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
 * Start casting fishing line into target water
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 */
function startCasting(entity, session) {
  setEntityFishingState(entity, true);

  if (session.targetWater) {
    const splashPos = {
      x: session.targetWater.x + 0.5,
      y: session.targetWater.y + 0.85,
      z: session.targetWater.z + 0.5,
    };
    try {
      entity.dimension.playSound("random.splash", splashPos, { volume: 0.8, pitch: 1.0 });
      entity.dimension.spawnParticle("minecraft:water_splash_particle", splashPos);
    } catch {}
  }

  const waitTicks = Math.floor(
    Math.random() * (CONFIG.MAX_WAIT_TICKS - CONFIG.MIN_WAIT_TICKS + 1)
  ) + CONFIG.MIN_WAIT_TICKS;

  session.state = "WAITING";
  session.waitTicksRemaining = waitTicks;
  session.biteNotified = false;
}

/**
 * Complete reel-in and drop caught loot directly below NPC
 * @param {import("@minecraft/server").Entity} entity
 * @param {SessionState} session
 */
function completeReel(entity, session) {
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

  // Drop loot item directly below the NPC / at feet (like regular player)
  const loot = rollFishingLoot();
  const dropPos = {
    x: entity.location.x,
    y: entity.location.y + 0.1,
    z: entity.location.z,
  };

  try {
    dimension.spawnItem(loot, dropPos);
  } catch (err) {
    console.warn(`[AutoFisher] Failed to spawn caught item: ${err}`);
  }

  // Cooldown before next cast (20 ticks / 1 second)
  session.state = "COOLDOWN";
  session.cooldownTicksRemaining = 20;
}

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
      waitTicksRemaining: 0,
      cooldownTicksRemaining: 0,
      biteNotified: false,
    };
    activeSessions.set(entity.id, session);
  }

  // 1. Check if NPC has a Fishing Rod
  const hasRod = entity.hasTag(CONFIG.TAG_HAS_ROD);
  if (!hasRod) {
    if (session.state !== "IDLE") {
      setEntityFishingState(entity, false);
      session.state = "IDLE";
      session.targetWater = null;
    }
    return;
  }

  // 2. Check if NPC is paused via Status toggle
  const isPaused = entity.hasTag(CONFIG.TAG_PAUSED);
  if (isPaused) {
    if (session.state !== "IDLE") {
      setEntityFishingState(entity, false);
      session.state = "IDLE";
      session.targetWater = null;
    }
    return;
  }

  // 3. Scan for water directly in front of the NPC
  const waterPos = findWaterInFront(entity);
  if (!waterPos) {
    if (session.state !== "IDLE") {
      setEntityFishingState(entity, false);
      session.state = "IDLE";
      session.targetWater = null;
    }
    // Spawn ambient confusion particles when active but no water found in front
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

  // 4. State Machine execution
  switch (session.state) {
    case "IDLE":
      startCasting(entity, session);
      break;

    case "WAITING":
      session.waitTicksRemaining -= CONFIG.POLL_INTERVAL_TICKS;

      // Periodic water wake bubbles
      if (session.targetWater) {
        const wakePos = {
          x: session.targetWater.x + 0.5,
          y: session.targetWater.y + 0.85,
          z: session.targetWater.z + 0.5,
        };

        // Mid-cycle / bite alert near completion
        if (!session.biteNotified && session.waitTicksRemaining <= 30) {
          session.biteNotified = true;
          try {
            entity.dimension.playSound("random.splash", wakePos, { volume: 0.9, pitch: 1.1 });
            entity.dimension.spawnParticle("minecraft:water_splash_particle", wakePos);
          } catch {}
        } else {
          try {
            entity.dimension.spawnParticle("minecraft:water_wake_particle", wakePos);
          } catch {}
        }
      }

      if (session.waitTicksRemaining <= 0) {
        completeReel(entity, session);
      }
      break;

    case "COOLDOWN":
      session.cooldownTicksRemaining -= CONFIG.POLL_INTERVAL_TICKS;
      if (session.cooldownTicksRemaining <= 0) {
        startCasting(entity, session);
      }
      break;
  }
}

/**
 * Open Control Panel Dialog for player (safely works even while holding any item)
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} npc
 */
function openFishermanControlPanel(player, npc) {
  if (!npc.isValid() || !player.isValid()) return;

  const isPaused = npc.hasTag(CONFIG.TAG_PAUSED);
  const hasRod = npc.hasTag(CONFIG.TAG_HAS_ROD);

  const form = new ActionFormData()
    .title("§6FISHERMAN Control Panel")
    .body(
      `§7Manage this Fisherman NPC:\n\n` +
      `§f• Status: ${isPaused ? "§c🔴 PAUSED" : "§a🟢 ACTIVE"}\n` +
      `§f• Fishing Rod: ${hasRod ? "§aEquipped (Holding Rod)" : "§eNone (Give rod to fish)"}\n` +
      `§f• Output: §bDrops directly at feet\n`
    )
    .button(isPaused ? "▶ Resume Fishing (Set ACTIVE)" : "⏸ Pause Fishing (Set PAUSED)")
    .button(hasRod ? "🎣 Take Back Fishing Rod" : "🎣 Give Fishing Rod")
    .button("❌ Delete Fisherman NPC")
    .button("Close");

  const tryShow = (attempt = 0) => {
    if (!player.isValid() || !npc.isValid()) return;

    form.show(player).then((response) => {
      if (response.canceled) {
        // If canceled because player was busy (holding/using item), retry in 4 ticks
        if (response.cancelationReason === "UserBusy" && attempt < 3) {
          system.runTimeout(() => tryShow(attempt + 1), 4);
        }
        return;
      }

      if (response.selection === undefined) return;
      const action = response.selection;

      // Button 0: Toggle Status (Active / Paused)
      if (action === 0) {
        if (isPaused) {
          npc.removeTag(CONFIG.TAG_PAUSED);
          player.onScreenDisplay?.setActionBar("§a[Fisherman] Status set to ACTIVE!");
          player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 1.2 });
        } else {
          npc.addTag(CONFIG.TAG_PAUSED);
          setEntityFishingState(npc, false);
          const session = activeSessions.get(npc.id);
          if (session) session.state = "IDLE";
          player.onScreenDisplay?.setActionBar("§c[Fisherman] Status set to PAUSED!");
          player.dimension.playSound("random.orb", player.location, { volume: 0.8, pitch: 0.8 });
        }
        return;
      }

      // Button 1: Take Back or Give Rod
      if (action === 1) {
        if (hasRod) {
          // Take back rod
          npc.removeTag(CONFIG.TAG_HAS_ROD);
          setEntityFishingState(npc, false);
          const session = activeSessions.get(npc.id);
          if (session) session.state = "IDLE";

          // Unequip from NPC
          try {
            const equip = npc.getComponent("equippable");
            if (equip) equip.setEquipment("Mainhand", undefined);
          } catch {}

          // Return rod to player
          giveOrDropItem(player, new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
          player.dimension.playSound("random.pop", npc.location, { volume: 1.0, pitch: 1.0 });
          player.onScreenDisplay?.setActionBar("§e[Fisherman] Took back your Fishing Rod.");
        } else {
          // Give rod from inventory or hand directly
          if (playerHasFishingRod(player)) {
            giveRodToFisherman(player, npc, false);
          } else {
            player.onScreenDisplay?.setActionBar(
              "§c[Fisherman] You need a Fishing Rod in your inventory or hand!"
            );
          }
        }
        return;
      }

      // Button 2: Delete Fisherman NPC
      if (action === 2) {
        deleteFishermanNPC(npc, player);
        return;
      }
    }).catch(() => {});
  };

  tryShow();
}

/**
 * Safely delete fisherman NPC and return spawn egg + rod
 * @param {import("@minecraft/server").Entity} npc
 * @param {import("@minecraft/server").Player} [player]
 */
function deleteFishermanNPC(npc, player) {
  if (!npc.isValid()) return;

  const loc = npc.location;
  const dimension = npc.dimension;
  const hadRod = npc.hasTag(CONFIG.TAG_HAS_ROD);

  activeSessions.delete(npc.id);
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
 * Check if player hand is holding a fishing rod
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean}
 */
function isHoldingFishingRod(player) {
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
      const item = inv.container.getItem(player.selectedSlotIndex);
      if (item && item.typeId === CONFIG.ROD_IDENTIFIER) return true;
    }
  } catch {}
  return false;
}

/**
 * Give a fishing rod to the fisherman NPC
 * @param {import("@minecraft/server").Player} player
 * @param {import("@minecraft/server").Entity} npc
 * @param {boolean} [fromHandOnly=true]
 * @returns {boolean}
 */
function giveRodToFisherman(player, npc, fromHandOnly = true) {
  if (!npc.isValid() || !player.isValid()) return false;

  const isCreative = player.getGameMode?.() === "creative";
  let consumed = isCreative;

  if (!isCreative) {
    if (fromHandOnly) {
      consumeHandItem(player);
      consumed = true;
    } else {
      consumed = consumeFishingRodFromPlayer(player);
    }
  }

  if (!consumed) return false;

  // Equip Minecraft Fishing Rod on NPC mainhand
  try {
    const equip = npc.getComponent("equippable");
    if (equip) {
      equip.setEquipment("Mainhand", new ItemStack(CONFIG.ROD_IDENTIFIER, 1));
    }
  } catch (e) {
    console.warn(`[AutoFisher] Failed to set equipment: ${e}`);
  }

  npc.addTag(CONFIG.TAG_HAS_ROD);
  player.dimension.playSound("armor.equip_generic", npc.location, { volume: 1.0, pitch: 1.0 });
  player.dimension.spawnParticle("minecraft:villager_happy", {
    x: npc.location.x,
    y: npc.location.y + 1.2,
    z: npc.location.z,
  });

  player.onScreenDisplay?.setActionBar("§aYou gave a Fishing Rod to the Fisherman!");
  return true;
}

/**
 * Check if player has a fishing rod in hand or inventory
 * @param {import("@minecraft/server").Player} player
 * @returns {boolean}
 */
function playerHasFishingRod(player) {
  if (player.getGameMode?.() === "creative") return true;
  if (isHoldingFishingRod(player)) return true;
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
      // First check selected slot
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
      // Then check all slots
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

// 1. Placement via custom:fisherman_spawn_egg (Enforces water in front)
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

    // Calculate facing direction away from the player
    const pLoc = player.location;
    const dx = spawnPos.x - pLoc.x;
    const dz = spawnPos.z - pLoc.z;
    const mag = Math.hypot(dx, dz) || 1;
    const forwardDir = { x: dx / mag, z: dz / mag };

    // REQUIREMENT: Must have water directly in front of the placement spot!
    const waterDetected = hasWaterInFront(dimension, spawnPos, forwardDir);
    if (!waterDetected) {
      dimension.playSound("note.bass", player.location, { volume: 1.0, pitch: 0.8 });
      player.onScreenDisplay?.setActionBar(
        "§cCannot place: There must be water directly in front of the Fisherman!"
      );
      return;
    }

    try {
      const npc = dimension.spawnEntity(CONFIG.NPC_IDENTIFIER, spawnPos);
      npc.nameTag = CONFIG.NPC_NAME_TAG;

      // Orient facing the water in front
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
        "§aFisherman placed! Sneak + Hold Rod to give rod, or stand to configure."
      );
    } catch (err) {
      console.warn(`[AutoFisher] Failed to spawn fisherman: ${err}`);
    }
  });
});

// 2. Interaction handling (Sneak + Rod = Give Rod, Standing = Open Control Panel)
world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
  const { target: npc, player } = event;
  if (!npc || npc.typeId !== CONFIG.NPC_IDENTIFIER) return;

  event.cancel = true;

  system.run(() => {
    if (!npc.isValid() || !player.isValid()) return;

    const hasRod = npc.hasTag(CONFIG.TAG_HAS_ROD);
    const isSneaking = player.isSneaking;
    const holdingRod = isHoldingFishingRod(player);

    // Case A: Sneaking while holding a Fishing Rod -> Give Rod!
    if (isSneaking && holdingRod) {
      if (!hasRod) {
        giveRodToFisherman(player, npc, true);
      } else {
        player.onScreenDisplay?.setActionBar(
          "§e[Fisherman] Already holding a Fishing Rod! Stand up to open Control Panel."
        );
      }
      return;
    }

    // Case B: Standing normally (or clicking without sneak+rod) -> Open Control Panel!
    openFishermanControlPanel(player, npc);
  });
});

// 3. Melee hit handling (Sneak + Hit = break/retrieve, Standing Hit = protected)
world.afterEvents.entityHitEntity.subscribe((event) => {
  const { damagingEntity, hitEntity } = event;
  if (!hitEntity || hitEntity.typeId !== CONFIG.NPC_IDENTIFIER) return;
  if (!damagingEntity || damagingEntity.typeId !== "minecraft:player") return;

  const player = damagingEntity;
  const npc = hitEntity;

  if (player.isSneaking) {
    // Sneak + Hit: In case damage sensor didn't kill it (e.g., creative mode), safely delete and refund
    system.run(() => {
      if (npc.isValid()) {
        deleteFishermanNPC(npc, player);
      }
    });
  } else {
    // Normal hit while standing: NPC is immune, alert player with tip and clink sound
    try {
      player.dimension.playSound("armor.equip_generic", npc.location, { volume: 0.8, pitch: 1.5 });
    } catch {}
    player.onScreenDisplay?.setActionBar(
      "§eFisherman is protected! Sneak + Hit (Jongkok + Pukul) to pick up."
    );
  }
});

// 4. Entity Death (Refunds egg and rod on death via sneak-hit in survival or /kill)
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
  }
});

// 5. Master tick polling loop (runs every 20 ticks / 1 second)
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

  // Cleanup sessions for destroyed/unloaded entities
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

console.info("[AutoFisher] Auto-Fisherman NPC v1.3.2 initialized successfully.");
