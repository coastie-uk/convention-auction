# PowerPoint (pptxgenjs) template editing guide (server operator)

This project generates:

- An **auction slide deck** (`/generate-pptx`) using `pptxConfig.json`
- **Item cards** (`/generate-cards`) using `cardConfig.json`

Both configs are plain JSON and are loaded fresh on each generation request (no server restart required).

---

## Where the live config files live

The backend reads the config directory from `backend/config.json`:

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

For the auction slide deck, `backend/backend.js` uses `pptxConfig.json.slide.elements` to define all slide content.

Each element is rendered in order and is either:

- a text element (`slide.addText(...)`)
- an image element (`slide.addImage(...)`)

### 1) Text elements

Text element shape:

- `type`: `"text"`
- `text`: a string (supports placeholders like `{{item.description}}`)
- `style`: a **pptxgenjs text options** object

Useful `style` keys:

- `x`, `y` (position)
- `w`, `h` (text box size)
- `fontSize`
- `fontFace`, `color`, `bold`, `italic` (optional)
- `wrap`, `isTextBox`, `fit` (often used to keep long text readable)

Notes on units:

- Numbers are in **inches**.
- Strings like `"55%"` are **percent of the slide width/height** (pptxgenjs supports both).

Optional text element keys:

- `enabled`: set `false` to disable an element without deleting it
- `skipIfEmpty`: if true, omits the element when the rendered `text` is empty

### 2) Image elements

Image element shape:

- `type`: `"image"`
- `src`: a string path (supports placeholders like `{{imgPath}}`)
- `style`: a **pptxgenjs image options** object (typically includes `x`, `y` and either `w` or `h`)
- `lockAspectRatio`: defaults to `true` (if only one of `w`/`h` is set, the other is computed from the image file)
- `sizing`: optional, passed through to `addImage` as `sizing`

Common patterns:

- Use `\"src\": \"{{imgPath}}\"` to show the current item's uploaded photo (if present).
- Use an absolute path under `/var/lib/auction/resources` to place a static image on every slide via the template.

Note: if `src` renders to an empty string or a missing file, the image is skipped.

### 3) Available placeholders

These placeholders are currently available in `text` and `src`:

- `{{item.item_number}}`
- `{{item.description}}`
- `{{item.contributor}}`
- `{{item.artist}}`
- `{{itemsCount}}` (total items in the auction)
- `{{imgPath}}` (absolute file path to the item's uploaded image in `UPLOAD_DIR`, or empty)

### 4) Backwards compatibility

If `slide.elements` is missing, the generator falls back to the older fields (`idStyle`, `descriptionStyle`, `contributorStyle`, `artistStyle`, `imageWidth`, `imageX`, `imageY`, `sizing`).

---

## Master slide editing

Both configs can include a `masterSlide` object, which is passed directly to `pptx.defineSlideMaster(...)`.

Recommended requirements:

- In `pptxConfig.json`, keep `slide.masterName` equal to `masterSlide.title` (default: `AUCTION_MASTER`).
- In `cardConfig.json`, `masterSlide.title` must remain `CARD_MASTER` (hard-coded in the card generator).

You can use the master slide to add static elements like:

- Background color
- Banner image
- Logo
- Shapes / lines
- Watermarks / “template” text

### Referencing images on disk

Images can use relative or absolute paths, but must reside in the resources folder.

The default `CONFIG_IMG_DIR` is `/var/lib/auction/resources` (see `backend/config.json`). Upload new assets there (via “manage resources” in Maintenance) and then reference them in the JSON.

---

## Quick troubleshooting

- If generation fails after an edit: reset to defaults via Maintenance (“reset template”) or `POST /maintenance/pptx-config/reset`.
- If an image path won’t save: ensure the file exists in `CONFIG_IMG_DIR` and is one of the allowed extensions (see `backend/config.json` → `allowedExtensions`).
- If text overflows: increase `w`/`h`, reduce `fontSize`, and/or use `wrap: true` + `fit: "shrink"`.
