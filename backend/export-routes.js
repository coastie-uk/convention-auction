const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const pptxgen = require('pptxgenjs');
const PDFDocument = require('pdfkit');
const { Parser } = require('@json2csv/plainjs');
const strftime = require('strftime');

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
            `SELECT id,
                    item_number,
                    description,
                    contributor,
                    artist,
                    photo,
                    date,
                    notes,
                    mod_date,
                    text_mod_date,
                    last_print,
                    last_slide_export,
                    last_card_export,
                    auction_id,
                    winning_bidder_id,
                    hammer_price
               FROM items
              WHERE auction_id = ?
              ORDER BY item_number ASC`,
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
              WHERE auction_id = ?`,
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
            "SELECT COUNT(*) AS count FROM items WHERE auction_id = ?",
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

    app.get('/auctions/:auctionId/items/:id/print-slip', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        const itemId = Number(req.params.id);

        if (!auctionId || !itemId) {
            return res.status(400).json({ error: "Invalid auction id or item id" });
        }

        try {
            const item = db.get(
                `SELECT id, item_number, description, contributor, artist, notes
                 FROM items
                 WHERE id = ? AND auction_id = ?`,
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
                 WHERE auction_id = ? AND id IN (${placeholders})`,
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

    app.post('/auctions/:auctionId/items/reset-slip-print', authenticateRole("admin"), checkAuctionState(allowedStatuses), async (req, res) => {
        const auctionId = Number(req.params.auctionId);
        if (!auctionId) {
            return res.status(400).json({ error: "Invalid auction id" });
        }

        try {
            const clearedCount = resetItemExportTracking(auctionId, "slips");
            audit(getAuditActor(req), 'reset slip print tracking', 'auction', auctionId, {
                auction_id: auctionId,
                export_type: "slips",
                cleared_count: clearedCount
            });
            logFromRequest(req, logLevels.INFO, `Reset slip print tracking for auction ${auctionId}: ${clearedCount} item(s)`);

            return res.json({
                message: `Cleared slip print tracking for ${clearedCount} item(s)`,
                updated_count: clearedCount
            });
        } catch (error) {
            logFromRequest(req, logLevels.ERROR, `Reset slip print tracking failed for auction ${auctionId}: ${error.message}`);
            return res.status(500).json({ error: "Failed to reset slip print tracking" });
        }
    });

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
                            b.paddle_number
                       FROM items i
                  LEFT JOIN bidders b ON b.id = i.winning_bidder_id
                      WHERE i.auction_id = ?
                        AND i.id IN (${itemIds.map(() => "?").join(",")})
                   ORDER BY i.item_number ASC`,
                    [selection.auctionId, ...itemIds]
                );

            const parser = new Parser({ fields: ['id', 'description', 'contributor', 'artist', 'photo', 'date', 'notes', 'mod_date', 'auction_id', 'item_number', 'paddle_number', 'hammer_price'] });
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
