# Auto-Fisherman NPC Addon (v1.4.0)

**Author:** kurofy  
**Target Engine:** Minecraft Bedrock Edition (1.21.x+)  
**Dependencies:** `@minecraft/server` (1.13.0+), `@minecraft/server-ui` (1.3.0+)

---

## 🛠️ How It Works

### 1. Crafting & Deployment
* **Crafting Recipe (Crafting Table):**
  - `1 Armor Stand` (`minecraft:armor_stand`)
  - `1 Raw Cod` (`minecraft:cod`)
  ➔ Yields **`custom:fisherman_spawn_egg`**
* **Spawning (Water Detection):**
  - Right-click/tap any block with the spawn egg to place the stationary Fisherman NPC.
  - **Constraint:** Checks for water in front or within 2 blocks of the placement spot.
  - The NPC has the floating golden name tag **`§6FISHERMAN`**.

### 2. Dual Giving System & 3D Held Rod (Attachables)
* When spawned without a rod, the NPC is **`🔴 INACTIVE`** and displays a relaxed idle animation with empty hands.
* **Option 1 (From Inventory Button)**: Open the Control Panel UI by clicking/tapping the NPC with any item or empty hand. Click **"🎣 Give Fishing Rod (From Inventory)"**; it automatically takes 1 rod directly from your inventory.
* **Option 2 (Drop Rod on NPC)**: Simply drop (throw) a Fishing Rod item near or on the NPC. The NPC automatically detects it, picks it up, equips it, and becomes **`🟢 ACTIVE`**!
* **3D Held Rod**: The equipped Minecraft Fishing Rod renders directly in the NPC's hand using Bedrock attachables (`rightItem`).

### 3. Experience (EXP) Collection System
* Every time the NPC catches a fish, it collects **1 to 6 EXP points**.
* Players can harvest accumulated EXP at any time via the **"✨ Collect Stored EXP"** button in the Control Panel UI.
* Stored EXP is safely refunded to the player if the NPC is deleted or recalled.

### 4. Fishing & Item Drops
* **Forward & Surrounding Water Scan:** The NPC detects nearby water and casts into it.
* **Authentic Fishing Cycle:**
  - Casts the line forward with water splash particles and sound effects.
  - Spawns periodic water wake bubble particles while waiting (5–10s cycle).
  - Reeling audio (`random.bowhit`) and splash wake trigger upon catching fish.
* **Output:** Caught items (fish, junk, treasure) drop **directly below the NPC's feet** like a regular player, allowing easy collection via hoppers or water streams.

### 5. Control Panel UI (v1.4.0)
Right-click or tap the Fisherman NPC with **any item or empty hand** to open the control panel:
* **Resume / Pause Fishing:** Instantly toggle fishing on or off.
* **Give / Take Back Fishing Rod:** Equip from inventory or retrieve your fishing rod at any time.
* **Collect Stored EXP:** Harvest accumulated experience points.
* **Delete Fisherman NPC:** Despawns the NPC and safely refunds the spawn egg (+ rod + stored EXP) to your inventory.
* **Survival Punch-to-Break:** Sneak-attacking the NPC also cleanly breaks it and drops its items.

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

## 🚀 Installation & Play

1. **One-Click Package:** Double-click [`AutoFishermanNPC.mcaddon`](file:///d:/tes/autofish%20addon/AutoFishermanNPC.mcaddon) to import both packs into Minecraft Bedrock.
2. **World Settings:**
   - In **Resource Packs**, activate **Auto-Fisherman NPC (RP)**.
   - In **Behavior Packs**, activate **Auto-Fisherman NPC (BP)**.
   - In **Experiments**, toggle **Beta APIs** to **ON**.
