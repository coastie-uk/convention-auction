# PowerPoint (pptxgenjs) template editing guide (server operator)

This project generates:

- An **auction slide deck** (`/generate-pptx`) using `pptxConfig.json`
- **Item cards** (`/generate-cards`) using `cardConfig.json`

Both configs are plain JSON and are loaded fresh on each generation request (no server restart required).

---

## Where the live config files live

The backend reads the config directory from `config.json`:

- `PPTX_CONFIG_DIR` (default: `/var/lib/auction`)

Live files in that directory:

- `pptxConfig.json` (auction slides)
- `cardConfig.json` (item cards)

If the files are missing, they are auto-created from:

- `default.pptxConfig.json`
- `default.cardConfig.json`

---

## How to edit

Use the Maintenance UI.
When saving, the server validates image paths in the JSON (they must exist on disk and be real images).

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

