/**
 * @file        slip-config.js
 * @description Validation and helpers for per-item slip PDF configuration.
 * @author      Chris Staples
 * @license     GPL3
 */

const PAPER_PRESETS_MM = Object.freeze({
  receipt80: Object.freeze({ widthMm: 80, heightMm: 120 }),
  label6x4: Object.freeze({ widthMm: 101.6, heightMm: 152.4 })
});

const PAPER_FORMATS = new Set(["receipt80", "label6x4", "custom"]);
const ORIENTATIONS = new Set(["portrait", "landscape"]);
const ALIGNMENTS = new Set(["left", "center", "right"]);

const PARAMETER_TO_ITEM_FIELD = Object.freeze({
  item_number: "item_number",
  item_name: "description",
  description: "description",
  creator: "artist",
  artist: "artist",
  contributor: "contributor",
  notes: "notes"
});

const SLIP_PARAMETER_KEYS = Object.freeze(Object.keys(PARAMETER_TO_ITEM_FIELD));

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushError(errors, jsonPath, error, value) {
  errors.push({
    jsonPath,
    error,
    value
  });
}

function normalizePaper(rawPaper, errors) {
  if (!isPlainObject(rawPaper)) {
    pushError(errors, "$.paper", "paper must be an object", rawPaper);
    return {
      format: "receipt80",
      orientation: "portrait",
      widthMm: PAPER_PRESETS_MM.receipt80.widthMm,
      heightMm: PAPER_PRESETS_MM.receipt80.heightMm
    };
  }

  const format = String(rawPaper.format || "").trim().toLowerCase();
  if (!PAPER_FORMATS.has(format)) {
    pushError(errors, "$.paper.format", "format must be receipt80, label6x4, or custom", rawPaper.format);
  }

  const normalizedFormat = PAPER_FORMATS.has(format) ? format : "receipt80";

  const orientation = String(rawPaper.orientation || "portrait").trim().toLowerCase();
  if (!ORIENTATIONS.has(orientation)) {
    pushError(errors, "$.paper.orientation", "orientation must be portrait or landscape", rawPaper.orientation);
  }

  const defaultSize = PAPER_PRESETS_MM[normalizedFormat] || PAPER_PRESETS_MM.receipt80;

  const widthMm = asNumber(rawPaper.widthMm ?? defaultSize.widthMm);
  const heightMm = asNumber(rawPaper.heightMm ?? defaultSize.heightMm);

  if (widthMm === null || widthMm <= 0) {
    pushError(errors, "$.paper.widthMm", "widthMm must be a positive number", rawPaper.widthMm);
  }
  if (heightMm === null || heightMm <= 0) {
    pushError(errors, "$.paper.heightMm", "heightMm must be a positive number", rawPaper.heightMm);
  }

  return {
    format: normalizedFormat,
    orientation: ORIENTATIONS.has(orientation) ? orientation : "portrait",
    widthMm: widthMm && widthMm > 0 ? widthMm : defaultSize.widthMm,
    heightMm: heightMm && heightMm > 0 ? heightMm : defaultSize.heightMm
  };
}

function normalizeDefaults(rawDefaults, errors) {
  if (rawDefaults !== undefined && !isPlainObject(rawDefaults)) {
    pushError(errors, "$.defaults", "defaults must be an object when provided", rawDefaults);
  }

  const defaults = isPlainObject(rawDefaults) ? rawDefaults : {};

  const font = typeof defaults.font === "string" && defaults.font.trim() !== ""
    ? defaults.font.trim()
    : "Helvetica";

  const fontSizePt = asNumber(defaults.fontSizePt ?? 11);
  if (fontSizePt === null || fontSizePt <= 0) {
    pushError(errors, "$.defaults.fontSizePt", "fontSizePt must be a positive number", defaults.fontSizePt);
  }

  const lineGapPt = asNumber(defaults.lineGapPt ?? 0);
  if (lineGapPt === null || lineGapPt < 0) {
    pushError(errors, "$.defaults.lineGapPt", "lineGapPt must be zero or a positive number", defaults.lineGapPt);
  }

  const align = String(defaults.align || "left").trim().toLowerCase();
  if (!ALIGNMENTS.has(align)) {
    pushError(errors, "$.defaults.align", "align must be left, center, or right", defaults.align);
  }

  return {
    font,
    fontSizePt: fontSizePt && fontSizePt > 0 ? fontSizePt : 11,
    lineGapPt: lineGapPt !== null && lineGapPt >= 0 ? lineGapPt : 0,
    align: ALIGNMENTS.has(align) ? align : "left"
  };
}

