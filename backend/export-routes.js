const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const pptxgen = require('pptxgenjs');
const PDFDocument = require('pdfkit');
const { Parser } = require('@json2csv/plainjs');
const strftime = require('strftime');
const { CURRENCY_SYMBOL } = require('./config');
const { roundCurrency } = require('./payment-utils');
const { version: backendVersion } = require('./package.json');

const {
    validateAndNormalizeSlipConfig,
    resolveSlipPageSizeMm,
    resolveSlipItemValue,
    truncateTextForSlip,
    mmToPoints
} = require('./slip-config');

function registerExportRoutes({
    app,
    db,
    fsp,
    audit,
    getAuditActor,
    authenticateRole,
    checkAuctionState,
    allowedStatuses,
    log,
    logLevels,
    logFromRequest,
    PPTX_CONFIG_DIR,
    OUTPUT_DIR,
    UPLOAD_DIR
}) {
    const EXPORT_SELECTION_MODES = new Set(["all", "needs-attention", "range"]);
    const PPTX_EXPORT_TYPES = new Set(["slides", "cards"]);
    const pptxExportState = {
        current: null,
        last: null
    };

    class ExportCancelledError extends Error {
        constructor(message = "Export cancelled") {
            super(message);
            this.name = "ExportCancelledError";
        }
    }

    function normaliseExportSelectionMode(rawMode, rawScope) {
        const modeCandidate = typeof rawMode === "string" ? rawMode.trim().toLowerCase() : "";
        const scopeCandidate = typeof rawScope === "string" ? rawScope.trim().toLowerCase() : "";
        const candidate = modeCandidate || scopeCandidate || "all";

        if (candidate === "needs-print" || candidate === "needs_print") return "needs-attention";
        if (candidate === "needs-export" || candidate === "needs_export") return "needs-attention";
        if (candidate === "stale" || candidate === "out-of-date" || candidate === "out_of_date") return "needs-attention";
        if (candidate === "range") return "range";
        if (candidate === "all") return "all";
        return candidate;
    }

    function parseItemNumberSelection(rawRange) {
        if (typeof rawRange !== "string" || rawRange.trim() === "") {
            const error = new Error("Item range is required when using range selection");
            error.statusCode = 400;
            throw error;
        }

        const selectedNumbers = new Set();
        const tokens = rawRange.split(",");
        for (const rawToken of tokens) {
            const token = rawToken.trim();
            if (!token) {
                const error = new Error("Item range contains an empty entry");
                error.statusCode = 400;
                throw error;
            }

            if (/^\d+$/.test(token)) {
                const value = Number(token);
                if (!Number.isInteger(value) || value <= 0) {
                    const error = new Error(`Invalid item number '${token}'`);
                    error.statusCode = 400;
                    throw error;
                }
                selectedNumbers.add(value);
                continue;
            }

            const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
            if (rangeMatch) {
                const start = Number(rangeMatch[1]);
                const end = Number(rangeMatch[2]);
                if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || start > end) {
                    const error = new Error(`Invalid item range '${token}'`);
                    error.statusCode = 400;
                    throw error;
                }
                for (let itemNumber = start; itemNumber <= end; itemNumber += 1) {
                    selectedNumbers.add(itemNumber);
                }
                continue;
            }

            const error = new Error(`Invalid item range token '${token}'`);
            error.statusCode = 400;
            throw error;
        }

        return Array.from(selectedNumbers).sort((a, b) => a - b);
    }

    function getExportTrackingColumn(exportType) {
        switch (exportType) {
            case "slips":
                return "last_print";
            case "slides":
                return "last_slide_export";
            case "cards":
                return "last_card_export";
            default:
                throw new Error(`Unknown export type '${exportType}'`);
        }
    }

    function getExportDisplayLabel(exportType) {
        switch (exportType) {
            case "slips":
                return "slip print";
            case "slides":
                return "slide export";
            case "cards":
                return "card export";
            case "csv":
                return "CSV export";
            default:
                return exportType;
        }
    }

    function parseDbDateTimeToTs(value) {
        if (!value || typeof value !== "string") return null;
        const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!match) return null;
        const [, dd, mm, yyyy, hh, min, sec] = match;
        const parsed = new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hh),
            Number(min),
            sec ? Number(sec) : 0
        );
        const ts = parsed.getTime();
        return Number.isFinite(ts) ? ts : null;
    }

    function getExportSourceTimestamp(item, exportType) {
        if (!item) return null;

        if (exportType === "slips") {
            return parseDbDateTimeToTs(item.text_mod_date) ?? parseDbDateTimeToTs(item.mod_date);
        }
        if (exportType === "cards") {
            return parseDbDateTimeToTs(item.text_mod_date) ?? parseDbDateTimeToTs(item.mod_date);
        }
        return parseDbDateTimeToTs(item.mod_date) ?? parseDbDateTimeToTs(item.text_mod_date);
    }

    function itemNeedsExport(item, exportType) {
        const trackingColumn = getExportTrackingColumn(exportType);
        const lastTrackedTs = parseDbDateTimeToTs(item?.[trackingColumn]);
        if (!lastTrackedTs) return true;

        const sourceTs = getExportSourceTimestamp(item, exportType);
        if (!sourceTs) return false;
        return sourceTs > lastTrackedTs;
    }

    function getNeedsAttentionEmptyMessage(exportType) {
        if (exportType === "slips") {
            return "No unprinted or out-of-date item slips found";
        }
        if (exportType === "slides") {
            return "No unexported or out-of-date slide items found";
        }
        if (exportType === "cards") {
            return "No unexported or out-of-date card items found";
        }
        return "No items matched the export selection";
    }

    function loadAuctionItemsForExport(auctionId) {
        return db.all(
            `SELECT i.id,
                    i.item_number,
                    i.description,
                    i.contributor,
                    i.artist,
                    i.photo,
                    i.date,
                    i.notes,
                    i.mod_date,
                    i.text_mod_date,
                    i.last_print,
                    i.last_slide_export,
                    i.last_card_export,
                    i.auction_id,
                    i.winning_bidder_id,
                    b.paddle_number,
                    IFNULL(b.name, '') AS bidder_name,
                    CASE
                        WHEN b.paddle_number IS NOT NULL AND IFNULL(b.name, '') <> '' THEN b.paddle_number || ' - ' || b.name
                        WHEN b.paddle_number IS NOT NULL THEN CAST(b.paddle_number AS TEXT)
                        ELSE ''
                    END AS bidder_label,
                    i.hammer_price
              FROM items i
          LEFT JOIN bidders b ON b.id = i.winning_bidder_id
              WHERE i.auction_id = ?
                AND COALESCE(i.is_deleted, 0) = 0
              ORDER BY i.item_number ASC`,
            [auctionId]
        );
    }

    function resolveExportSelection(input, exportType) {
        const auctionId = Number(input?.auction_id);
        if (!auctionId) {
            const error = new Error("Missing auction_id");
            error.statusCode = 400;
            throw error;
        }

        const selectionMode = normaliseExportSelectionMode(input?.selection_mode, input?.scope);
        if (!EXPORT_SELECTION_MODES.has(selectionMode)) {
            const error = new Error("Invalid selection_mode. Use all, needs-attention, or range");
            error.statusCode = 400;
            throw error;
        }

        const allItems = loadAuctionItemsForExport(auctionId);
        if (!Array.isArray(allItems) || allItems.length === 0) {
            const error = new Error("No items found for this auction");
            error.statusCode = 400;
            throw error;
        }

        let items = allItems;
        let selectedItemNumbers = null;
        let itemRange = null;

        if (selectionMode === "needs-attention") {
            if (exportType === "csv") {
                const error = new Error("CSV export does not support unexported/out-of-date selection");
                error.statusCode = 400;
                throw error;
            }
            items = allItems.filter((item) => itemNeedsExport(item, exportType));
            if (items.length === 0) {
                const error = new Error(getNeedsAttentionEmptyMessage(exportType));
                error.statusCode = 400;
                throw error;
            }
        } else if (selectionMode === "range") {
            itemRange = String(input?.item_range || "").trim();
            selectedItemNumbers = parseItemNumberSelection(itemRange);
            const itemMap = new Map(allItems.map((item) => [Number(item.item_number), item]));
            const missingItemNumbers = selectedItemNumbers.filter((itemNumber) => !itemMap.has(itemNumber));
            if (missingItemNumbers.length > 0) {
                const error = new Error(`Item numbers not found in this auction: ${missingItemNumbers.join(", ")}`);
                error.statusCode = 400;
                error.missing_item_numbers = missingItemNumbers;
                throw error;
            }
            items = selectedItemNumbers.map((itemNumber) => itemMap.get(itemNumber)).filter(Boolean);
        }

        return {
            auctionId,
            selectionMode,
            itemRange,
            selectedItemNumbers,
            allItems,
            items
        };
    }

    function updateItemExportTracking(auctionId, itemIds, exportType, exportStamp) {
        const trackingColumn = getExportTrackingColumn(exportType);
        const ids = Array.from(new Set(
            (itemIds || [])
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
        ));
        if (ids.length === 0) return 0;

        const chunkSize = 400;
        const chunks = [];
        for (let i = 0; i < ids.length; i += chunkSize) {
            chunks.push(ids.slice(i, i + chunkSize));
        }

        const updateTx = db.transaction((idChunks) => {
            let totalChanges = 0;
            idChunks.forEach((chunk) => {
                const placeholders = chunk.map(() => "?").join(",");
                const info = db.run(
                    `UPDATE items
                        SET ${trackingColumn} = ?
                      WHERE auction_id = ?
                        AND COALESCE(is_deleted, 0) = 0
                        AND id IN (${placeholders})`,
                    [exportStamp, auctionId, ...chunk]
                );
                totalChanges += Number(info?.changes || 0);
            });
            return totalChanges;
        });

        return updateTx(chunks);
    }

    function resetItemExportTracking(auctionId, exportType) {
        const trackingColumn = getExportTrackingColumn(exportType);
        const info = db.run(
            `UPDATE items
                SET ${trackingColumn} = NULL
              WHERE auction_id = ?
                AND COALESCE(is_deleted, 0) = 0`,
            [auctionId]
        );
        return Number(info?.changes || 0);
    }

    function serialisePptxJob(job) {
        if (!job) return null;
        return {
            id: job.id,
            status: job.status,
            export_type: job.exportType,
            auction_id: job.auctionId,
            item_count: job.itemCount,
            selection_mode: job.selectionMode,
            item_range: job.itemRange || null,
            started_at: job.startedAt,
            completed_at: job.completedAt || null,
            cancel_requested: !!job.cancelRequested,
            error: job.errorMessage || null,
            download_url: job.status === "completed" && job.outputFile
                ? `/api/export-jobs/pptx/download?job_id=${encodeURIComponent(job.id)}`
                : null,
            filename: job.downloadName || null
        };
    }

    function removePptxJobOutput(job) {
        if (!job?.outputFile) return;
        try {
            if (fs.existsSync(job.outputFile)) {
                fs.unlinkSync(job.outputFile);
            }
        } catch (error) {
            log('General', logLevels.WARN, `Failed to remove PPTX export file ${job.outputFile}: ${error.message}`);
        } finally {
            job.outputFile = null;
        }
    }

    function getActivePptxJob() {
        const currentJob = pptxExportState.current;
        if (!currentJob) return null;
        if (!["queued", "running", "cancelling"].includes(currentJob.status)) return null;
        return currentJob;
    }

    function createPptxJob({ auctionId, exportType, selectionMode, itemRange, itemCount, retainOutputFile }) {
        if (!PPTX_EXPORT_TYPES.has(exportType)) {
            throw new Error(`Unsupported PPTX export type '${exportType}'`);
        }

        const previousJob = pptxExportState.last;
        if (previousJob && previousJob !== pptxExportState.current) {
            removePptxJobOutput(previousJob);
        }

        const job = {
            id: uuidv4(),
            auctionId,
            exportType,
            selectionMode,
            itemRange: itemRange || null,
            itemCount,
            status: "queued",
            cancelRequested: false,
            startedAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: null,
            outputFile: null,
            downloadName: null,
            retainOutputFile: retainOutputFile === true
        };

        pptxExportState.current = job;
        pptxExportState.last = job;
        return job;
    }

    function assertPptxJobNotCancelled(job) {
        if (job?.cancelRequested) {
            throw new ExportCancelledError();
        }
    }

    async function runPptxJob(job, execute) {
        try {
            await new Promise((resolve) => setTimeout(resolve, 50));
            assertPptxJobNotCancelled(job);
            job.status = "running";
            const result = await execute(job);
            assertPptxJobNotCancelled(job);
            job.completedAt = new Date().toISOString();
            job.status = "completed";
            job.errorMessage = null;
            if (result?.outputFile) job.outputFile = result.outputFile;
            if (result?.downloadName) job.downloadName = result.downloadName;
            return result;
        } catch (error) {
            job.completedAt = new Date().toISOString();
            if (error instanceof ExportCancelledError) {
                job.status = "cancelled";
                job.errorMessage = error.message;
            } else {
                job.status = "failed";
                job.errorMessage = error.message;
                throw error;
            }
            return null;
        } finally {
            if (pptxExportState.current?.id === job.id) {
                pptxExportState.current = null;
            }
            if (job.status !== "completed") {
                removePptxJobOutput(job);
            }
        }
    }

    async function buildSlidesPptx(req, auctionId, items, job) {
        const configPath = path.join(PPTX_CONFIG_DIR, 'pptxConfig.json');
        const configData = await fsp.readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);
        const pptx = new pptxgen();
        const totalItems = db.get(
            "SELECT COUNT(*) AS count FROM items WHERE auction_id = ? AND COALESCE(is_deleted, 0) = 0",
            [auctionId]
        )?.count ?? 0;

        pptx.defineSlideMaster(config.masterSlide);
        logFromRequest(req, logLevels.DEBUG, `Slides: starting generation (${totalItems} item(s))`);

        for (const item of items) {
            assertPptxJobNotCancelled(job);
            const slide = pptx.addSlide({ masterName: "AUCTION_MASTER" });
            slide.addText(`Item # ${item.item_number} of ${totalItems}`, config.idStyle);
            slide.addText(item.description || "", config.descriptionStyle);
            slide.addText(`Donated by: ${item.contributor || ""}`, config.contributorStyle);
            slide.addText(`Creator: ${item.artist || ""}`, config.artistStyle);

            if (item.photo) {
                const imgPath = path.join(UPLOAD_DIR, item.photo);
                if (fs.existsSync(imgPath)) {
                    const metadata = await sharp(imgPath).metadata();
                    const aspectRatio = metadata.width / metadata.height;
                    const imgWidth = config.imageWidth;
                    const imgHeight = imgWidth / aspectRatio;

                    slide.addImage({
                        path: imgPath,
                        x: config.imageX ?? 0.2,
                        y: config.imageY ?? 0.2,
                        w: imgWidth,
                        h: imgHeight,
                        sizing: {
                            type: config.sizing?.type || 'contain',
                            w: config.sizing?.w || imgWidth,
                            h: config.sizing?.h || imgHeight
                        }
                    });
                }
            }
        }

        assertPptxJobNotCancelled(job);
        const outputFile = path.join(OUTPUT_DIR, `auction_${auctionId}_slides_${job.id}.pptx`);
        await pptx.writeFile({ fileName: outputFile });
        assertPptxJobNotCancelled(job);

        const exportStamp = strftime('%d-%m-%Y %H:%M:%S');
        updateItemExportTracking(auctionId, items.map((item) => item.id), "slides", exportStamp);
        audit(getAuditActor(req), 'generate slides', 'auction', auctionId, {
            auction_id: auctionId,
            item_count: items.length,
            selection_mode: job.selectionMode,
            item_range: job.itemRange,
            generated_at: exportStamp
        });
        logFromRequest(req, logLevels.INFO, `Slide file created for auction ${auctionId} (${items.length} item(s), mode=${job.selectionMode})`);

        return {
            outputFile,
            downloadName: `auction_${auctionId}_slides.pptx`
        };
    }

    async function buildCardsPptx(req, auctionId, items, job) {
        const configPath = path.join(PPTX_CONFIG_DIR, 'cardConfig.json');
        const configData = await fsp.readFile(configPath, 'utf-8');
        const cardConfig = JSON.parse(configData);
        const pptx = new pptxgen();

        pptx.defineSlideMaster(cardConfig.masterSlide);
        pptx.defineLayout({ name: 'A6', width: 5.8, height: 4.1 });
        pptx.layout = 'A6';
        logFromRequest(req, logLevels.DEBUG, `Cards: starting generation (${items.length} item(s))`);

        for (const item of items) {
            assertPptxJobNotCancelled(job);
            const slide = pptx.addSlide({ masterName: "CARD_MASTER" });
            slide.addText(`Item no: ${item.item_number}`, cardConfig.idStyle);
            slide.addText(item.description || "", cardConfig.descriptionStyle);
            slide.addText(`Donated by: ${item.contributor || ""}`, cardConfig.contributorStyle);
            slide.addText(`Creator: ${item.artist || ""}`, cardConfig.artistStyle);
        }

        assertPptxJobNotCancelled(job);
        const outputFile = path.join(OUTPUT_DIR, `auction_${auctionId}_cards_${job.id}.pptx`);
        await pptx.writeFile({ fileName: outputFile });
        assertPptxJobNotCancelled(job);

        const exportStamp = strftime('%d-%m-%Y %H:%M:%S');
        updateItemExportTracking(auctionId, items.map((item) => item.id), "cards", exportStamp);
        audit(getAuditActor(req), 'generate cards', 'auction', auctionId, {
            auction_id: auctionId,
            item_count: items.length,
            selection_mode: job.selectionMode,
            item_range: job.itemRange,
            generated_at: exportStamp
        });
        logFromRequest(req, logLevels.INFO, `Item cards created for auction ${auctionId} (${items.length} item(s), mode=${job.selectionMode})`);

        return {
            outputFile,
            downloadName: `auction_${auctionId}_cards.pptx`
        };
    }

    async function loadNormalizedSlipConfig(req) {
        const configPath = path.join(PPTX_CONFIG_DIR, 'slipConfig.json');
        const configText = await fsp.readFile(configPath, 'utf-8');
        const slipConfigRaw = JSON.parse(configText);
        const { ok, errors, normalizedJson } = validateAndNormalizeSlipConfig(slipConfigRaw);

        if (!ok) {
            logFromRequest(req, logLevels.ERROR, `Slip config invalid (${errors.length} error(s))`);
            const error = new Error("Slip configuration is invalid. Update slipConfig.json in Maintenance.");
            error.statusCode = 500;
            error.details = errors;
            throw error;
        }

        return normalizedJson;
    }

    function renderSlipPage(pdf, item, slipConfig) {
        slipConfig.fields.forEach((field) => {
            const baseValue = resolveSlipItemValue(item, field.parameter);
            if (!baseValue && !field.includeIfEmpty) {
                return;
            }

            const value = truncateTextForSlip(baseValue, field.truncate);
            const text = `${field.label || ""}${value}`;
            const x = mmToPoints(field.xMm);
            const y = mmToPoints(field.yMm);
            const textOptions = {
                width: mmToPoints(field.maxWidthMm),
                align: field.align,
                lineBreak: field.multiline !== false,
                lineGap: field.lineGapPt
            };

            if (field.maxHeightMm) {
                textOptions.height = mmToPoints(field.maxHeightMm);
            }

            pdf.save();
            pdf.font(field.font);
            pdf.fontSize(field.fontSizePt);
            if (field.rotationDeg) {
                pdf.rotate(field.rotationDeg, { origin: [x, y] });
            }
            pdf.text(text, x, y, textOptions);
            pdf.restore();
        });
    }

    function streamSlipPdf(res, items, slipConfig, filename) {
        const pageSize = resolveSlipPageSizeMm(slipConfig.paper);
        const pageDimensions = [mmToPoints(pageSize.widthMm), mmToPoints(pageSize.heightMm)];

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        const itemIdsForHeader = items
            .map((item) => Number(item?.id))
            .filter((id) => Number.isInteger(id) && id > 0);
        if (itemIdsForHeader.length > 0) {
            res.setHeader('X-Slip-Item-Ids', itemIdsForHeader.join(','));
        }

        const pdf = new PDFDocument({
            size: pageDimensions,
            margin: 0,
            autoFirstPage: false
        });
        pdf.pipe(res);

        items.forEach((item) => {
            pdf.addPage({ size: pageDimensions, margin: 0 });
            renderSlipPage(pdf, item, slipConfig);
        });

        return pdf;
    }

    function formatPreparedTimestamp(date = new Date()) {
        return strftime('%d-%m-%Y %H:%M:%S', date);
    }

    function normaliseBidderReportMode(rawMode) {
        const candidate = typeof rawMode === "string" ? rawMode.trim().toLowerCase() : "";
        if (!candidate || candidate === "all") return "all";
        if (["unpaid", "not-paid-in-full", "not_paid_in_full", "outstanding"].includes(candidate)) {
            return "unpaid";
        }
        if (["uncollected", "not-collected", "not_collected"].includes(candidate)) {
            return "uncollected";
        }
        return candidate;
    }

    function getBidderPaymentStatus(lotsTotal, paymentsTotal) {
        const lots = Number(lotsTotal || 0);
        const paid = Number(paymentsTotal || 0);
        if (paid <= 0) return "not_paid";
        if (paid >= lots && lots > 0) return "paid_in_full";
        return "part_paid";
    }

    function getBidderPaymentStatusLabel(status) {
        switch (status) {
            case "paid_in_full":
                return "Paid in full";
            case "part_paid":
                return "Part paid";
            default:
                return "Not paid";
        }
    }

    function getCollectionStatusLabel(collectedAt) {
        return collectedAt ? "Collected" : "Not collected";
    }

    function loadAuctionSummary(auctionId) {
        return db.get(
            `SELECT id, short_name, full_name, created_at, status
               FROM auctions
              WHERE id = ?`,
            [auctionId]
        );
    }

    function parseFlexibleDateTime(value) {
        if (!value || typeof value !== "string") return null;
        const trimmed = value.trim();
        if (!trimmed) return null;

        const ddMmYyyyMatch = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (ddMmYyyyMatch) {
            const [, dd, mm, yyyy, hh, min, sec] = ddMmYyyyMatch;
            const parsed = new Date(
                Number(yyyy),
                Number(mm) - 1,
                Number(dd),
                Number(hh),
                Number(min),
                sec ? Number(sec) : 0
            );
            return Number.isFinite(parsed.getTime()) ? parsed : null;
        }

        const isoLikeMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (isoLikeMatch) {
            const [, yyyy, mm, dd, hh, min, sec] = isoLikeMatch;
            const parsed = new Date(
                Number(yyyy),
                Number(mm) - 1,
                Number(dd),
                Number(hh),
                Number(min),
                sec ? Number(sec) : 0
            );
            return Number.isFinite(parsed.getTime()) ? parsed : null;
        }

        const fallback = new Date(trimmed);
        return Number.isFinite(fallback.getTime()) ? fallback : null;
    }

    function formatDisplayDateTime(value) {
        const parsed = value instanceof Date ? value : parseFlexibleDateTime(value);
        if (!parsed) return "Not available";
        return parsed.toLocaleString("en-GB", {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function formatCurrency(value) {
        const numeric = Number(value || 0);
        return `${CURRENCY_SYMBOL}${numeric.toFixed(2)}`;
    }

    function formatCount(value) {
        return Number(value || 0).toLocaleString("en-GB");
    }

    function formatPercent(value) {
        const numeric = Number(value || 0);
        return `${numeric.toFixed(1)}%`;
    }

    function formatMegabytes(value) {
        const numeric = Number(value || 0);
        return `${numeric.toFixed(2)} MB`;
    }

    function ellipsize(text, maxLength = 48) {
        const value = String(text || "").trim();
        if (value.length <= maxLength) return value;
        return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    }

    function normaliseDistinctText(value) {
        return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    }

    function sumValues(values) {
        return roundCurrency((values || []).reduce((sum, value) => sum + Number(value || 0), 0)) || 0;
    }

    function averageValues(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        return roundCurrency(sumValues(values) / values.length) || 0;
    }

    function medianValues(values) {
        if (!Array.isArray(values) || values.length === 0) return 0;
        const sorted = values
            .map((value) => Number(value || 0))
            .filter((value) => Number.isFinite(value))
            .sort((a, b) => a - b);
        if (sorted.length === 0) return 0;
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 1) return roundCurrency(sorted[middle]) || 0;
        return roundCurrency((sorted[middle - 1] + sorted[middle]) / 2) || 0;
    }

    function mapPaymentSourceLabel(payment) {
        if (payment?.provider === "sumup") return "SumUp";
        const normalizedMethod = String(payment?.method || "")
            .trim()
            .replace(/\s*\(refund\)\s*$/i, "")
            .toLowerCase();

        switch (normalizedMethod) {
            case "cash":
                return "Cash";
            case "card-manual":
                return "Card (manual)";
            case "paypal-manual":
                return "PayPal (manual)";
            default:
                return ellipsize(payment?.method || payment?.provider || "Other", 24);
        }
    }

    function itemWasEdited(item) {
        const createdAt = parseFlexibleDateTime(item?.date);
        const modAt = parseFlexibleDateTime(item?.mod_date);
        const textModAt = parseFlexibleDateTime(item?.text_mod_date);
        const latestEditAt = [modAt, textModAt]
            .filter(Boolean)
            .sort((a, b) => a.getTime() - b.getTime())
            .pop();

        if (createdAt && latestEditAt) {
            return latestEditAt.getTime() - createdAt.getTime() > 1000;
        }

        return Boolean(
            (item?.mod_date && item.mod_date !== item.date)
            || (item?.text_mod_date && item.text_mod_date !== item.date)
        );
    }

    function computePhotoStats(items) {
        let totalBytes = 0;
        let photoCount = 0;
        let missingCount = 0;

        (items || []).forEach((item) => {
            const photo = String(item?.photo || "").trim();
            if (!photo) return;
            const photoPath = path.join(UPLOAD_DIR, photo);
            try {
                if (!fs.existsSync(photoPath)) {
                    missingCount += 1;
                    return;
                }
                const stats = fs.statSync(photoPath);
                if (!stats.isFile()) {
                    missingCount += 1;
                    return;
                }
                photoCount += 1;
                totalBytes += Number(stats.size || 0);
            } catch (_error) {
                missingCount += 1;
            }
        });

        const totalMegabytes = totalBytes / (1024 * 1024);
        return {
            photo_count: photoCount,
            missing_count: missingCount,
            total_bytes: totalBytes,
            total_megabytes: totalMegabytes
        };
    }

    function buildTimeHistogram(values, bucketCount = 8) {
        const timestamps = (values || [])
            .map((value) => parseFlexibleDateTime(value))
            .filter(Boolean)
            .map((date) => date.getTime())
            .sort((a, b) => a - b);

        if (timestamps.length === 0) {
            return [];
        }

        const start = timestamps[0];
        const end = timestamps[timestamps.length - 1];
        if (start === end) {
            return [{
                label: formatDisplayDateTime(new Date(start)),
                count: timestamps.length
            }];
        }

        const resolvedBucketCount = Math.max(2, Math.min(bucketCount, timestamps.length));
        const span = Math.max(1, end - start);
        const bucketSize = Math.ceil((span + 1) / resolvedBucketCount);
        const dateFormatter = new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
        });
        const buckets = Array.from({ length: resolvedBucketCount }, (_, index) => ({
            label: dateFormatter.format(new Date(start + (index * bucketSize))),
            count: 0
        }));

        timestamps.forEach((timestamp) => {
            const index = Math.min(
                buckets.length - 1,
                Math.floor((timestamp - start) / bucketSize)
            );
            buckets[index].count += 1;
        });

        return buckets;
    }

    function computeAuctionReportData(auctionId, items) {
        const auction = loadAuctionSummary(auctionId);
        if (!auction) {
            const error = new Error("Auction not found");
            error.statusCode = 404;
            throw error;
        }

        const bidders = db.all(
            `SELECT id, paddle_number, name, created_at, ready_for_collection, ready_updated_at
               FROM bidders
              WHERE auction_id = ?
              ORDER BY paddle_number ASC`,
            [auctionId]
        );

        const payments = db.all(
            `SELECT p.id,
                    p.bidder_id,
                    p.amount,
                    p.donation_amount,
                    p.method,
                    p.note,
                    p.created_by,
                    p.created_at,
                    p.provider,
                    p.provider_txn_id,
                    p.intent_id,
                    p.currency,
                    p.reverses_payment_id,
                    p.reversal_reason,
                    b.paddle_number,
                    b.name AS bidder_name
               FROM payments p
               JOIN bidders b ON b.id = p.bidder_id
              WHERE b.auction_id = ?
              ORDER BY p.created_at ASC, p.id ASC`,
            [auctionId]
        );

        const bidAuditRows = db.all(
            `SELECT al.object_id AS item_id, al.created_at
               FROM audit_log al
               JOIN items i ON i.id = al.object_id
              WHERE al.object_type = 'item'
                AND al.action = 'finalize'
                AND i.auction_id = ?
                AND COALESCE(i.is_deleted, 0) = 0
              ORDER BY al.created_at ASC, al.id ASC`,
            [auctionId]
        );

        const soldItems = (items || []).filter((item) => Number(item?.hammer_price || 0) > 0);
        const hammerValues = soldItems.map((item) => Number(item.hammer_price || 0)).filter((value) => Number.isFinite(value) && value > 0);
        const hammerTotal = sumValues(hammerValues);
        const soldCount = soldItems.length;
        const itemCount = (items || []).length;
        const unsoldCount = Math.max(0, itemCount - soldCount);
        const sellThroughRate = itemCount > 0 ? (soldCount / itemCount) * 100 : 0;
        const uniqueContributors = new Set(
            (items || [])
                .map((item) => normaliseDistinctText(item?.contributor))
                .filter(Boolean)
        );
        const uniqueCreators = new Set(
            (items || [])
                .map((item) => normaliseDistinctText(item?.artist))
                .filter(Boolean)
        );
        const editedItems = (items || []).filter((item) => itemWasEdited(item));
        const photoStats = computePhotoStats(items);
        const itemsWithPhotos = (items || []).filter((item) => String(item?.photo || "").trim() !== "").length;
        const collectedCount = soldItems.filter((item) => item?.collected_at).length;
        const readyBidderCount = bidders.filter((bidder) => Number(bidder?.ready_for_collection) === 1).length;
        const creationHistogram = buildTimeHistogram((items || []).map((item) => item?.date));

        const paymentRowsByBidder = new Map();
        payments.forEach((payment) => {
            const bidderId = Number(payment.bidder_id);
            if (!paymentRowsByBidder.has(bidderId)) {
                paymentRowsByBidder.set(bidderId, []);
            }
            paymentRowsByBidder.get(bidderId).push(payment);
        });

        const soldItemsByBidder = new Map();
        soldItems.forEach((item) => {
            const bidderId = Number(item?.winning_bidder_id);
            if (!Number.isInteger(bidderId) || bidderId <= 0) return;
            if (!soldItemsByBidder.has(bidderId)) {
                soldItemsByBidder.set(bidderId, []);
            }
            soldItemsByBidder.get(bidderId).push(item);
        });

        const bidderSummaries = bidders.map((bidder) => {
            const bidderId = Number(bidder.id);
            const bidderItems = soldItemsByBidder.get(bidderId) || [];
            const bidderPayments = paymentRowsByBidder.get(bidderId) || [];
            const lotsTotal = sumValues(bidderItems.map((item) => Number(item.hammer_price || 0)));
            const paymentsTotal = sumValues(bidderPayments.map((payment) => Number(payment.amount || 0) - Number(payment.donation_amount || 0)));
            const donationsTotal = sumValues(bidderPayments.map((payment) => Number(payment.donation_amount || 0)));
            const grossTotal = sumValues(bidderPayments.map((payment) => Number(payment.amount || 0)));
            const balance = roundCurrency(lotsTotal - paymentsTotal) || 0;

            return {
                bidder_id: bidderId,
                paddle_number: bidder.paddle_number,
                name: bidder.name || "",
                lots_count: bidderItems.length,
                lots_total: lotsTotal,
                payments_total: paymentsTotal,
                donations_total: donationsTotal,
                gross_total: grossTotal,
                balance
            };
        }).filter((summary) => summary.lots_count > 0 || summary.gross_total !== 0);

        const winningBidderCount = bidderSummaries.filter((summary) => summary.lots_count > 0).length;
        const delinquentBidders = bidderSummaries
            .filter((summary) => Number(summary.balance || 0) > 0.009)
            .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

        const paymentBreakdownMap = new Map();
        const paymentSourceChartMap = new Map();
        payments.forEach((payment) => {
            const isRefund = Number(payment.amount || 0) < 0 || Number(payment.reverses_payment_id || 0) > 0;
            const sourceLabel = mapPaymentSourceLabel(payment);
            const label = isRefund
                ? `Refunds: ${sourceLabel}`
                : sourceLabel;
            if (!paymentBreakdownMap.has(label)) {
                paymentBreakdownMap.set(label, {
                    label,
                    count: 0,
                    gross_total: 0,
                    settlement_total: 0,
                    donations_total: 0,
                    is_refund: isRefund
                });
            }
            const entry = paymentBreakdownMap.get(label);
            entry.count += 1;
            entry.gross_total += Number(payment.amount || 0);
            entry.settlement_total += Number(payment.amount || 0) - Number(payment.donation_amount || 0);
            entry.donations_total += Number(payment.donation_amount || 0);

            if (!paymentSourceChartMap.has(sourceLabel)) {
                paymentSourceChartMap.set(sourceLabel, {
                    label: sourceLabel,
                    value: 0
                });
            }
            paymentSourceChartMap.get(sourceLabel).value += Number(payment.amount || 0);
        });

        const paymentBreakdown = Array.from(paymentBreakdownMap.values())
            .map((entry) => ({
                ...entry,
                gross_total: roundCurrency(entry.gross_total) || 0,
                settlement_total: roundCurrency(entry.settlement_total) || 0,
                donations_total: roundCurrency(entry.donations_total) || 0
            }))
            .sort((a, b) => Math.abs(Number(b.gross_total || 0)) - Math.abs(Number(a.gross_total || 0)));

        const refundPayments = payments.filter((payment) => Number(payment.amount || 0) < 0 || Number(payment.reverses_payment_id || 0) > 0);
        const donationPayments = payments.filter((payment) => Number(payment.donation_amount || 0) > 0);
        const settlementReceived = sumValues(payments.map((payment) => Number(payment.amount || 0) - Number(payment.donation_amount || 0)));
        const donationsTotal = sumValues(payments.map((payment) => Number(payment.donation_amount || 0)));
        const grossReceived = sumValues(payments.map((payment) => Number(payment.amount || 0)));
        const refundGrossTotal = Math.abs(sumValues(refundPayments.map((payment) => Number(payment.amount || 0) < 0 ? Number(payment.amount || 0) : 0)));
        const outstandingTotal = sumValues(delinquentBidders.map((summary) => Number(summary.balance || 0)));
        const sumupTransactionCount = payments.filter((payment) => payment.provider === "sumup" && Number(payment.amount || 0) > 0).length;
        const sumupRefundCount = payments.filter((payment) => payment.provider === "sumup" && Number(payment.amount || 0) < 0).length;

        const topItems = soldItems
            .slice()
            .sort((a, b) => Number(b.hammer_price || 0) - Number(a.hammer_price || 0))
            .slice(0, 10)
            .map((item) => ({
                label: `#${item.item_number} ${ellipsize(item.description || "Untitled item", 34)}`,
                value: Number(item.hammer_price || 0)
            }));

        const topBidders = bidderSummaries
            .filter((summary) => Number(summary.lots_total || 0) > 0)
            .slice()
            .sort((a, b) => Number(b.lots_total || 0) - Number(a.lots_total || 0))
            .slice(0, 10)
            .map((summary) => ({
                label: `Paddle ${summary.paddle_number}${summary.name ? ` (${ellipsize(summary.name, 18)})` : ""}`,
                value: Number(summary.lots_total || 0)
            }));

        const donationSummaryRows = Array.from(
            donationPayments.reduce((map, payment) => {
                const key = Number(payment.bidder_id);
                if (!map.has(key)) {
                    map.set(key, {
                        bidder_id: key,
                        paddle_number: payment.paddle_number,
                        bidder_name: payment.bidder_name || "",
                        donation_total: 0,
                        donation_count: 0
                    });
                }
                const entry = map.get(key);
                entry.donation_total += Number(payment.donation_amount || 0);
                entry.donation_count += 1;
                return map;
            }, new Map()).values()
        )
            .map((entry) => ({
                ...entry,
                donation_total: roundCurrency(entry.donation_total) || 0
            }))
            .sort((a, b) => Number(b.donation_total || 0) - Number(a.donation_total || 0))
            .slice(0, 10);

        const soldItemBidDates = soldItems
            .map((item) => parseFlexibleDateTime(item?.last_bid_update))
            .filter(Boolean)
            .sort((a, b) => a.getTime() - b.getTime());
        const auditBidDates = bidAuditRows
            .map((row) => parseFlexibleDateTime(row?.created_at))
            .filter(Boolean)
            .sort((a, b) => a.getTime() - b.getTime());
        const firstBidAt = soldItemBidDates[0] || auditBidDates[0] || null;
        const lastBidAt = soldItemBidDates[soldItemBidDates.length - 1] || auditBidDates[auditBidDates.length - 1] || null;

        return {
            auction,
            items,
            bidders,
            payments,
            sold_items: soldItems,
            summary: {
                item_count: itemCount,
                sold_count: soldCount,
                unsold_count: unsoldCount,
                hammer_total: hammerTotal,
                sell_through_rate: sellThroughRate,
                average_hammer_price: averageValues(hammerValues),
                median_hammer_price: medianValues(hammerValues),
                highest_hammer_price: hammerValues.length > 0 ? Math.max(...hammerValues) : 0,
                lowest_hammer_price: hammerValues.length > 0 ? Math.min(...hammerValues) : 0,
                total_gross_received: grossReceived,
                total_donations: donationsTotal,
                total_settlement_received: settlementReceived,
                refund_total: refundGrossTotal,
                outstanding_total: outstandingTotal
            },
            items_info: {
                unique_contributors: uniqueContributors.size,
                unique_creators: uniqueCreators.size,
                edited_count: editedItems.length,
                items_with_photos: itemsWithPhotos,
                photo_stats: photoStats,
                created_histogram: creationHistogram
            },
            bidder_info: {
                registered_count: bidders.length,
                winning_count: winningBidderCount,
                first_bid_at: firstBidAt,
                last_bid_at: lastBidAt,
                ready_for_collection_count: readyBidderCount,
                collected_item_count: collectedCount,
                fully_paid_count: bidderSummaries.filter((summary) => summary.lots_count > 0 && Number(summary.balance || 0) <= 0.009).length,
                delinquent_count: delinquentBidders.length,
                top_items: topItems,
                top_bidders: topBidders,
                delinquent_bidders: delinquentBidders
            },
            payment_info: {
                payment_count: payments.length,
                refund_count: refundPayments.length,
                donation_count: donationPayments.length,
                sumup_transaction_count: sumupTransactionCount,
                sumup_refund_count: sumupRefundCount,
                payment_breakdown: paymentBreakdown,
                payment_source_chart: Array.from(paymentSourceChartMap.values())
                    .map((entry) => ({
                        ...entry,
                        value: roundCurrency(entry.value) || 0
                    }))
                    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0)),
                donation_rows: donationSummaryRows
            }
        };
    }

    function createReportRenderer(pdf, context) {
        const layout = {
            margin: 40,
            headerHeight: 52,
            footerHeight: 26
        };
        const state = {
            pageNumber: 0,
            cursorY: 0
        };

        function pageWidth() {
            return pdf.page.width - (layout.margin * 2);
        }

        function pageBottomLimit() {
            return pdf.page.height - layout.margin - layout.footerHeight;
        }

        function drawPageChrome() {
            const width = pageWidth();
            const headerTop = layout.margin - 4;
            const ruleY = layout.margin + layout.headerHeight - 8;

            pdf.save();
            pdf.font("Helvetica-Bold").fontSize(13).fillColor("#111111")
                .text(context.auctionName, layout.margin, headerTop, {
                    width: width * 0.58,
                    align: "left"
                });
            pdf.font("Helvetica").fontSize(8.5).fillColor("#4b5563")
                .text(`Created: ${context.createdAt}`, layout.margin, headerTop + 18, {
                    width: width * 0.58,
                    align: "left"
                });
            pdf.text(`User: ${context.username}`, layout.margin + (width * 0.58), headerTop, {
                width: width * 0.42,
                align: "right"
            });
            pdf.text(`Version: ${context.version}`, layout.margin + (width * 0.58), headerTop + 14, {
                width: width * 0.42,
                align: "right"
            });
            pdf.text(`Page ${state.pageNumber}`, layout.margin + (width * 0.58), headerTop + 28, {
                width: width * 0.42,
                align: "right"
            });
            pdf.lineWidth(0.8)
                .strokeColor("#d1d5db")
                .moveTo(layout.margin, ruleY)
                .lineTo(layout.margin + width, ruleY)
                .stroke();
            pdf.restore();
        }

        function addPage() {
            pdf.addPage({ size: "A4", layout: "portrait", margin: 0 });
            state.pageNumber += 1;
            state.cursorY = layout.margin + layout.headerHeight + 8;
            drawPageChrome();
        }

        function ensureSpace(height) {
            if (state.pageNumber === 0) {
                addPage();
                return;
            }
            if (state.cursorY + height <= pageBottomLimit()) {
                return;
            }
            addPage();
        }

        function moveCursor(amount) {
            state.cursorY += amount;
        }

        function drawSectionTitle(title, subtitle = "") {
            ensureSpace(34);
            pdf.font("Helvetica-Bold").fontSize(15).fillColor("#111827")
                .text(title, layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 18;
            if (subtitle) {
                pdf.font("Helvetica").fontSize(9).fillColor("#6b7280")
                    .text(subtitle, layout.margin, state.cursorY, {
                        width: pageWidth(),
                        align: "left"
                    });
                state.cursorY += 16;
            } else {
                state.cursorY += 6;
            }
        }

        function drawMetricCards(cards, columns = 3) {
            const filteredCards = (cards || []).filter(Boolean);
            if (filteredCards.length === 0) return;
            const gap = 12;
            const totalGap = gap * (columns - 1);
            const cardWidth = (pageWidth() - totalGap) / columns;
            const cardHeight = 54;

            for (let index = 0; index < filteredCards.length; index += columns) {
                const row = filteredCards.slice(index, index + columns);
                ensureSpace(cardHeight + 10);
                row.forEach((card, columnIndex) => {
                    const x = layout.margin + (columnIndex * (cardWidth + gap));
                    const y = state.cursorY;
                    pdf.save();
                    pdf.roundedRect(x, y, cardWidth, cardHeight, 8)
                        .fillAndStroke("#f8fafc", "#d1d5db");
                    pdf.font("Helvetica").fontSize(8.5).fillColor("#64748b")
                        .text(card.label, x + 10, y + 9, {
                            width: cardWidth - 20,
                            align: "left"
                        });
                    pdf.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a")
                        .text(card.value, x + 10, y + 23, {
                            width: cardWidth - 20,
                            align: "left"
                        });
                    if (card.note) {
                        pdf.font("Helvetica").fontSize(7.5).fillColor("#6b7280")
                            .text(card.note, x + 10, y + 40, {
                                width: cardWidth - 20,
                                align: "left"
                            });
                    }
                    pdf.restore();
                });
                state.cursorY += cardHeight + 10;
            }
            state.cursorY += 2;
        }

        function drawKeyValueTable(rows) {
            const tableWidth = pageWidth();
            const labelWidth = Math.min(150, Math.max(120, tableWidth * 0.28));
            const valueWidth = tableWidth - labelWidth;
            const rowHeight = 20;

            (rows || []).forEach((row) => {
                ensureSpace(rowHeight);
                pdf.save();
                pdf.rect(layout.margin, state.cursorY, labelWidth, rowHeight).fillAndStroke("#f3f4f6", "#d1d5db");
                pdf.rect(layout.margin + labelWidth, state.cursorY, valueWidth, rowHeight).stroke("#d1d5db");
                pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
                    .text(row.label, layout.margin + 8, state.cursorY + 6, {
                        width: labelWidth - 16,
                        align: "left"
                    });
                pdf.font("Helvetica").fontSize(8.5).fillColor("#111827")
                    .text(row.value, layout.margin + labelWidth + 8, state.cursorY + 6, {
                        width: valueWidth - 16,
                        align: "left"
                    });
                pdf.restore();
                state.cursorY += rowHeight;
            });
            state.cursorY += 8;
        }

        function drawTable(columns, rows, options = {}) {
            const filteredColumns = columns || [];
            const filteredRows = rows || [];
            if (filteredColumns.length === 0) return;
            const tableWidth = pageWidth();
            const headerHeight = 22;
            const rowHeight = options.rowHeight || 18;
            const totalWidthWeight = filteredColumns.reduce((sum, column) => sum + Number(column.width || 1), 0) || 1;
            const columnWidths = filteredColumns.map((column) => (tableWidth * Number(column.width || 1)) / totalWidthWeight);

            const drawHeader = () => {
                ensureSpace(headerHeight);
                let cellX = layout.margin;
                filteredColumns.forEach((column, index) => {
                    const width = columnWidths[index];
                    pdf.save();
                    pdf.rect(cellX, state.cursorY, width, headerHeight).fillAndStroke("#e5e7eb", "#cbd5e1");
                    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#111827")
                        .text(column.label, cellX + 6, state.cursorY + 7, {
                            width: width - 12,
                            align: column.align || "left"
                        });
                    pdf.restore();
                    cellX += width;
                });
                state.cursorY += headerHeight;
            };

            drawHeader();
            filteredRows.forEach((row, rowIndex) => {
                ensureSpace(rowHeight);
                if (state.cursorY + rowHeight > pageBottomLimit()) {
                    addPage();
                    drawHeader();
                }

                let cellX = layout.margin;
                filteredColumns.forEach((column, index) => {
                    const width = columnWidths[index];
                    const fillColor = rowIndex % 2 === 0 ? "#ffffff" : "#f8fafc";
                    const text = row[column.key] == null ? "" : String(row[column.key]);
                    pdf.save();
                    pdf.rect(cellX, state.cursorY, width, rowHeight).fillAndStroke(fillColor, "#e5e7eb");
                    pdf.font("Helvetica").fontSize(8).fillColor("#111827")
                        .text(text, cellX + 6, state.cursorY + 5, {
                            width: width - 12,
                            align: column.align || "left",
                            ellipsis: true
                        });
                    pdf.restore();
                    cellX += width;
                });
                state.cursorY += rowHeight;
            });
            state.cursorY += 10;
        }

        function drawHorizontalBarChart(title, data, valueFormatter = formatCurrency) {
            const rows = (data || []).filter((entry) => Number(entry?.value || 0) > 0);
            if (rows.length === 0) return;

            const chartHeight = Math.max(78, rows.length * 24 + 28);
            const labelWidth = Math.min(220, Math.max(150, pageWidth() * 0.34));
            const valueWidth = 64;
            const barAreaWidth = pageWidth() - labelWidth - valueWidth - 18;
            const maxValue = Math.max(...rows.map((entry) => Number(entry.value || 0)), 1);

            ensureSpace(chartHeight + 26);
            pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111827")
                .text(title, layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 18;

            rows.forEach((entry, index) => {
                const rowY = state.cursorY + (index * 24);
                const barWidth = Math.max(2, (Number(entry.value || 0) / maxValue) * barAreaWidth);
                pdf.font("Helvetica").fontSize(8.5).fillColor("#111827")
                    .text(entry.label, layout.margin, rowY + 5, {
                        width: labelWidth - 8,
                        align: "left",
                        ellipsis: true
                    });
                pdf.save();
                pdf.roundedRect(layout.margin + labelWidth, rowY + 4, barAreaWidth, 12, 6)
                    .fill("#eef2f7");
                pdf.roundedRect(layout.margin + labelWidth, rowY + 4, barWidth, 12, 6)
                    .fill("#3b82f6");
                pdf.restore();
                pdf.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a")
                    .text(valueFormatter(entry.value), layout.margin + labelWidth + barAreaWidth + 10, rowY + 5, {
                        width: valueWidth,
                        align: "right"
                    });
            });

            state.cursorY += chartHeight + 8;
        }

        function drawVerticalBarChart(title, buckets) {
            const rows = (buckets || []).filter((entry) => Number(entry?.count || 0) > 0);
            if (rows.length === 0) return;

            const chartHeight = 170;
            const chartTopPadding = 22;
            const labelHeight = 34;
            const chartWidth = pageWidth();
            const plotHeight = chartHeight - chartTopPadding - labelHeight;
            const maxCount = Math.max(...rows.map((entry) => Number(entry.count || 0)), 1);
            const barGap = 8;
            const barWidth = Math.max(12, (chartWidth - (barGap * (rows.length - 1))) / rows.length);

            ensureSpace(chartHeight + 24);
            pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111827")
                .text(title, layout.margin, state.cursorY, {
                    width: chartWidth,
                    align: "left"
                });
            state.cursorY += 18;

            const originY = state.cursorY + plotHeight;
            pdf.save();
            pdf.strokeColor("#cbd5e1").lineWidth(0.8)
                .moveTo(layout.margin, originY)
                .lineTo(layout.margin + chartWidth, originY)
                .stroke();
            pdf.restore();

            rows.forEach((entry, index) => {
                const height = Math.max(4, (Number(entry.count || 0) / maxCount) * (plotHeight - 8));
                const x = layout.margin + (index * (barWidth + barGap));
                const y = originY - height;

                pdf.save();
                pdf.roundedRect(x, y, barWidth, height, 4)
                    .fill("#14b8a6");
                pdf.restore();

                pdf.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a")
                    .text(String(entry.count), x, y - 12, {
                        width: barWidth,
                        align: "center"
                    });
                pdf.font("Helvetica").fontSize(7).fillColor("#475569")
                    .text(entry.label, x - 4, originY + 6, {
                        width: barWidth + 8,
                        align: "center",
                        height: labelHeight
                    });
            });

            state.cursorY += chartHeight + 8;
        }

        function drawBulletList(title, rows) {
            const items = rows || [];
            if (items.length === 0) return;
            ensureSpace(22 + (items.length * 18));
            pdf.font("Helvetica-Bold").fontSize(11).fillColor("#111827")
                .text(title, layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 18;

            items.forEach((item) => {
                ensureSpace(18);
                pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
                    .text("\u2022", layout.margin, state.cursorY + 1, { width: 10 });
                pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
                    .text(item.label, layout.margin + 12, state.cursorY, {
                        width: 140,
                        align: "left"
                    });
                pdf.font("Helvetica").fontSize(8.5).fillColor("#374151")
                    .text(item.reason, layout.margin + 160, state.cursorY, {
                        width: pageWidth() - 160,
                        align: "left"
                    });
                state.cursorY += 18;
            });
            state.cursorY += 6;
        }

        return {
            addPage,
            ensureSpace,
            moveCursor,
            drawSectionTitle,
            drawMetricCards,
            drawKeyValueTable,
            drawTable,
            drawHorizontalBarChart,
            drawVerticalBarChart,
            drawBulletList
        };
    }

    function streamAuctionReportPdf(res, reportData, { auctionName, preparedAt, username, filename }) {
        const pdf = new PDFDocument({
            size: "A4",
            layout: "portrait",
            margin: 0,
            autoFirstPage: false
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        pdf.pipe(res);

        const renderer = createReportRenderer(pdf, {
            auctionName,
            createdAt: preparedAt,
            username,
            version: backendVersion || "Unknown"
        });

        const summaryCards = [
            { label: "Report date", value: formatDisplayDateTime(preparedAt), note: "Generated from current database state" },
            { label: "Items", value: formatCount(reportData.summary.item_count), note: `${formatCount(reportData.summary.sold_count)} sold / ${formatCount(reportData.summary.unsold_count)} unsold` },
            { label: "Total money raised", value: formatCurrency(reportData.summary.hammer_total), note: "Hammer total across sold items" }
        ];

        renderer.addPage();
        renderer.drawSectionTitle("Auction Report", "High-level overview for the selected auction.");
        renderer.drawMetricCards(summaryCards, 3);
        renderer.drawMetricCards([
            { label: "Sell-through", value: formatPercent(reportData.summary.sell_through_rate), note: "Sold items as a share of all items" },
            { label: "Gross received", value: formatCurrency(reportData.summary.total_gross_received), note: `${formatCurrency(reportData.summary.total_donations)} donations included` },
            { label: "Outstanding", value: formatCurrency(reportData.summary.outstanding_total), note: `${formatCount(reportData.bidder_info.delinquent_count)} bidder(s) still owing` }
        ], 3);

        renderer.drawSectionTitle("Auction Information");
        renderer.drawKeyValueTable([
            { label: "Auction ID", value: String(reportData.auction.id) },
            { label: "Long title", value: reportData.auction.full_name || "Not available" },
            { label: "Short title", value: reportData.auction.short_name || "Not available" },
            { label: "Date created", value: formatDisplayDateTime(reportData.auction.created_at) },
            { label: "Status", value: reportData.auction.status || "Unknown" }
        ]);

        renderer.drawSectionTitle("Item Information");
        renderer.drawMetricCards([
            { label: "Unique contributors", value: formatCount(reportData.items_info.unique_contributors), note: "Contributor names normalised case-insensitively" },
            { label: "Unique creators", value: formatCount(reportData.items_info.unique_creators), note: "Derived from the creator field" },
            { label: "Edited items", value: formatCount(reportData.items_info.edited_count), note: "Items changed after initial creation" },
            { label: "Items with photos", value: formatCount(reportData.items_info.items_with_photos), note: `${formatCount(reportData.items_info.photo_stats.missing_count)} missing file(s)` },
            { label: "Photo storage", value: formatMegabytes(reportData.items_info.photo_stats.total_megabytes), note: "Original uploaded photo files only" },
            { label: "Collected items", value: formatCount(reportData.bidder_info.collected_item_count), note: "Sold items marked collected" }
        ], 3);

        if (reportData.items_info.created_histogram.length > 0) {
            renderer.drawVerticalBarChart("Item creation timeline", reportData.items_info.created_histogram);
        }

        renderer.drawSectionTitle("Bidders and Sales");
        renderer.drawMetricCards([
            { label: "Registered bidders", value: formatCount(reportData.bidder_info.registered_count), note: `${formatCount(reportData.bidder_info.winning_count)} winning bidder(s)` },
            { label: "Average hammer price", value: formatCurrency(reportData.summary.average_hammer_price), note: `Median ${formatCurrency(reportData.summary.median_hammer_price)}` },
            { label: "Highest hammer price", value: formatCurrency(reportData.summary.highest_hammer_price), note: `Lowest ${formatCurrency(reportData.summary.lowest_hammer_price)}` },
            { label: "First lot recorded", value: formatDisplayDateTime(reportData.bidder_info.first_bid_at), note: "Earliest stored finalisation timestamp" },
            { label: "Last lot recorded", value: formatDisplayDateTime(reportData.bidder_info.last_bid_at), note: "Latest stored finalisation timestamp" },
            { label: "Ready for collection", value: formatCount(reportData.bidder_info.ready_for_collection_count), note: "Bidders marked ready in live feed" }
        ], 3);

        renderer.drawHorizontalBarChart("Top 10 highest priced items", reportData.bidder_info.top_items);
        renderer.drawHorizontalBarChart("Top 10 spending bidders", reportData.bidder_info.top_bidders);

        if (reportData.bidder_info.delinquent_bidders.length > 0) {
            renderer.drawSectionTitle("Delinquent Bidders");
            renderer.drawTable(
                [
                    { label: "Paddle", key: "paddle_number", width: 1.2, align: "left" },
                    { label: "Name", key: "name", width: 2.6, align: "left" },
                    { label: "Lots total", key: "lots_total_display", width: 1.4, align: "right" },
                    { label: "Paid", key: "payments_total_display", width: 1.4, align: "right" },
                    { label: "Outstanding", key: "balance_display", width: 1.4, align: "right" }
                ],
                reportData.bidder_info.delinquent_bidders.map((row) => ({
                    paddle_number: String(row.paddle_number || ""),
                    name: ellipsize(row.name || "Unnamed bidder", 26),
                    lots_total_display: formatCurrency(row.lots_total),
                    payments_total_display: formatCurrency(row.payments_total),
                    balance_display: formatCurrency(row.balance)
                }))
            );
        }

        renderer.drawSectionTitle("Payments");
        renderer.drawMetricCards([
            { label: "Payment records", value: formatCount(reportData.payment_info.payment_count), note: `${formatCount(reportData.payment_info.refund_count)} refund row(s)` },
            { label: "Settlement received", value: formatCurrency(reportData.summary.total_settlement_received), note: "Payments excluding donations" },
            { label: "Additional donations", value: formatCurrency(reportData.summary.total_donations), note: `${formatCount(reportData.payment_info.donation_count)} donation payment(s)` },
            { label: "Gross received", value: formatCurrency(reportData.summary.total_gross_received), note: `${formatCurrency(reportData.summary.refund_total)} refunded` },
            { label: "SumUp transactions", value: formatCount(reportData.payment_info.sumup_transaction_count), note: `${formatCount(reportData.payment_info.sumup_refund_count)} SumUp refund(s)` },
            { label: "Fully paid bidders", value: formatCount(reportData.bidder_info.fully_paid_count), note: `${formatCount(reportData.bidder_info.delinquent_count)} bidder(s) still owing` }
        ], 3);

        const paymentSourceChart = reportData.payment_info.payment_source_chart
            .filter((row) => Number(row.value || 0) > 0.009);
        if (paymentSourceChart.length > 0) {
            renderer.drawHorizontalBarChart("Payment breakdown by source", paymentSourceChart);
        }

        if (reportData.payment_info.payment_breakdown.length > 0) {
            renderer.drawTable(
                [
                    { label: "Source", key: "label", width: 2.5, align: "left" },
                    { label: "Count", key: "count", width: 0.9, align: "right" },
                    { label: "Settlement", key: "settlement_total_display", width: 1.3, align: "right" },
                    { label: "Donations", key: "donations_total_display", width: 1.3, align: "right" },
                    { label: "Gross", key: "gross_total_display", width: 1.3, align: "right" }
                ],
                reportData.payment_info.payment_breakdown.map((row) => ({
                    label: row.label,
                    count: String(row.count || 0),
                    settlement_total_display: formatCurrency(row.settlement_total),
                    donations_total_display: formatCurrency(row.donations_total),
                    gross_total_display: formatCurrency(row.gross_total)
                }))
            );
        }

        if (reportData.payment_info.donation_rows.length > 0) {
            renderer.drawSectionTitle("Donation Details");
            renderer.drawTable(
                [
                    { label: "Paddle", key: "paddle_number", width: 1, align: "left" },
                    { label: "Bidder", key: "bidder_name", width: 2.6, align: "left" },
                    { label: "Donation count", key: "donation_count", width: 1.3, align: "right" },
                    { label: "Donation total", key: "donation_total_display", width: 1.5, align: "right" }
                ],
                reportData.payment_info.donation_rows.map((row) => ({
                    paddle_number: String(row.paddle_number || ""),
                    bidder_name: ellipsize(row.bidder_name || "Unnamed bidder", 28),
                    donation_count: String(row.donation_count || 0),
                    donation_total_display: formatCurrency(row.donation_total)
                }))
            );
        }

        return pdf;
    }

    async function loadBidderReportData(auctionId, bidderMode) {
        const auction = loadAuctionSummary(auctionId);
        if (!auction) {
            const error = new Error("Auction not found");
            error.statusCode = 404;
            throw error;
        }

        const normalisedMode = normaliseBidderReportMode(bidderMode);
        if (!["all", "unpaid", "uncollected"].includes(normalisedMode)) {
            const error = new Error("Invalid bidder_mode. Use all, unpaid, or uncollected");
            error.statusCode = 400;
            throw error;
        }

        const bidderRows = db.all(
            `SELECT b.id AS bidder_id,
                    b.paddle_number,
                    b.name,
                    COUNT(i.id) AS item_count,
                    IFNULL(SUM(i.hammer_price), 0) AS lots_total,
                    IFNULL(SUM(CASE WHEN i.collected_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS collected_count,
                    IFNULL(p.payments_total, 0) AS payments_total
               FROM bidders b
               JOIN items i
                 ON i.winning_bidder_id = b.id
                AND i.auction_id = ?
                AND i.hammer_price IS NOT NULL
                AND COALESCE(i.is_deleted, 0) = 0
               LEFT JOIN (
                    SELECT bidder_id, SUM(amount - COALESCE(donation_amount, 0)) AS payments_total
                      FROM payments
                     GROUP BY bidder_id
               ) p ON p.bidder_id = b.id
              WHERE b.auction_id = ?
              GROUP BY b.id, b.paddle_number, b.name, p.payments_total
              ORDER BY b.paddle_number ASC`,
            [auctionId, auctionId]
        );

        const itemRows = db.all(
            `SELECT i.id,
                    i.item_number,
                    i.description,
                    i.photo,
                    i.hammer_price,
                    i.collected_at,
                    i.winning_bidder_id AS bidder_id
               FROM items i
              WHERE i.auction_id = ?
                AND i.hammer_price IS NOT NULL
                AND i.winning_bidder_id IS NOT NULL
                AND COALESCE(i.is_deleted, 0) = 0
              ORDER BY i.winning_bidder_id ASC, i.item_number ASC`,
            [auctionId]
        );

        const itemsByBidder = new Map();
        itemRows.forEach((item) => {
            const bidderId = Number(item.bidder_id);
            if (!itemsByBidder.has(bidderId)) {
                itemsByBidder.set(bidderId, []);
            }
            itemsByBidder.get(bidderId).push({
                ...item,
                hammer_price: roundCurrency(item.hammer_price || 0) || 0,
                collection_status: getCollectionStatusLabel(item.collected_at)
            });
        });

        const bidderSummaries = bidderRows
            .map((row) => {
                const bidderId = Number(row.bidder_id);
                const itemCount = Number(row.item_count || 0);
                const collectedCount = Number(row.collected_count || 0);
                const lotsTotal = roundCurrency(row.lots_total || 0) || 0;
                const paymentsTotal = roundCurrency(row.payments_total || 0) || 0;
                const paymentStatus = getBidderPaymentStatus(lotsTotal, paymentsTotal);
                const balance = roundCurrency(lotsTotal - paymentsTotal) || 0;
                const items = itemsByBidder.get(bidderId) || [];

                return {
                    bidder_id: bidderId,
                    paddle_number: row.paddle_number,
                    name: row.name || "",
                    item_count: itemCount,
                    collected_count: collectedCount,
                    all_collected: itemCount > 0 && collectedCount >= itemCount,
                    lots_total: lotsTotal,
                    payments_total: paymentsTotal,
                    balance,
                    payment_status: paymentStatus,
                    payment_status_label: getBidderPaymentStatusLabel(paymentStatus),
                    items
                };
            })
            .filter((bidder) => {
                if (normalisedMode === "unpaid") {
                    return bidder.payment_status !== "paid_in_full";
                }
                if (normalisedMode === "uncollected") {
                    return !bidder.all_collected;
                }
                return true;
            });

        if (bidderSummaries.length === 0) {
            const message = normalisedMode === "unpaid"
                ? "No bidders with an outstanding balance were found"
                : (normalisedMode === "uncollected"
                    ? "No bidders with uncollected items were found"
                    : "No bidders with sold items were found");
            const error = new Error(message);
            error.statusCode = 400;
            throw error;
        }

        const photoCache = new Map();

        async function loadPhotoAttachment(photo) {
            const photoName = String(photo || "").trim();
            if (!photoName) return null;
            if (photoCache.has(photoName)) {
                return photoCache.get(photoName);
            }

            const candidatePaths = [
                path.join(UPLOAD_DIR, `preview_${photoName}`),
                path.join(UPLOAD_DIR, photoName)
            ];

            for (const candidatePath of candidatePaths) {
                try {
                    if (!fs.existsSync(candidatePath)) continue;
                    const buffer = await sharp(candidatePath)
                        .rotate()
                        .resize(220, 180, {
                            fit: "inside",
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 78 })
                        .toBuffer();
                    const metadata = await sharp(buffer).metadata();
                    const attachment = {
                        buffer,
                        width: Number(metadata.width || 0),
                        height: Number(metadata.height || 0)
                    };
                    photoCache.set(photoName, attachment);
                    return attachment;
                } catch (_error) {
                    // Try the next candidate path if available.
                }
            }

            photoCache.set(photoName, null);
            return null;
        }

        for (const bidder of bidderSummaries) {
            for (const item of bidder.items) {
                item.photo_attachment = await loadPhotoAttachment(item.photo);
            }
        }

        return {
            auction,
            bidder_mode: normalisedMode,
            bidders: bidderSummaries
        };
    }

    function streamBidderReportPdf(res, reportData, { auctionName, preparedAt, username, filename }) {
        const pdf = new PDFDocument({
            size: "A4",
            layout: "portrait",
            margin: 0,
            autoFirstPage: false
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        pdf.pipe(res);

        const layout = {
            margin: 36,
            headerHeight: 52,
            footerHeight: 24,
            sectionGap: 12
        };
        const state = {
            pageNumber: 0,
            cursorY: 0
        };

        function pageWidth() {
            return pdf.page.width - (layout.margin * 2);
        }

        function pageBottomLimit() {
            return pdf.page.height - layout.margin - layout.footerHeight;
        }

        function drawPageChrome() {
            const width = pageWidth();
            const headerTop = layout.margin - 2;
            const ruleY = layout.margin + layout.headerHeight - 8;

            pdf.save();
            pdf.font("Helvetica-Bold").fontSize(13).fillColor("#111111")
                .text(auctionName, layout.margin, headerTop, {
                    width: width * 0.6,
                    align: "left"
                });
            pdf.font("Helvetica").fontSize(9).fillColor("#4b5563")
                .text(`Report: Bidder Report`, layout.margin, headerTop + 17, {
                    width: width * 0.6,
                    align: "left"
                })
                .text(`Generated: ${preparedAt}`, layout.margin, headerTop + 31, {
                    width: width * 0.6,
                    align: "left"
                });
            pdf.text(`User: ${username}`, layout.margin + (width * 0.6), headerTop + 10, {
                width: width * 0.4,
                align: "right"
            });
            pdf.text(`Page ${state.pageNumber}`, layout.margin + (width * 0.6), headerTop + 28, {
                width: width * 0.4,
                align: "right"
            });
            pdf.lineWidth(0.8)
                .strokeColor("#d1d5db")
                .moveTo(layout.margin, ruleY)
                .lineTo(layout.margin + width, ruleY)
                .stroke();
            pdf.restore();
        }

        function addPage() {
            pdf.addPage({ size: "A4", layout: "portrait", margin: 0 });
            state.pageNumber += 1;
            state.cursorY = layout.margin + layout.headerHeight + 8;
            drawPageChrome();
        }

        function ensureSpace(height) {
            if (state.pageNumber === 0) {
                addPage();
            } else if (state.cursorY + height > pageBottomLimit()) {
                addPage();
            }
        }

        function drawReportIntro() {
            ensureSpace(58);
            const modeLabel = reportData.bidder_mode === "unpaid"
                ? "Only bidders who have not paid in full"
                : (reportData.bidder_mode === "uncollected"
                    ? "Only bidders who have not collected"
                    : "All bidders with sold items");

            pdf.font("Helvetica-Bold").fontSize(16).fillColor("#111827")
                .text("Bidder Report", layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 20;

            pdf.font("Helvetica").fontSize(10).fillColor("#4b5563")
                .text(`${reportData.bidders.length} bidder(s) included. Filter: ${modeLabel}.`, layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 22;
        }

        function drawBidderSummaryCard(bidder) {
            ensureSpace(76);
            const width = pageWidth();
            const boxHeight = 66;
            const bidderLabel = bidder.name
                ? `Bidder ${bidder.paddle_number} - ${bidder.name}`
                : `Bidder ${bidder.paddle_number}`;

            pdf.save();
            pdf.roundedRect(layout.margin, state.cursorY, width, boxHeight, 10)
                .fillAndStroke("#f8fafc", "#d1d5db");
            pdf.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a")
                .text(bidderLabel, layout.margin + 12, state.cursorY + 12, {
                    width: width - 24,
                    align: "left"
                });
            pdf.font("Helvetica").fontSize(9).fillColor("#334155")
                .text(
                    `Payment status: ${bidder.payment_status_label}   Total owed: ${formatCurrency(bidder.lots_total)}   Amount paid: ${formatCurrency(bidder.payments_total)}   Outstanding: ${formatCurrency(bidder.balance)}`,
                    layout.margin + 12,
                    state.cursorY + 32,
                    {
                        width: width - 24,
                        align: "left"
                    }
                )
                .text(
                    `Collection: ${bidder.collected_count}/${bidder.item_count} collected`,
                    layout.margin + 12,
                    state.cursorY + 46,
                    {
                        width: width - 24,
                        align: "left"
                    }
                );
            pdf.restore();
            state.cursorY += boxHeight + 8;
        }

        function drawBidderItemsTable(bidder) {
            const columns = [
                { label: "Lot", key: "item_number", width: 0.8, align: "left" },
                { label: "Description", key: "description", width: 3.5, align: "left" },
                { label: "Bid Price", key: "hammer_price_display", width: 1.2, align: "right" },
                { label: "Collection Status", key: "collection_status", width: 1.5, align: "left" }
            ];
            const totalWidthWeight = columns.reduce((sum, column) => sum + Number(column.width || 1), 0) || 1;
            const tableWidth = pageWidth();
            const columnWidths = columns.map((column) => (tableWidth * Number(column.width || 1)) / totalWidthWeight);
            const headerHeight = 20;
            const rowHeight = 24;

            ensureSpace(headerHeight + rowHeight);
            pdf.font("Helvetica-Bold").fontSize(10).fillColor("#111827")
                .text("Winning Items", layout.margin, state.cursorY, {
                    width: tableWidth,
                    align: "left"
                });
            state.cursorY += 14;

            const drawHeader = () => {
                ensureSpace(headerHeight);
                let cellX = layout.margin;
                columns.forEach((column, index) => {
                    const cellWidth = columnWidths[index];
                    pdf.save();
                    pdf.rect(cellX, state.cursorY, cellWidth, headerHeight).fillAndStroke("#e5e7eb", "#cbd5e1");
                    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#111827")
                        .text(column.label, cellX + 6, state.cursorY + 6, {
                            width: cellWidth - 12,
                            align: column.align || "left"
                        });
                    pdf.restore();
                    cellX += cellWidth;
                });
                state.cursorY += headerHeight;
            };

            drawHeader();

            bidder.items.forEach((item, index) => {
                if (state.cursorY + rowHeight > pageBottomLimit()) {
                    addPage();
                    drawHeader();
                }

                let cellX = layout.margin;
                const fillColor = index % 2 === 0 ? "#ffffff" : "#f8fafc";
                const rowData = {
                    item_number: String(item.item_number ?? ""),
                    description: String(item.description || ""),
                    hammer_price_display: formatCurrency(item.hammer_price),
                    collection_status: item.collection_status
                };

                columns.forEach((column, columnIndex) => {
                    const cellWidth = columnWidths[columnIndex];
                    pdf.save();
                    pdf.rect(cellX, state.cursorY, cellWidth, rowHeight).fillAndStroke(fillColor, "#e5e7eb");
                    pdf.font("Helvetica").fontSize(8).fillColor("#111827")
                        .text(rowData[column.key], cellX + 6, state.cursorY + 6, {
                            width: cellWidth - 12,
                            align: column.align || "left",
                            ellipsis: true
                        });
                    pdf.restore();
                    cellX += cellWidth;
                });
                state.cursorY += rowHeight;
            });

            state.cursorY += 10;
        }

        function drawBidderPhotos(bidder) {
            const photoItems = bidder.items.filter((item) => item.photo_attachment?.buffer);
            if (photoItems.length === 0) {
                return;
            }

            const columns = 3;
            const gap = 10;
            const cardWidth = (pageWidth() - (gap * (columns - 1))) / columns;
            const imageHeight = 92;
            const captionHeight = 16;
            const cardHeight = imageHeight + captionHeight + 18;

            ensureSpace(24 + cardHeight);
            pdf.font("Helvetica-Bold").fontSize(10).fillColor("#111827")
                .text("Item Photos", layout.margin, state.cursorY, {
                    width: pageWidth(),
                    align: "left"
                });
            state.cursorY += 16;

            for (let index = 0; index < photoItems.length; index += columns) {
                const row = photoItems.slice(index, index + columns);
                ensureSpace(cardHeight);
                row.forEach((item, columnIndex) => {
                    const attachment = item.photo_attachment;
                    if (!attachment?.buffer) return;

                    const cardX = layout.margin + (columnIndex * (cardWidth + gap));
                    const cardY = state.cursorY;
                    const imageBoxY = cardY + 4;
                    const fitHeight = Math.max(40, imageHeight - 8);
                    const fitWidth = Math.max(40, cardWidth - 12);

                    pdf.save();
                    pdf.roundedRect(cardX, cardY, cardWidth, cardHeight - 4, 8)
                        .fillAndStroke("#ffffff", "#d1d5db");
                    pdf.restore();

                    try {
                        pdf.image(attachment.buffer, cardX + 6, imageBoxY + 4, {
                            fit: [fitWidth, fitHeight],
                            align: "center",
                            valign: "center"
                        });
                    } catch (_error) {
                        pdf.save();
                        pdf.rect(cardX + 6, imageBoxY + 4, fitWidth, fitHeight)
                            .stroke("#d1d5db");
                        pdf.restore();
                    }

                    pdf.font("Helvetica").fontSize(8).fillColor("#111827")
                        .text(`Lot ${item.item_number ?? ""}`, cardX + 6, cardY + imageHeight + 4, {
                            width: cardWidth - 12,
                            align: "center"
                        });
                });
                state.cursorY += cardHeight;
            }

            state.cursorY += 8;
        }

        reportData.bidders.forEach((bidder, index) => {
            if (index === 0) {
                drawReportIntro();
            } else {
                ensureSpace(layout.sectionGap + 32);
            }

            drawBidderSummaryCard(bidder);
            drawBidderItemsTable(bidder);
            drawBidderPhotos(bidder);
            state.cursorY += layout.sectionGap;
        });

        if (state.pageNumber === 0) {
            addPage();
            drawReportIntro();
        }

        return pdf;
    }

    function getManualEntrySheetLayout() {
        return {
            margin: 36,
            headerHeight: 48,
            footerHeight: 24,
            headerRowHeight: 24,
            rowHeight: 34
        };
    }

    function drawManualEntrySheetPage(pdf, pageItems, context) {
        const {
            auctionName,
            preparedAt,
            pageNumber,
            totalPages
        } = context;

        const pageWidth = pdf.page.width;
        const pageHeight = pdf.page.height;
        const {
            margin,
            headerHeight,
            footerHeight,
            headerRowHeight,
            rowHeight
        } = getManualEntrySheetLayout();
        const tableTop = margin + headerHeight;
        const tableBottom = pageHeight - margin - footerHeight;
        const tableWidth = pageWidth - (margin * 2);
        const columnWidths = [60, tableWidth - 60 - 96 - 96, 96, 96];
        const borderColor = '#444444';
        const headerFill = '#D9D9D9';
        const altRowFill = '#F2F2F2';
        const pageLabel = `Page ${pageNumber} of ${totalPages}`;

        let cursorY = tableTop;

        pdf.font('Helvetica-Bold').fontSize(14).fillColor('#000000')
            .text(auctionName || 'Auction', margin, margin, {
                width: tableWidth,
                align: 'left'
            });
        pdf.font('Helvetica').fontSize(9)
            .text(`Prepared: ${preparedAt}`, margin, margin + 18, {
                width: tableWidth,
                align: 'left'
            });

        const drawRowCells = (rowY, fillColor = null) => {
            let cellX = margin;
            for (const cellWidth of columnWidths) {
                pdf.save();
                pdf.lineWidth(0.75);
                pdf.strokeColor(borderColor);
                if (fillColor) {
                    pdf.fillColor(fillColor).rect(cellX, rowY, cellWidth, rowHeight).fillAndStroke(fillColor, borderColor);
                } else {
                    pdf.rect(cellX, rowY, cellWidth, rowHeight).stroke();
                }
                pdf.restore();
                cellX += cellWidth;
            }
        };

        const drawHeaderCells = (rowY) => {
            let cellX = margin;
            for (const cellWidth of columnWidths) {
                pdf.save();
                pdf.lineWidth(0.9);
                pdf.strokeColor(borderColor);
                pdf.fillColor(headerFill).rect(cellX, rowY, cellWidth, headerRowHeight).fillAndStroke(headerFill, borderColor);
                pdf.restore();
                cellX += cellWidth;
            }
        };

        drawHeaderCells(cursorY);
        pdf.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
        pdf.text('Item #', margin + 6, cursorY + 7, { width: columnWidths[0] - 12, align: 'left' });
        pdf.text('Item Name', margin + columnWidths[0] + 6, cursorY + 7, { width: columnWidths[1] - 12, align: 'left' });
        pdf.text('Bidder', margin + columnWidths[0] + columnWidths[1] + 6, cursorY + 7, { width: columnWidths[2] - 12, align: 'left' });
        pdf.text('Price', margin + columnWidths[0] + columnWidths[1] + columnWidths[2] + 6, cursorY + 7, { width: columnWidths[3] - 12, align: 'left' });

        cursorY += headerRowHeight;

        pageItems.forEach((item, index) => {
            const rowY = cursorY + (index * rowHeight);
            drawRowCells(rowY, index % 2 === 1 ? altRowFill : null);

            pdf.font('Helvetica').fontSize(12).fillColor('#000000');
            pdf.text(String(item.item_number ?? ''), margin + 6, rowY + 10, {
                width: columnWidths[0] - 12,
                height: rowHeight - 12,
                ellipsis: true
            });
            pdf.text(item.description || '', margin + columnWidths[0] + 6, rowY + 8, {
                width: columnWidths[1] - 12,
                height: rowHeight - 12,
                ellipsis: true
            });
        });

        pdf.font('Helvetica').fontSize(9).fillColor('#000000')
            .text(pageLabel, margin, pageHeight - margin - 8, {
                width: tableWidth,
                align: 'center'
            });

        pdf.save();
        pdf.lineWidth(0.75);
        pdf.strokeColor(borderColor);
        pdf.moveTo(margin, tableBottom)
            .lineTo(margin + tableWidth, tableBottom)
            .stroke();
        pdf.restore();
    }

    function streamManualEntrySheetPdf(res, items, { auctionName, preparedAt, filename }) {
        const pdf = new PDFDocument({
            size: 'A4',
            layout: 'portrait',
            margin: 0,
            autoFirstPage: false
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        pdf.pipe(res);

        const { margin, headerHeight, footerHeight, headerRowHeight, rowHeight } = getManualEntrySheetLayout();
        const pageHeight = mmToPoints(297);
        const usableHeight = pageHeight - (margin * 2) - headerHeight - footerHeight - headerRowHeight;
        const itemsPerPage = Math.max(1, Math.floor(usableHeight / rowHeight));
        const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));

        for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
            const pageItems = items.slice(pageIndex * itemsPerPage, (pageIndex + 1) * itemsPerPage);
            pdf.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
            drawManualEntrySheetPage(pdf, pageItems, {
                auctionName,
                preparedAt,
                pageNumber: pageIndex + 1,
                totalPages
            });
        }

        return pdf;
    }

    function updateLastPrintForItems(auctionId, itemIds, printStamp) {
        return updateItemExportTracking(auctionId, itemIds, "slips", printStamp);
    }

    app.post('/generate-pptx', authenticateRole("admin"), async (req, res) => {
        let selection;
        try {
            selection = resolveExportSelection(req.body || {}, "slides");
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                error: error.message,
                ...(error.missing_item_numbers ? { missing_item_numbers: error.missing_item_numbers } : {})
            });
        }

        const asyncRequested = req.body?.async === true || req.body?.async === "true";
        const activeJob = getActivePptxJob();
        if (activeJob) {
            return res.status(409).json({
                error: `A PPTX export is already in progress (${activeJob.exportType})`,
                job: serialisePptxJob(activeJob)
            });
        }

        const job = createPptxJob({
            auctionId: selection.auctionId,
            exportType: "slides",
            selectionMode: selection.selectionMode,
            itemRange: selection.itemRange,
            itemCount: selection.items.length,
            retainOutputFile: asyncRequested
        });
        logFromRequest(req, logLevels.DEBUG, `Slide generation requested for auction ${selection.auctionId} (${selection.items.length} item(s), mode=${selection.selectionMode})`);

        if (asyncRequested) {
            void runPptxJob(job, () => buildSlidesPptx(req, selection.auctionId, selection.items, job))
                .catch((error) => {
                    logFromRequest(req, logLevels.ERROR, `Async slide generation failed for auction ${selection.auctionId}: ${error.message}`);
                });
            return res.status(202).json({
                message: "Slide generation started",
                job: serialisePptxJob(job)
            });
        }

        try {
            const result = await runPptxJob(job, () => buildSlidesPptx(req, selection.auctionId, selection.items, job));
            if (job.status === "cancelled") {
                return res.status(409).json({ error: "Slide generation cancelled", job: serialisePptxJob(job) });
            }
            if (job.status !== "completed" || !result?.outputFile) {
                return res.status(500).json({ error: job.errorMessage || "Slide generation failed" });
            }

            return res.download(result.outputFile, result.downloadName, (downloadError) => {
                removePptxJobOutput(job);
                if (downloadError) {
                    logFromRequest(req, logLevels.ERROR, `Slide download failed for auction ${selection.auctionId}: ${downloadError.message}`);
                }
            });
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Slide generation failed for auction ${selection.auctionId}: ${error.message}`);
            return res.status(500).json({ error: error.message });
        }
    });

    app.post('/generate-cards', authenticateRole("admin"), async (req, res) => {
        let selection;
        try {
            selection = resolveExportSelection(req.body || {}, "cards");
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                error: error.message,
                ...(error.missing_item_numbers ? { missing_item_numbers: error.missing_item_numbers } : {})
            });
        }

        const asyncRequested = req.body?.async === true || req.body?.async === "true";
        const activeJob = getActivePptxJob();
        if (activeJob) {
            return res.status(409).json({
                error: `A PPTX export is already in progress (${activeJob.exportType})`,
                job: serialisePptxJob(activeJob)
            });
        }

        const job = createPptxJob({
            auctionId: selection.auctionId,
            exportType: "cards",
            selectionMode: selection.selectionMode,
            itemRange: selection.itemRange,
            itemCount: selection.items.length,
            retainOutputFile: asyncRequested
        });
        logFromRequest(req, logLevels.DEBUG, `Card generation requested for auction ${selection.auctionId} (${selection.items.length} item(s), mode=${selection.selectionMode})`);

        if (asyncRequested) {
            void runPptxJob(job, () => buildCardsPptx(req, selection.auctionId, selection.items, job))
                .catch((error) => {
                    logFromRequest(req, logLevels.ERROR, `Async card generation failed for auction ${selection.auctionId}: ${error.message}`);
                });
            return res.status(202).json({
                message: "Card generation started",
                job: serialisePptxJob(job)
            });
        }

        try {
            const result = await runPptxJob(job, () => buildCardsPptx(req, selection.auctionId, selection.items, job));
            if (job.status === "cancelled") {
                return res.status(409).json({ error: "Card generation cancelled", job: serialisePptxJob(job) });
            }
            if (job.status !== "completed" || !result?.outputFile) {
                return res.status(500).json({ error: job.errorMessage || "Card generation failed" });
            }

            return res.download(result.outputFile, result.downloadName, (downloadError) => {
                removePptxJobOutput(job);
                if (downloadError) {
                    logFromRequest(req, logLevels.ERROR, `Card download failed for auction ${selection.auctionId}: ${downloadError.message}`);
                }
            });
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Card generation failed for auction ${selection.auctionId}: ${error.message}`);
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/export-jobs/pptx/status', authenticateRole("admin"), (req, res) => {
        return res.json({ job: serialisePptxJob(getActivePptxJob() || pptxExportState.last) });
    });

    app.post('/export-jobs/pptx/cancel', authenticateRole("admin"), (req, res) => {
        const activeJob = getActivePptxJob();
        if (!activeJob) {
            return res.status(409).json({ error: "No PPTX export is currently running" });
        }

        const requestedJobId = req.body?.job_id ? String(req.body.job_id) : null;
        if (requestedJobId && requestedJobId !== activeJob.id) {
            return res.status(409).json({
                error: "The active PPTX export does not match the requested job id",
                job: serialisePptxJob(activeJob)
            });
        }

        activeJob.cancelRequested = true;
        if (activeJob.status === "queued" || activeJob.status === "running") {
            activeJob.status = "cancelling";
        }
        logFromRequest(req, logLevels.INFO, `PPTX export cancel requested for job ${activeJob.id} (${activeJob.exportType})`);

        return res.json({
            message: "Cancellation requested",
            job: serialisePptxJob(activeJob)
        });
    });

    app.get('/export-jobs/pptx/download', authenticateRole("admin"), (req, res) => {
        const requestedJobId = String(req.query.job_id || "").trim();
        const job = pptxExportState.last;

        if (!requestedJobId) {
            return res.status(400).json({ error: "Missing job_id" });
        }
        if (!job || job.id !== requestedJobId) {
            return res.status(404).json({ error: "Export job not found" });
        }
        if (job.status !== "completed" || !job.outputFile || !fs.existsSync(job.outputFile)) {
            return res.status(409).json({ error: "Export file is not available for download" });
        }

        return res.download(job.outputFile, job.downloadName || path.basename(job.outputFile));
    });

    app.get('/auctions/:auctionId/items/print-slip', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        try {
            const selection = resolveExportSelection({
                auction_id: auctionId,
                selection_mode: req.query.selection_mode,
                scope: req.query.scope,
                item_range: req.query.item_range
            }, "slips");

            const slipConfig = await loadNormalizedSlipConfig(req);
            const filenameSuffix = selection.selectionMode === "range"
                ? "selected"
                : (selection.selectionMode === "needs-attention" ? "needs_print" : "all");
            const filename = `auction_${auctionId}_item_slips_${filenameSuffix}.pdf`;
            const pdf = streamSlipPdf(res, selection.items, slipConfig, filename);
            logFromRequest(
                req,
                logLevels.INFO,
                `Generated batch slip PDF for auction ${auctionId}: ${selection.items.length} item(s), mode=${selection.selectionMode}`
            );
            pdf.end();
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Batch slip generation failed for auction ${auctionId}: ${error.message}`);
            if (!res.headersSent) {
                return res.status(error.statusCode || 500).json({
                    error: error.statusCode ? error.message : "Failed to generate item slip PDF",
                    ...(error.details ? { details: error.details } : {})
                });
            }
        }
    });

    app.get('/auctions/:auctionId/items/manual-entry-sheet', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        try {
            const selectionMode = normaliseExportSelectionMode(req.query.selection_mode, req.query.scope);
            if (selectionMode !== "all") {
                return res.status(400).json({ error: 'Manual item entry sheet only supports "all items"' });
            }

            const selection = resolveExportSelection({
                auction_id: auctionId,
                selection_mode: 'all'
            }, "csv");
            const auction = loadAuctionSummary(auctionId);

            if (!auction) {
                return res.status(404).json({ error: "Auction not found" });
            }

            const preparedAt = formatPreparedTimestamp();
            const safeShortName = String(auction.short_name || auctionId)
                .trim()
                .replace(/[^a-z0-9_-]+/gi, '_');
            const filename = `auction_${safeShortName}_manual_entry_sheet.pdf`;
            const pdf = streamManualEntrySheetPdf(res, selection.items, {
                auctionName: auction.full_name || auction.short_name || `Auction ${auctionId}`,
                preparedAt,
                filename
            });

            audit(getAuditActor(req), 'generate manual entry sheet', 'auction', auctionId, {
                auction_id: auctionId,
                item_count: selection.items.length,
                selection_mode: 'all',
                generated_at: preparedAt
            });
            logFromRequest(req, logLevels.INFO, `Generated manual entry sheet PDF for auction ${auctionId}: ${selection.items.length} item(s)`);
            pdf.end();
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Manual entry sheet generation failed for auction ${auctionId}: ${error.message}`);
            if (!res.headersSent) {
                return res.status(error.statusCode || 500).json({
                    error: error.statusCode ? error.message : "Failed to generate manual entry sheet PDF"
                });
            }
        }
    });

    app.get('/auctions/:auctionId/report-pdf', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        try {
            const selectionMode = normaliseExportSelectionMode(req.query.selection_mode, req.query.scope);
            if (selectionMode !== "all") {
                return res.status(400).json({ error: 'Auction report PDF only supports "all items"' });
            }

            const selection = resolveExportSelection({
                auction_id: auctionId,
                selection_mode: 'all'
            }, "csv");
            const reportData = computeAuctionReportData(auctionId, selection.items);
            const preparedAt = formatPreparedTimestamp();
            const safeShortName = String(reportData.auction.short_name || auctionId)
                .trim()
                .replace(/[^a-z0-9_-]+/gi, '_');
            const filename = `auction_${safeShortName}_report.pdf`;
            const pdf = streamAuctionReportPdf(res, reportData, {
                auctionName: reportData.auction.full_name || reportData.auction.short_name || `Auction ${auctionId}`,
                preparedAt,
                username: req.user?.username || getAuditActor(req) || "unknown",
                filename
            });

            audit(getAuditActor(req), 'generate auction report', 'auction', auctionId, {
                auction_id: auctionId,
                item_count: selection.items.length,
                selection_mode: 'all',
                generated_at: preparedAt
            });
            logFromRequest(req, logLevels.INFO, `Generated auction report PDF for auction ${auctionId}: ${selection.items.length} item(s)`);
            pdf.end();
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Auction report generation failed for auction ${auctionId}: ${error.message}`);
            if (!res.headersSent) {
                return res.status(error.statusCode || 500).json({
                    error: error.statusCode ? error.message : "Failed to generate auction report PDF"
                });
            }
        }
    });

    app.get('/auctions/:auctionId/bidder-report-pdf', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        try {
            const bidderMode = normaliseBidderReportMode(req.query.bidder_mode);
            const reportData = await loadBidderReportData(auctionId, bidderMode);
            const preparedAt = formatPreparedTimestamp();
            const safeShortName = String(reportData.auction.short_name || auctionId)
                .trim()
                .replace(/[^a-z0-9_-]+/gi, '_');
            const filenameSuffix = bidderMode === "all" ? "all" : bidderMode;
            const filename = `auction_${safeShortName}_bidder_report_${filenameSuffix}.pdf`;
            const pdf = streamBidderReportPdf(res, reportData, {
                auctionName: reportData.auction.full_name || reportData.auction.short_name || `Auction ${auctionId}`,
                preparedAt,
                username: req.user?.username || getAuditActor(req) || "unknown",
                filename
            });

            audit(getAuditActor(req), 'generate bidder report', 'auction', auctionId, {
                auction_id: auctionId,
                bidder_count: reportData.bidders.length,
                bidder_mode: bidderMode,
                generated_at: preparedAt
            });
            logFromRequest(req, logLevels.INFO, `Generated bidder report PDF for auction ${auctionId}: ${reportData.bidders.length} bidder(s), mode=${bidderMode}`);
            pdf.end();
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Bidder report generation failed for auction ${auctionId}: ${error.message}`);
            if (!res.headersSent) {
                return res.status(error.statusCode || 500).json({
                    error: error.statusCode ? error.message : "Failed to generate bidder report PDF"
                });
            }
        }
    });

    app.get('/auctions/:auctionId/items/:id/print-slip', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        const itemId = Number(req.params.id);

        if (!auctionId || !itemId) {
            return res.status(400).json({ error: "Invalid auction id or item id" });
        }

        try {
            const item = db.get(
                `SELECT i.id,
                        i.item_number,
                        i.description,
                        i.contributor,
                        i.artist,
                        i.notes,
                        b.paddle_number,
                        IFNULL(b.name, '') AS bidder_name,
                        CASE
                            WHEN b.paddle_number IS NOT NULL AND IFNULL(b.name, '') <> '' THEN b.paddle_number || ' - ' || b.name
                            WHEN b.paddle_number IS NOT NULL THEN CAST(b.paddle_number AS TEXT)
                            ELSE ''
                        END AS bidder_label
                   FROM items i
              LEFT JOIN bidders b ON b.id = i.winning_bidder_id
                  WHERE i.id = ? AND i.auction_id = ?
                    AND COALESCE(i.is_deleted, 0) = 0`,
                [itemId, auctionId]
            );

            if (!item) {
                return res.status(400).json({ error: "Item not found" });
            }

            const slipConfig = await loadNormalizedSlipConfig(req);
            const pdf = streamSlipPdf(
                res,
                [item],
                slipConfig,
                `item_${item.item_number || item.id}_slip.pdf`
            );
            logFromRequest(req, logLevels.INFO, `Generated slip PDF for item ID ${itemId} (number ${item.item_number}) in auction ${auctionId}`);
            pdf.end();
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Slip generation failed for item ${itemId}: ${error.message}`);
            if (!res.headersSent) {
                return res.status(error.statusCode || 500).json({
                    error: error.statusCode ? error.message : "Failed to generate item slip PDF",
                    ...(error.details ? { details: error.details } : {})
                });
            }
        }
    });

    app.post('/auctions/:auctionId/items/confirm-slip-print', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        const rawIds = Array.isArray(req.body?.item_ids) ? req.body.item_ids : null;
        if (!rawIds || rawIds.length === 0) {
            return res.status(400).json({ error: "item_ids must be a non-empty array" });
        }

        const itemIds = Array.from(new Set(
            rawIds
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id > 0)
        ));

        if (itemIds.length === 0) {
            return res.status(400).json({ error: "item_ids must contain one or more valid item ids" });
        }

        try {
            const placeholders = itemIds.map(() => "?").join(",");
            const foundRows = db.all(
                `SELECT id
                 FROM items
                 WHERE auction_id = ?
                   AND COALESCE(is_deleted, 0) = 0
                   AND id IN (${placeholders})`,
                [auctionId, ...itemIds]
            );
            const foundIdSet = new Set((foundRows || []).map((row) => Number(row.id)));
            const missingIds = itemIds.filter((id) => !foundIdSet.has(id));
            if (missingIds.length > 0) {
                return res.status(400).json({
                    error: "One or more item_ids were not found in this auction",
                    missing_item_ids: missingIds
                });
            }

            const printStamp = strftime('%d-%m-%Y %H:%M:%S');
            const updatedCount = updateLastPrintForItems(auctionId, itemIds, printStamp);
            if (updatedCount !== itemIds.length) {
                throw new Error(`Unable to store print timestamp for all items (${updatedCount}/${itemIds.length})`);
            }

            if (itemIds.length === 1) {
                audit(getAuditActor(req), 'print slip', 'item', itemIds[0], {
                    auction_id: auctionId,
                    printed_at: printStamp,
                    confirmed: true
                });
            } else {
                audit(getAuditActor(req), 'print slip batch', 'auction', auctionId, {
                    auction_id: auctionId,
                    printed_at: printStamp,
                    confirmed: true,
                    item_count: itemIds.length
                });
            }

            logFromRequest(req, logLevels.INFO, `Confirmed slip print for ${itemIds.length} item(s) in auction ${auctionId}`);
            return res.json({
                message: `Updated print status for ${itemIds.length} item(s)`,
                updated_count: itemIds.length,
                printed_at: printStamp
            });
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Slip print confirmation failed for auction ${auctionId}: ${error.message}`);
            return res.status(500).json({ error: "Failed to confirm slip print" });
        }
    });

    app.post('/auctions/:auctionId/items/reset-export-tracking', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        const exportType = String(req.body?.export_type || "").trim().toLowerCase();
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }
        if (!["slides", "cards", "slips"].includes(exportType)) {
            return res.status(400).json({ error: "Invalid export_type. Use slides, cards, or slips" });
        }

        try {
            const clearedCount = resetItemExportTracking(auctionId, exportType);
            const exportLabel = getExportDisplayLabel(exportType);
            audit(getAuditActor(req), `reset ${exportLabel} tracking`, 'auction', auctionId, {
                auction_id: auctionId,
                export_type: exportType,
                cleared_count: clearedCount
            });
            logFromRequest(req, logLevels.INFO, `Reset ${exportLabel} tracking for auction ${auctionId}: ${clearedCount} item(s)`);

            return res.json({
                message: `Cleared ${exportLabel} tracking for ${clearedCount} item(s)`,
                export_type: exportType,
                updated_count: clearedCount
            });
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Reset export tracking failed for auction ${auctionId}: ${error.message}`);
            return res.status(500).json({ error: "Failed to reset export tracking" });
        }
    });

    // app.post('/auctions/:auctionId/items/reset-slip-print', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
    //     const auctionId = Number(req.params.auctionId);
    //     if (!auctionId) {
    //         return res.status(400).json({ error: "Invalid auction id" });
    //     }

    //     try {
    //         const clearedCount = resetItemExportTracking(auctionId, "slips");
    //         audit(getAuditActor(req), 'reset slip print tracking', 'auction', auctionId, {
    //             auction_id: auctionId,
    //             export_type: "slips",
    //             cleared_count: clearedCount
    //         });
    //         logFromRequest(req, logLevels.INFO, `Reset slip print tracking for auction ${auctionId}: ${clearedCount} item(s)`);

    //         return res.json({
    //             message: `Cleared slip print tracking for ${clearedCount} item(s)`,
    //             updated_count: clearedCount
    //         });
    //     } catch (error) {
    //         logFromRequest(req, logLevels.ERROR, `Reset slip print tracking failed for auction ${auctionId}: ${error.message}`);
    //         return res.status(500).json({ error: "Failed to reset slip print tracking" });
    //     }
    // });

    app.post('/export-csv', authenticateRole("admin"), (req, res) => {
        let selection;
        try {
            selection = resolveExportSelection(req.body || {}, "csv");
        } catch (error) {
            return res.status(error.statusCode || 500).json({
                error: error.message,
                ...(error.missing_item_numbers ? { missing_item_numbers: error.missing_item_numbers } : {})
            });
        }

        try {
            const itemIds = selection.items.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0);
            const itemRows = itemIds.length === 0
                ? []
                : db.all(
                    `SELECT i.*,
                            b.paddle_number,
                            IFNULL(b.name, '') AS bidder_name
                       FROM items i
                  LEFT JOIN bidders b ON b.id = i.winning_bidder_id
                      WHERE i.auction_id = ?
                        AND COALESCE(i.is_deleted, 0) = 0
                        AND i.id IN (${itemIds.map(() => "?").join(",")})
                   ORDER BY i.item_number ASC`,
                    [selection.auctionId, ...itemIds]
                );

            const parser = new Parser({ fields: ['id', 'description', 'contributor', 'artist', 'photo', 'date', 'notes', 'mod_date', 'auction_id', 'item_number', 'paddle_number', 'bidder_name', 'hammer_price'] });
            const csv = parser.parse(itemRows);
            const filePath = path.join(OUTPUT_DIR, 'auction_data.csv');
            fs.writeFileSync(filePath, csv);
            logFromRequest(req, logLevels.INFO, `CSV export generated for auction ${selection.auctionId} (${itemRows.length} item(s), mode=${selection.selectionMode})`);

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader("Content-Disposition", `attachment; filename=auction_${selection.auctionId}_items.csv`);
            res.end('\uFEFF' + csv);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });
}

module.exports = {
    registerExportRoutes
};
