# Output template and item slip config editing guide (server operator)

This project generates:

- An **auction slide deck** (`/generate-pptx`) using `pptxConfig.json`
- **Item cards** (`/generate-cards`) using `cardConfig.json`
- A single-item **print slip PDF** (`/auctions/:auctionId/items/:id/print-slip`) using `slipConfig.json`

All configs are plain JSON and are loaded fresh on each generation request (no server restart required).

---

## Where the live config files live

The backend reads the config directory from `config.json`:

- `PPTX_CONFIG_DIR` (default: `/var/lib/auction`)

Live files in that directory:

- `pptxConfig.json` (auction slides)
- `cardConfig.json` (item cards)
- `slipConfig.json` (item slip PDF)

If the files are missing, they are auto-created from:

- `default.pptxConfig.json`
- `default.cardConfig.json`
- `default.slipConfig.json`

---

## How to edit

Use the Maintenance UI.
In the config editor, select **Slide Config**, **Card Config**, or **Item Slip Config**.
When saving, the server validates image paths in the JSON (they must exist on disk and be real images).

For slip config saves, the server validates against the slip schema/validator and returns structured path errors for invalid fields.

---

## What you can safely change for auction slides

For the auction slide deck, `backend/backend.js` uses only these fields from `pptxConfig.json`:

### 1) The four text styles (passed directly to `slide.addText`)

These control the layout for the only four text lines added by the generator:

- Item number: `idStyle`
- Description: `descriptionStyle`
- Contributor: `contributorStyle`
- Creator: `artistStyle`

Each style object is a **pptxgenjs text options** object. The most useful keys are:

- `x`, `y` (position)
- `w`, `h` (text box size)
- `fontSize`
- `fontFace`, `color`, `bold`, `italic` (optional)
- `wrap`, `isTextBox`, `fit` (often used to keep long text readable)

Notes on units:

- Numbers are in **inches**.
- Strings like `"55%"` are **percent of the slide width/height** (pptxgenjs supports both).

### 2) Auction item image placement

If an item has a photo, the backend adds it with:

- `imageWidth`: displayed width (inches)
- `imageX`, `imageY`: top-left position (inches)
- `sizing`: optional (`type` defaults to `"contain"`); `w`/`h` define the sizing box

Important behavior:

- Height is computed from the photo’s aspect ratio, using `imageWidth`, so very wide `imageWidth` values can push the image off the bottom of the slide.

---

## Master slide editing

Both configs include a `masterSlide` object. Critical requirement:

- In `pptxConfig.json`, `masterSlide.title` must remain `AUCTION_MASTER`
- In `cardConfig.json`, `masterSlide.title` must remain `CARD_MASTER`

Those names are hard-coded in the generator when adding slides.

You can use the master slide to add static elements like:

- Background color
- Banner image
- Logo
- Shapes / lines
- Watermarks / “template” text

### Referencing images on disk

Images can use relative or absolute paths, but must reside in the resources folder

The default `CONFIG_IMG_DIR` is `/var/lib/auction/resources` (see `backend/config.json`). Upload new assets there (via “manage resources” in Maintenance) and then reference them in the JSON.

---

## Quick troubleshooting

- If generation fails after an edit: reset to defaults via Maintenance (“reset template”) or `POST /maintenance/pptx-config/reset`.
- If an image path won’t save: ensure the file exists in `CONFIG_IMG_DIR` and is one of the allowed extensions (see `backend/config.json` → `allowedExtensions`).
- If text overflows: increase `w`/`h`, reduce `fontSize`, and/or use `wrap: true` + `fit: "shrink"`.

---

## Item slip schema editing (`slipConfig.json`)

The item slip renderer is text-only and is intended for thermal receipt printers (e.g. 80mm) or 6x4 label output.

Main schema blocks:

- `version`: integer schema version.
- `paper`: page format and orientation.
- `defaults`: default font/size/alignment.
- `fields`: ordered list of text fields to render.

### `paper`

Required keys:

- `format`: one of `receipt80`, `label6x4`, `custom`
- `orientation`: `portrait` or `landscape`

Optional size overrides:

- `widthMm`
- `heightMm`

If orientation is `landscape`, width/height are swapped by the renderer.

### `fields[]`

Each field controls one text block:

- `parameter`: one of:
  - `item_number`
  - `item_name` (maps to item description)
  - `description`
  - `creator`
  - `contributor`
  - `notes`
- `label`: static prefix text (optional), e.g. `"Item #: "`
- `xMm`, `yMm`: position in mm
- `maxWidthMm`: required text box width
- `maxHeightMm`: optional max text box height (`null` or omitted disables max height)
- `font`, `fontSizePt`, `align`, `lineGapPt`: text styling overrides
- `rotationDeg`: rotate text (useful for label layouts)
- `multiline`: whether wrapping is allowed
- `includeIfEmpty`: render the label even if the value is empty
- `truncate`: optional truncation control:
  - `enabled`: boolean
  - `maxChars`: positive integer
  - `ellipsis`: suffix (default `...`)


