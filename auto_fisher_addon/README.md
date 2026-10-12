# Auto-Fisherman NPC Addon (Hybrid Built-in Rod & UI Edition)

**Author:** kurofy  
**Target Engine:** Minecraft Bedrock Edition (1.21.x+)  
**Dependencies:** `@minecraft/server` (1.13.0+), `@minecraft/server-ui` (1.3.0+)

A production-ready Minecraft Bedrock Addon featuring an autonomous Fisherman NPC with survival crafting, modal interaction UI (`@minecraft/server-ui`), rod enchantment tier simulation, direction-aware water detection, and flexible inventory offloading.

---

## 🛠️ System Architecture & Workflow

### 1. Survival Crafting & Deployment
* **Crafting Recipe (Crafting Table):**
  - `1 Armor Stand` (`minecraft:armor_stand`)
  - `1 Fishing Rod` (`minecraft:fishing_rod`)
  - `1 Raw Cod` (`minecraft:cod`)
  ➔ Yields **`custom:fisherman_spawn_egg`**
* **Deployment:**
  - Right-click/tap any block with the spawn egg to place the stationary NPC facing forward.
  - In Survival mode, 1 spawn egg is consumed. In Creative mode, the egg is preserved.
  - Can also be summoned via command: `/summon custom:fisherman_npc ~ ~ ~`.
  - The NPC is immune to push physics (`minecraft:pushable` disabled) and holds an integrated 3D fishing rod model.

### 2. Interaction & Configuration UI (`@minecraft/server-ui`)
* Right-click/interact with the NPC with an **empty hand** to open the `ModalFormData` dialog:
  - **Status Toggle:** `[Active / Paused]` to start or suspend the fishing cycle.
  - **Output Mode Dropdown:**
    1. *Adjacent Container (Chest/Barrel)*: Automatically scans north, south, east, west, and down for container blocks (`minecraft:chest`, `minecraft:barrel`, etc.) and inserts items into free slots. Fails over to dropping on the ground if full or absent.
    2. *Drop as World Entity (for Hopper/Water Streams)*: Drops items directly at the NPC's base.
    3. *Deposit to Interacting Player*: Automatically deposits caught items into the player's personal inventory if nearby and online.
  - **Rod Enchantment Simulation Dropdown:**
    - *Standard Rod*: Vanilla catch rates (85% fish, 10% junk, 5% treasure), 15–25s cycle.
    - *Lure III Tier*: Fast catch speed (8–12s cycle), standard loot distribution.
    - *Luck of the Sea III Tier*: High treasure probability (30% treasure, 65% fish, 5% junk), 15–25s cycle.
  - **Recall Entity Toggle:** Despawns the NPC and returns the `custom:fisherman_spawn_egg` to the player's inventory (or drops at feet if full).

### 3. Directional Water Detection & Execution Loop
* **Tick Polling:** Evaluated every 20 ticks (1 second) via `system.runInterval`.
* **Directional Scan:** Checks a 3×3 perimeter 1–2 blocks below eye level in the direction the NPC is facing.
* **Ambient Feedback:**
  - If no water is found, the NPC pauses, enters the idle pose, and emits confusion particles (`minecraft:villager_angry`) above its head.
  - When water is found, the NPC casts the rod, emitting water splash particles and `random.splash` sound effects.
  - Mid-cycle before a catch, splash particles and sounds simulate fish biting the bobber.
  - On catch, reeling sounds (`random.bowhit`) and splash wake particles trigger before offloading loot.

---

## 📁 File Structure

```text
auto_fisher_addon/
├── BP/
│   ├── manifest.json
│   ├── pack_icon.png
│   ├── entities/
│   │   └── fisherman_npc.json
│   ├── items/
│   │   └── fisherman_spawn_egg.json
│   ├── recipes/
│   │   └── fisherman_spawn_egg.json
│   ├── loot_tables/
│   │   └── gameplay/
│   │       └── custom_fishing.json
│   └── scripts/
│       └── main.js
└── RP/
    ├── manifest.json
    ├── pack_icon.png
    ├── entity/
    │   └── fisherman_npc.entity.json
    ├── models/entity/
    │   └── fisherman_npc.geo.json
    ├── animations/
    │   └── fisherman_npc.animation.json
    ├── animation_controllers/
    │   └── fisherman_npc.animation_controllers.json
    ├── texts/
    │   └── en_US.lang
    └── textures/
        ├── entity/
        │   └── fisherman_npc.png
        ├── items/
        │   └── fisherman_spawn_egg.png
        └── item_texture.json
```

---

## 🚀 Installation & Setup

1. **One-Click Package:** Double-click [`AutoFishermanNPC.mcaddon`](file:///d:/tes/autofish%20addon/AutoFishermanNPC.mcaddon) to import into Minecraft Bedrock.
2. **World Settings:**
   - In **Resource Packs**, activate **Auto-Fisherman NPC (RP)**.
   - In **Behavior Packs**, activate **Auto-Fisherman NPC (BP)**.
   - In **Experiments**, toggle **Beta APIs** to **ON**.