function normalizeTruncate(rawTruncate, fieldPath, errors) {
  if (rawTruncate === undefined) {
    return {
      enabled: false,
      maxChars: 0,
      ellipsis: "..."
    };
  }

  if (!isPlainObject(rawTruncate)) {
    pushError(errors, `${fieldPath}.truncate`, "truncate must be an object", rawTruncate);
    return {
      enabled: false,
      maxChars: 0,
      ellipsis: "..."
    };
  }

  const enabled = Boolean(rawTruncate.enabled);
  const maxChars = Number.isInteger(rawTruncate.maxChars) ? rawTruncate.maxChars : 0;
  const ellipsis = typeof rawTruncate.ellipsis === "string" ? rawTruncate.ellipsis : "...";

  if (enabled && maxChars <= 0) {
    pushError(errors, `${fieldPath}.truncate.maxChars`, "maxChars must be a positive integer when truncate is enabled", rawTruncate.maxChars);
  }

  return {
    enabled,
    maxChars,
    ellipsis
  };
}

function normalizeField(rawField, idx, defaults, errors) {
  const fieldPath = `$.fields[${idx}]`;
  if (!isPlainObject(rawField)) {
    pushError(errors, fieldPath, "field entry must be an object", rawField);
    return null;
  }

  const parameter = String(rawField.parameter || "").trim().toLowerCase();
  if (!SLIP_PARAMETER_KEYS.includes(parameter)) {
    pushError(
      errors,
      `${fieldPath}.parameter`,
      `parameter must be one of: ${SLIP_PARAMETER_KEYS.join(", ")}`,
      rawField.parameter
    );
  }

  const xMm = asNumber(rawField.xMm);
  const yMm = asNumber(rawField.yMm);
  const maxWidthMm = asNumber(rawField.maxWidthMm);
  const hasMaxHeight = rawField.maxHeightMm !== undefined && rawField.maxHeightMm !== null;
  const maxHeightMm = hasMaxHeight ? asNumber(rawField.maxHeightMm) : null;

  if (xMm === null || xMm < 0) {
    pushError(errors, `${fieldPath}.xMm`, "xMm must be a non-negative number", rawField.xMm);
  }
  if (yMm === null || yMm < 0) {
    pushError(errors, `${fieldPath}.yMm`, "yMm must be a non-negative number", rawField.yMm);
  }
  if (maxWidthMm === null || maxWidthMm <= 0) {
    pushError(errors, `${fieldPath}.maxWidthMm`, "maxWidthMm must be a positive number", rawField.maxWidthMm);
  }
  if (hasMaxHeight && (maxHeightMm === null || maxHeightMm <= 0)) {
    pushError(errors, `${fieldPath}.maxHeightMm`, "maxHeightMm must be a positive number when provided", rawField.maxHeightMm);
  }

  const font = typeof rawField.font === "string" && rawField.font.trim() !== ""
    ? rawField.font.trim()
    : defaults.font;

  const fontSizePtRaw = rawField.fontSizePt === undefined ? defaults.fontSizePt : asNumber(rawField.fontSizePt);
  if (fontSizePtRaw === null || fontSizePtRaw <= 0) {
    pushError(errors, `${fieldPath}.fontSizePt`, "fontSizePt must be a positive number", rawField.fontSizePt);
  }

  const align = String(rawField.align || defaults.align).trim().toLowerCase();
  if (!ALIGNMENTS.has(align)) {
    pushError(errors, `${fieldPath}.align`, "align must be left, center, or right", rawField.align);
  }

  const rotationDegRaw = rawField.rotationDeg === undefined ? 0 : asNumber(rawField.rotationDeg);
  if (rotationDegRaw === null) {
    pushError(errors, `${fieldPath}.rotationDeg`, "rotationDeg must be a number when provided", rawField.rotationDeg);
  }

  const lineGapPtRaw = rawField.lineGapPt === undefined ? defaults.lineGapPt : asNumber(rawField.lineGapPt);
  if (lineGapPtRaw === null || lineGapPtRaw < 0) {
    pushError(errors, `${fieldPath}.lineGapPt`, "lineGapPt must be zero or a positive number", rawField.lineGapPt);
  }

  const label = typeof rawField.label === "string" ? rawField.label : "";

  return {
    parameter: SLIP_PARAMETER_KEYS.includes(parameter) ? parameter : "description",
    label,
    xMm: xMm !== null && xMm >= 0 ? xMm : 0,
    yMm: yMm !== null && yMm >= 0 ? yMm : 0,
    maxWidthMm: maxWidthMm !== null && maxWidthMm > 0 ? maxWidthMm : 10,
    maxHeightMm: maxHeightMm !== null && maxHeightMm > 0 ? maxHeightMm : null,
    font,
    fontSizePt: fontSizePtRaw !== null && fontSizePtRaw > 0 ? fontSizePtRaw : defaults.fontSizePt,
    align: ALIGNMENTS.has(align) ? align : defaults.align,
    rotationDeg: rotationDegRaw !== null ? rotationDegRaw : 0,
    lineGapPt: lineGapPtRaw !== null && lineGapPtRaw >= 0 ? lineGapPtRaw : defaults.lineGapPt,
    multiline: rawField.multiline === undefined ? true : Boolean(rawField.multiline),
    includeIfEmpty: Boolean(rawField.includeIfEmpty),
    truncate: normalizeTruncate(rawField.truncate, fieldPath, errors)
  };
}

