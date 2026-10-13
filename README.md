# Auto-Fisherman NPC Addon (v1.5.0)

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

### 2. Dual Giving System & 3D Held Fishing Rod
* When spawned without a rod, the NPC is **`🔴 INACTIVE`** and displays a relaxed idle animation with empty hands.
* **Option 1 (From Inventory Button)**: Open the Control Panel UI by clicking/tapping the NPC with any item or empty hand. Click **"🎣 Give Fishing Rod (From Inventory)"**; it automatically takes 1 rod directly from your inventory.
* **Option 2 (Drop Rod on NPC)**: Simply drop (throw) a Fishing Rod item near or on the NPC. The NPC automatically detects it, picks it up, equips it, and becomes **`🟢 ACTIVE`**!
* **3D Held Rod**: Renders a dedicated 3D wooden fishing rod with reel and guide ring right in the NPC's hand, toggled dynamically with the `custom:has_rod` property in render controllers.

### 3. Authentic Player-Like Fishing Mechanics (v1.5.0)
* **Casting:** The NPC raises its arms and casts the line forward into the water with landing splash sound and water splash particles.
* **Fishing Line & Bobber:** A particle fishing line connects the tip of the rod to the water bobber, which gently ripples the water while waiting.
* **Approaching Fish Wake:** Water wake bubble trails realistically rush across the water towards the bobber right before a bite.
* **Bite & Dynamic Reel Motion:** When the fish bites, the bobber splashes, reel audio plays, and the Fisherman plays the **`reel`** animation, jerking the rod into the air!
* **Physical Flying Loot:** Caught fish and treasure physically launch through the air from the water and fly directly towards the NPC's feet (using `applyImpulse`), landing on the ground just like vanilla player fishing.
* **Experience Collection:** Collects 1 to 6 EXP points per catch, harvestable via the UI.

### 4. Control Panel UI (v1.5.0)
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