### Example template 1: 80mm paper, landscape (App default)

```json
{
  "version": 1,
  "paper": {
    "format": "receipt80",
    "orientation": "landscape",
    "widthMm": 72,
    "heightMm": 120
  },
  "defaults": {
    "font": "Helvetica",
    "fontSizePt": 12,
    "lineGapPt": 1,
    "align": "left"
  },
  "fields": [
    {
      "parameter": "item_number",
      "label": "Item: ",
      "xMm": 70,
      "yMm": 3,
      "maxWidthMm": 30,
      "fontSizePt": 20,
      "align": "right",
      "multiline": false,
      "truncate": {
        "enabled": false
      }
    },
    {
      "parameter": "item_name",
      "label": "",
      "xMm": 4,
      "yMm": 14,
      "maxWidthMm": 110,
      "fontSizePt": 18,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 80,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "creator",
      "label": "Creator: ",
      "xMm": 4,
      "yMm": 40,
      "maxWidthMm": 110,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 70,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "contributor",
      "label": "Contributor: ",
      "xMm": 4,
      "yMm": 50,
      "maxWidthMm": 110,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 70,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "notes",
      "label": "Notes: ",
      "xMm": 4,
      "yMm": 60,
      "maxWidthMm": 110,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 120,
        "ellipsis": "..."
      }
    }
  ]
}

```

### Example template 2: 80mm paper, portrait

Use this when printing to an 80mm receipt printer in portrait orientation.

```json
{
  "version": 1,
  "paper": {
    "format": "receipt80",
    "orientation": "portrait",
    "widthMm": 72,
    "heightMm": 100
  },
  "defaults": {
    "font": "Helvetica",
    "fontSizePt": 12,
    "lineGapPt": 1,
    "align": "left"
  },
  "fields": [
    {
      "parameter": "item_number",
      "label": "Item: ",
      "xMm": 44,
      "yMm": 3,
      "maxWidthMm": 32,
      "fontSizePt": 17,
      "align": "right",
      "multiline": false,
      "truncate": {
        "enabled": false
      }
    },
    {
      "parameter": "item_name",
      "label": "",
      "xMm": 4,
      "yMm": 14,
      "maxWidthMm": 72,
      "fontSizePt": 15,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 80,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "creator",
      "label": "Creator: ",
      "xMm": 4,
      "yMm": 37,
      "maxWidthMm": 72,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 70,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "contributor",
      "label": "Contributor: ",
      "xMm": 4,
      "yMm": 50,
      "maxWidthMm": 72,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 70,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "notes",
      "label": "Notes: ",
      "xMm": 4,
      "yMm": 63,
      "maxWidthMm": 72,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 120,
        "ellipsis": "..."
      }
    }
  ]
}
```



### Example template 3: 6x4 paper, landscape

Use this for 6x4 labels/cards in landscape orientation (effective area: 152.4mm wide × 101.6mm high).

```json
{
  "version": 1,
  "paper": {
    "format": "label6x4",
    "orientation": "landscape",
    "widthMm": 101.6,
    "heightMm": 152.4
  },
  "defaults": {
    "font": "Helvetica",
    "fontSizePt": 14,
    "lineGapPt": 1.5,
    "align": "left"
  },
  "fields": [
    {
      "parameter": "item_number",
      "label": "Item: ",
      "xMm": 116,
      "yMm": 4,
      "maxWidthMm": 32,
      "fontSizePt": 24,
      "align": "right",
      "multiline": false,
      "truncate": {
        "enabled": false
      }
    },
    {
      "parameter": "item_name",
      "label": "",
      "xMm": 6,
      "yMm": 8,
      "maxWidthMm": 140,
      "fontSizePt": 22,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 100,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "creator",
      "label": "Creator: ",
      "xMm": 6,
      "yMm": 36,
      "maxWidthMm": 140,
      "fontSizePt": 16,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 90,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "contributor",
      "label": "Contributor: ",
      "xMm": 6,
      "yMm": 52,
      "maxWidthMm": 140,
      "fontSizePt": 16,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 90,
        "ellipsis": "..."
      }
    },
    {
      "parameter": "notes",
      "label": "Notes: ",
      "xMm": 6,
      "yMm": 68,
      "maxWidthMm": 140,
      "fontSizePt": 14,
      "multiline": true,
      "truncate": {
        "enabled": true,
        "maxChars": 150,
        "ellipsis": "..."
      }
    }
  ]
}
```

Reference files:

- Default config: `backend/default.slipConfig.json`
- Schema definition: `backend/slip-config.schema.json`
- Runtime validation logic: `backend/slip-config.js`