function validateAndNormalizeSlipConfig(rawConfig) {
  const errors = [];

  if (!isPlainObject(rawConfig)) {
    pushError(errors, "$", "Config root must be a JSON object", rawConfig);
    return {
      ok: false,
      errors,
      normalizedJson: null
    };
  }

  const paper = normalizePaper(rawConfig.paper, errors);
  const defaults = normalizeDefaults(rawConfig.defaults, errors);

  if (!Array.isArray(rawConfig.fields) || rawConfig.fields.length === 0) {
    pushError(errors, "$.fields", "fields must be a non-empty array", rawConfig.fields);
  }

  const fields = Array.isArray(rawConfig.fields)
    ? rawConfig.fields
        .map((field, idx) => normalizeField(field, idx, defaults, errors))
        .filter((field) => field !== null)
    : [];

  const version = Number.isInteger(rawConfig.version) ? rawConfig.version : 1;

  const normalizedJson = {
    version,
    paper,
    defaults,
    fields
  };

  return {
    ok: errors.length === 0,
    errors,
    normalizedJson
  };
}

function resolveSlipPageSizeMm(paper) {
  const format = String(paper?.format || "receipt80").toLowerCase();
  const preset = PAPER_PRESETS_MM[format] || PAPER_PRESETS_MM.receipt80;
  const widthMm = asNumber(paper?.widthMm) || preset.widthMm;
  const heightMm = asNumber(paper?.heightMm) || preset.heightMm;
  const orientation = String(paper?.orientation || "portrait").toLowerCase();

  if (orientation === "landscape") {
    return { widthMm: heightMm, heightMm: widthMm };
  }
  return { widthMm, heightMm };
}

function resolveSlipItemValue(item, parameter) {
  const field = PARAMETER_TO_ITEM_FIELD[parameter];
  const value = field ? item?.[field] : "";
  return value == null ? "" : String(value);
}

function truncateTextForSlip(text, truncate) {
  const value = text == null ? "" : String(text);
  if (!truncate || truncate.enabled !== true) return value;

  const maxChars = Number.isInteger(truncate.maxChars) ? truncate.maxChars : 0;
  if (maxChars <= 0 || value.length <= maxChars) return value;

  const ellipsis = typeof truncate.ellipsis === "string" ? truncate.ellipsis : "...";
  if (maxChars <= ellipsis.length) {
    return ellipsis.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - ellipsis.length)}${ellipsis}`;
}

function mmToPoints(mm) {
  return (Number(mm) / 25.4) * 72;
}

module.exports = {
  SLIP_PARAMETER_KEYS,
  PAPER_PRESETS_MM,
  validateAndNormalizeSlipConfig,
  resolveSlipPageSizeMm,
  resolveSlipItemValue,
  truncateTextForSlip,
  mmToPoints
};
