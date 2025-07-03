let cropper;
document.addEventListener("DOMContentLoaded", function () {
    const loginSection = document.getElementById("login-section");
    const adminSection = document.getElementById("admin-section");
    const editSection = document.getElementById("edit-section");
    const loginButton = document.getElementById("login-button");
    const logoutButton = document.getElementById("logout");
    const itemsTableBody = document.getElementById("items-table-body");
    const editForm = document.getElementById("edit-form");
    const deleteButton = document.getElementById("delete-item");
    const cancelEditButton = document.getElementById("cancel-edit");
    const editPhotoInput = document.getElementById("edit-photo");
    const exportCSVButton = document.getElementById("export-csv");
    const generatePPTButton = document.getElementById("generate-ppt");
    const generateCardsButton = document.getElementById("generate-cards");
    const addSection = document.getElementById("add-section");
    const addForm = document.getElementById("add-form");
    const cancelAddButton = document.getElementById("cancel-add");
    const addPhotoInput = document.getElementById("add-photo");
    const editLivePhotoInput = document.getElementById("edit-photo-live");
    const addItemButton = document.getElementById("add-item");
    const refreshButton = document.getElementById("refresh");
    const liveFeedButton = document.getElementById("livefeed");
    const publicButton = document.getElementById("public");

    

    let currentEditId = null;
    let modifiedImages = {};
    let auctions = [];
    let selectedAuctionId = null;
    let selectedOrder = sessionStorage.getItem("item_sort_order") || "asc";
    let selectedSort = sessionStorage.getItem("item_sort_field") || "item_number";

    document.getElementById("sort-field").value = selectedSort;
    document.getElementById("sort-order").value = selectedOrder;

    // controls whether to show bidder & amount columns
    const showBidStates = ['live', 'settlement', 'archived'];

    const fmtPrice = v => `£${Number(v).toFixed(2)}`;

    //  const API = "https://moments.icychris.co.uk:3001";
  //  const API = "https://drive.icychris.co.uk";
const API = "/api"



    // Check if admin is already authenticated
    async function checkToken() {
        const token = localStorage.getItem("token");
        //   console.log(token);
        if (token) {
            const response = await fetch(`${API}/validate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
            });
            const data = await response.json();
            if (response.ok) {
                loginSection.style.display = "none";
                adminSection.style.display = "block";
                await loadAuctions();
                loadItems();
                startAutoRefresh();
            } else {
                logout();
                document.getElementById("error-message").innerText = data.error;
                showMessage("Authentication: " + data.error, "error");
            }
        }
    }

    checkToken();

    const auctionSelect = document.getElementById("auction-select");
    const orderSelect = document.getElementById("sort-order");
    const sortSelect = document.getElementById("sort-field");

    //  let selectedAuctionId = null;

    async function loadAuctions() {
        const token = localStorage.getItem("token");
        const res = await fetch(`${API}/list-auctions`, {
            method: "POST",
            headers: {
                "Authorization": token,
                "Content-Type": "application/json"
            },
        });
        auctions = await res.json();

        if (auctions.length === 0) {
        showMessage("No auctions defined. Use the maintenance interface to add one", "info");
        return;
}

        auctionSelect.innerHTML = "";

        auctions.forEach(auction => {
            const opt = document.createElement("option");
            opt.value = auction.id;
            opt.textContent = `${auction.full_name} - ${auction.status}`;
            auctionSelect.appendChild(opt);
        });

        // Preselect from URL or sessionStorage
        const urlParam = new URLSearchParams(window.location.search).get("auction");
        const storedAuctionId = sessionStorage.getItem("auction_id");

        if (urlParam) {
            const match = auctions.find(a => a.short_name === urlParam);
            if (match) auctionSelect.value = match.id;
        } else if (storedAuctionId) {
            auctionSelect.value = storedAuctionId;
        }

        selectedAuctionId = parseInt(auctionSelect.value, 10);
        sessionStorage.setItem("auction_id", selectedAuctionId);
        //      console.log(selectedAuctionId);

        if (window.refreshAuctionStatus) {        // get status first
            await window.refreshAuctionStatus();
        }
        loadItems();                              // now build the table


    }

    auctionSelect.addEventListener("change", async () => {
        selectedAuctionId = parseInt(auctionSelect.value, 10);
        sessionStorage.setItem("auction_id", selectedAuctionId);
        await window.refreshAuctionStatus();
        loadItems();
        //    updateAddButtonState();
        if (window.refreshAuctionStatus) window.refreshAuctionStatus();

    });

    orderSelect.addEventListener("change", () => {
        selectedOrder = orderSelect.value;
        sessionStorage.setItem("item_sort_order", selectedOrder);
        loadItems();
    });

    sortSelect.addEventListener("change", () => {
        selectedSort = sortSelect.value;
        sessionStorage.setItem("item_sort_field", selectedSort);
        loadItems();
    });


    loginButton.addEventListener("click", async function login() {
        const password = document.getElementById("admin-password").value;
        const response = await fetch(`${API}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // body: JSON.stringify({ password })
            body: JSON.stringify({ password, role: "admin" })
        });
        document.getElementById("admin-password").value = "";
        const data = await response.json();
        if (response.ok) {
            localStorage.setItem("token", data.token);
            loginSection.style.display = "none";
            adminSection.style.display = "block";

            loadAuctions();
            loadItems();
            startAutoRefresh();
            //            console.log(localStorage.getItem("token"));
        } else {
            showMessage("Login failed: " + data.error, "error");
            document.getElementById("error-message").innerText = data.error;
        }
    })

    logoutButton.addEventListener("click", function () {
        logout();
        //   localStorage.removeItem("token");
        //   showMessage("Returning to public page", "info");
        //   window.location.href = '/index.html';

    })


    addItemButton.addEventListener("click", function () {
        addSection.style.display = "block";
        adminSection.style.display = "none";
    });

    refreshButton.addEventListener("click", function () {
        loadItems();
        loadAuctions();
    })
    // Escaping "" and '' is becoming too much of a headache to fix, so we're just going to remove quotes from things if they get edited
    function removeQuotes(str) {
        if (typeof str !== "string" || str === null) return ""; // Handle null, undefined, and non-strings safely
        return str
            .replace(/['"]/g, "");  // Removes all single and double quotes
    }


    function logout() {
        localStorage.removeItem("token");
        loginSection.style.display = "block";
        adminSection.style.display = "none";
        editSection.style.display = "none";
        addSection.style.display = "none";
    }





    async function loadItems() {
        const token = localStorage.getItem("token");
        if (!token) return logout();

        //  const showBidCols = window.currentAuctionStatus === 'live';
        const showBidCols = showBidStates.includes(window.currentAuctionStatus);

        const auctionId = parseInt(selectedAuctionId, 10);
        //  console.log("Selected auction ID:", auctionId);

        if (!auctionId || isNaN(auctionId)) {
            //      console.log("Skipping loadItems: selectedAuctionId is invalid:", selectedAuctionId);
            return;
        }


        try {

            const response = await fetch(`${API}/auctions/${auctionId}/items?sort=${selectedOrder}&field=${selectedSort}`, { headers: { Authorization: token } })

            // Check for 403 (unauthorized)
            if (response.status === 403) {
                showMessage("Session expired. Please log in again.", "info");
                localStorage.removeItem("token");
                setTimeout(() => {
                    window.location.href = "/admin";
                }, 1500);
                return;
            }

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to load items");
            }

            // const data = await response.json();
            const { items, totals } = await response.json();

            // build the summary text

            document.getElementById("auction-total").textContent =
                `Total: £${(totals?.hammer_total || 0).toFixed(2)} (${totals.items_with_bids}/${totals.item_count})`;



            itemsTableBody.innerHTML = "";

            items.forEach(item => {

                // Escape quotes
                const escapedDescription = removeQuotes(item.description);
                const escapedContributor = removeQuotes(item.contributor);
                const escapedArtist = removeQuotes(item.artist);
                const escapedNotes = removeQuotes(item.notes);

                const encodedItem = encodeURIComponent(JSON.stringify({
                    id: item.id,
                    description: escapedDescription,
                    contributor: escapedContributor,
                    artist: escapedArtist,
                    photo: item.photo,
                    date: item.date,
                    notes: escapedNotes,
                    mod_date: item.mod_date,
                    item_number: item.item_number,
                    auction_id: item.auction_id
                }));

                const modToken = item.mod_date ? `?v=${encodeURIComponent(item.mod_date)}` : '';
                const imgSrc = item.photo ? `${API}/uploads/preview_${item.photo}${modToken}` : '';

                const row = document.createElement("tr");


                /* NEW — dataset hooks for the finalize‑lot add‑on */
                row.dataset.itemId = item.id;                         // used by add‑on
                row.dataset.sold = item.hammer_price ? "1" : "0";   // 1 = already sold
                row.dataset.item_number = item.item_number;
                row.dataset.description = item.description;

                row.innerHTML = `
                <td>${item.item_number}</td>
                <td>${escapedDescription}</td>
                <td>${escapedContributor}</td>
                <td>${escapedArtist}</td>
                <td>
                    ${item.photo ? `<img src='${imgSrc}' alt='Item Image' style="max-width:60px; cursor:pointer;" class="popup-image">` : 'No Image'}
                </td>

                ${showBidCols ? `
                    <td>${item.paddle_no ?? ''}</td>
                    <td>${fmtPrice(item.hammer_price ?? '')}</td>` : ''
                    }
                <td>
                    <button onclick="editItem('${encodedItem}')">Edit</button>
                    <button onclick="showItemHistory(${item.id})">History</button>
                    <button class="move-toggle" data-id="${item.id}">Move</button>
                    <div class="move-panel" data-id="${item.id}" style="display:none; margin-top: 5px;">
                        <select class="move-auction-select" data-id="${item.id}">
                        <option value="">Move to auction...</option>
                        ${auctions
                        .filter(a => a.id !== auctionId)
                        .map(a => {
                            const disabled = (a.status !== "setup" && a.status !== "locked") ? "disabled" : "";
                            const label = `${a.full_name} (${a.status})`;
                            return `<option value="${a.id}" ${disabled}>${label}</option>`;
                        })
                        .join("")}
                            </select>
                    <br/>
                    <select class="move-after-dropdown" data-id="${item.id}">
                    <option value="">Move after...</option>
                    ${items
                        .filter(i => i.id !== item.id)
                        .map(i => `<option value="${i.id}">After #${i.item_number} ${i.description.slice(0, 20)}</option>`)
                        .join("")}
                    </select>
                </div>
                </td>
            `;
                itemsTableBody.appendChild(row);
            });

            attachImagePopupEvent();

            document.querySelectorAll('.live-only').forEach(th => {
                th.style.display = showBidCols ? '' : 'none';
            });

            /* NEW — inject Finalize buttons once rows are in the DOM */
            if (window.enhanceFinalizeButtons) window.enhanceFinalizeButtons();


        } catch (error) {
            console.error("Error fetching items:", error);
            showMessage("Error fetching items: " + error.message, "error");
        }

        document.querySelectorAll(".move-toggle").forEach(button => {
            button.addEventListener("click", function () {
                const panel = this.nextElementSibling;
                panel.style.display = panel.style.display === "none" ? "block" : "none";
            });
        });

        document.querySelectorAll(".move-auction-select").forEach(select => {
            select.addEventListener("change", async function () {
                const currentEditId = parseInt(this.dataset.id, 10);
                const targetAuctionId = parseInt(this.value, 10);
                const token = localStorage.getItem("token");
                const auctionId = parseInt(selectedAuctionId, 10);


                if (!targetAuctionId || isNaN(targetAuctionId)) return;

                const formData = new FormData();
                formData.append("id", currentEditId);
                formData.append("target_auction_id", targetAuctionId);

                try {
                    const response = await fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
                        method: "POST",
                        body: formData,
                        headers: { Authorization: token }

                    })

                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || "Move failed");

                    showMessage("Item moved to different auction", "success");
                    loadItems(); // Refresh the list
                } catch (err) {
                    showMessage("Move failed: " + err.message, "error");
                }
            });
        });

     window.showItemHistory = async function editItem(itemId) {

    const token = localStorage.getItem("token");
    const modal = document.getElementById("history-modal");
    const tbody = document.getElementById("history-table-body");

    tbody.innerHTML = `<tr><td colspan="4" style="padding:6px;">Loading...</td></tr>`;
    modal.style.display = "flex";

    try {
        const res = await fetch(`${API}/items/${itemId}/history`, {
            headers: { Authorization: token }
        });

        if (!res.ok) throw new Error("Failed to load history");

        const history = await res.json();

        if (!Array.isArray(history) || history.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="padding:6px;">No history found for this item.</td></tr>`;
            return;
        }

        tbody.innerHTML = history.map(record => `
            <tr>
                <td style="padding:6px;">${record.created_at}</td>
                <td style="padding:6px;">${record.user || "?"}</td>
                <td style="padding:6px;">${record.action}</td>
                <td style="padding:6px;">${formatHistoryDetails(record.details)}</td>
            </tr>
        `).join("");

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:6px; color:red;">Error: ${err.message}</td></tr>`;
    }
}


     window.closeHistoryModal = function closeHistoryModal() {

// function closeHistoryModal() {
    document.getElementById("history-modal").style.display = "none";
}

function formatHistoryDetails(details) {
    if (!details) return "";

    return String(details)
        .replace(/^{|}$/g, "")       // remove surrounding { and }
        .replace(/"/g, "")           // remove quotes
        .replace(/,/g, ", ")         // add space after commas
        .replace(/:/g, ": ");        // add space after colons
}

    }


    document.getElementById("items-table-body").addEventListener("change", async function (e) {
        if (e.target.classList.contains("move-after-dropdown")) {
            const id = parseInt(e.target.dataset.id, 10);
            const after_id = e.target.value ? parseInt(e.target.value, 10) : null;
            showMessage(`Moving item....`, "info");

            this.disabled = true;
            const moveButton = this.previousElementSibling;
            if (moveButton) moveButton.disabled = true;

            const res = await fetch(`${API}/auctions/${selectedAuctionId}/items/${id}/move-after/${after_id}`, {

                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": localStorage.getItem("token")
                },
                body: JSON.stringify({
                    id,
                    after_id,
                    auction_id: selectedAuctionId
                })
            });

            const data = await res.json();
            if (res.ok) {
                showMessage(`Item moved`, "success");
                loadItems();
            } else {
                showMessage(data.error || "Failed to move item", "error");
            }
        }
    });


    function attachImagePopupEvent() {
        document.querySelectorAll(".popup-image").forEach(img => {
            img.addEventListener("click", function () {
                // Extract base filename and mod_date version from the preview image
                const previewSrc = this.src;
                const previewMatch = previewSrc.match(/\/preview_(.+?)(\?v=.*)?$/);

                if (!previewMatch) return;

                const filename = previewMatch[1]; // original photo filename
                const version = previewMatch[2] || ""; // ?v=mod_date

                const fullImageUrl = `${API}/uploads/${filename}${version}`;

                const popup = window.open("", "ImagePopup", "width=800,height=800");
                popup.document.write(`
                    <html>
                        <head><title>Image Preview</title></head>
                        <body style='margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#000;'>
                            <img src="${fullImageUrl}" style="max-width:100%;max-height:100%;">
                        </body>
                    </html>
                `);
            });
        });
    }

    addForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const formData = new FormData();
        formData.append("description", document.getElementById("add-description").value);
        formData.append("contributor", document.getElementById("add-contributor").value);
        formData.append("artist", document.getElementById("add-artist").value);
        formData.append("notes", document.getElementById("add-notes").value);

        const auctionId = parseInt(selectedAuctionId, 10);

        if (addPhotoInput.files.length > 0) {
            formData.append("photo", addPhotoInput.files[0]);
        }

        var token = localStorage.getItem("token");

        fetch(`${API}/auctions/${auctionId}/newitem`, {
            method: "POST",
            headers: { "Authorization": token },
            body: formData
        })

            .then(async res => {
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Unknown error");
                }

                //        alert("Item added successfully");
                showMessage("Item added successfully", "success");
                loadItems();
                document.getElementById("add-description").value = "";
                document.getElementById("add-contributor").value = "";
                document.getElementById("add-artist").value = "";
                document.getElementById("add-photo").value = "";
                document.getElementById("add-notes").value = "";

                addSection.style.display = "none";
                adminSection.style.display = "block";
            })
            .catch(error => {
                console.error("Error adding item:", error);
                showMessage("Error adding item: " + error, "error");
            })
    });

    cancelAddButton.addEventListener("click", function () {
        addSection.style.display = "none";
        adminSection.style.display = "block";
    });

    function startAutoRefresh() {
        setInterval(() => {
            if (document.visibilityState === "visible") {
                loadItems();
                loadAuctions();
            } else {
                //           console.log("Page not visible — skipping refresh");
            }
        }, 30000);
    }

    exportCSVButton.addEventListener("click", async function () {
        if (!selectedAuctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }

        var token = localStorage.getItem("token");
        if (!token) return logout();

        try {
            const res = await fetch(`${API}/export-csv`, {
                method: "POST",
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ auction_id: selectedAuctionId })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Export failed");
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");

            a.href = url;
            a.download = `auction_${selectedAuctionId}_items.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("CSV export error:", err);
            showMessage("Failed to export CSV", "error");
        }
    });

    generatePPTButton.addEventListener("click", async function () {
        if (!selectedAuctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }

        var token = localStorage.getItem("token");
        if (!token) return logout();

        try {
            const res = await fetch(`${API}/generate-pptx`, {
                method: "POST",
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ auction_id: selectedAuctionId })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Slide generation failed");
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `auction_${selectedAuctionId}_slides.pptx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Slide export error:", err);
            showMessage("Failed to generate slides:" + err, "error");
        }
    });

    generateCardsButton.addEventListener("click", async function () {
        if (!selectedAuctionId) {
            showMessage("Please select an auction first", "error");
            return;
        }
        var token = localStorage.getItem("token");
        if (!token) return logout();

        try {
            const res = await fetch(`${API}/generate-cards`, {
                method: "POST",
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ auction_id: selectedAuctionId })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Card generation failed");
            }

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `auction_${selectedAuctionId}_cards.pptx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Card export error:", err);
            showMessage("Failed to generate cards", "error");
        }
    });


    // Open the editor and get data
    window.editItem = function editItem(encodedData) {
        const item = JSON.parse(decodeURIComponent(encodedData));

        // Use the extracted values. Dates are recorded by the backend
        document.getElementById("edit-title").innerHTML = "<h2>Edit item #" + item.item_number + "</h2>";
        document.getElementById("edit-dates").innerHTML = "Created on: <b>" + item.date + "</b> Last modified: <b>" + item.mod_date + "</b> Database ID: <b>" + item.id + "</b>";


        document.getElementById("edit-id").value = item.id || "";
        document.getElementById("edit-description").value = item.description || "";
        document.getElementById("edit-contributor").value = item.contributor || "";
        document.getElementById("edit-artist").value = item.artist || "";
        document.getElementById("edit-notes").value = item.notes || "";
        document.getElementById("current-photo").src = item.photo;

        document.getElementById("edit-photo").value = "";
        document.getElementById("edit-photo-live").value = "";

        const hasPhoto = !!item.photo;

        document.getElementById("rotate-left").disabled = !hasPhoto;
        document.getElementById("rotate-right").disabled = !hasPhoto;
        document.getElementById("crop-image").disabled = !hasPhoto;

        if (item.photo && item.photo !== "null") {
            document.getElementById("current-photo").src = `${API}/uploads/${item.photo}?v=${encodeURIComponent(item.mod_date)}`;

        } else {
            document.getElementById("current-photo").src = "";

        }

        editSection.style.display = "block";
        adminSection.style.display = "none";
        currentEditId = item.id;
    };

    editForm.addEventListener("submit", function (event) {
        var token = localStorage.getItem("token");
        if (!token) return logout();
        event.preventDefault();

        const auctionId = parseInt(selectedAuctionId, 10);


        const formData = new FormData();
        formData.append("id", currentEditId); // Ensure the ID is sent
        formData.append("description", document.getElementById("edit-description").value.trim() || "");
        formData.append("contributor", document.getElementById("edit-contributor").value.trim() || "");
        formData.append("artist", document.getElementById("edit-artist").value.trim() || "");
        formData.append("notes", document.getElementById("edit-notes").value.trim() || "");
        formData.append("auction_id", auctionId);


        if (editLivePhotoInput.files.length > 0) {
            formData.append("photo", editLivePhotoInput.files[0]);
        } else if (editPhotoInput.files.length > 0) {
            formData.append("photo", editPhotoInput.files[0]);
        }

        fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
            method: "POST",
            body: formData,
            headers: { "Authorization": token }

        })

            .then(async res => {
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Unknown error");
                }

                //   .then(() => {
                //   alert("Item updated successfully");
                showMessage("Item updated successfully", "success");

                //			form.reset();

                const now = new Date().getTime();
                modifiedImages[currentEditId] = now;

                loadItems();
                setTimeout(() => {
                    modifiedImages = {};
                }, 3000); // clear it after a short while

                editSection.style.display = "none";
                adminSection.style.display = "block";
            })
            .catch(error => {
                console.error("Error updating item:", error);
                showMessage("Error updating item: " + error, "error");
            })
    });

    deleteButton.addEventListener("click", async function () {
        var token = localStorage.getItem("token");
        if (!token) return logout();

        const modal = await DayPilot.Modal.confirm("Are you sure you want to delete this item?");
        if (modal.canceled) {
            showMessage("Delete cancelled", "info");
            return;
        } else {
            fetch(`${API}/items/${currentEditId}`, {
                method: "DELETE",
                headers: { "Authorization": token }
            })
  //              .then(() => {
                .then(async res => {
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Unknown error");
                }

                    showMessage(`Item deleted successfully`, "success");
                    loadItems();
                    editSection.style.display = "none";
                    adminSection.style.display = "block";
                })
                .catch(error => {
                    console.error("Error deleting item:", error);
                    showMessage("Error deleting item: " + error, "error");
                })

        }
    });

    cancelEditButton.addEventListener("click", function () {
        editSection.style.display = "none";
        adminSection.style.display = "block";
    });

    const rotateLeftButton = document.getElementById("rotate-left");
    const rotateRightButton = document.getElementById("rotate-right");

    rotateLeftButton.addEventListener("click", () => rotateImage("left"));
    rotateRightButton.addEventListener("click", () => rotateImage("right"));

    function rotateImage(direction) {
        const token = localStorage.getItem("token");
        if (!token || !currentEditId) return;

        fetch(`${API}/rotate-photo`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": token
            },
            body: JSON.stringify({ id: currentEditId, direction })
        })
            .then(res => res.json())
            .then(data => {
                showMessage("Image rotated", "success");

                const currentPhoto = document.getElementById("current-photo");
                currentPhoto.src = currentPhoto.src.split("?")[0] + `?t=${new Date().getTime()}`; // Bust cache
                const now = new Date().getTime();
                modifiedImages[currentEditId] = now;
            })
            .catch(err => {
                console.error("Rotation error:", err);
                showMessage("Failed to rotate image", "error");
            });
    }

    const cropImageButton = document.getElementById("crop-image");
    const cropModal = document.getElementById("crop-modal");
    const cropTarget = document.getElementById("crop-target");
    const applyCropButton = document.getElementById("apply-crop");
    const cancelCropButton = document.getElementById("cancel-crop");

    cropImageButton.addEventListener("click", () => {
        var currentPhoto = document.getElementById("current-photo").src.replace(/preview_/, "");
        cropTarget.src = currentPhoto + `?t=${new Date().getTime()}`; // bust cache
        cropModal.style.display = "flex";

        setTimeout(() => {
            cropper = new Cropper(cropTarget, {
                aspectRatio: NaN,
                viewMode: 1,
                autoCropArea: 1,
            });
        }, 200);
    });

    cancelCropButton.addEventListener("click", () => {

        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
        cropModal.style.display = "none";
        //   editSection.style.display = "block";
        //   adminSection.style.display = "none";
    })


    applyCropButton.addEventListener("click", async function () {
        //    if (confirm("Are you sure you want to crop? (This isn't reversable!)")) {
        const modal = await DayPilot.Modal.confirm("Are you sure you want to crop? Change is applied immediately");
        if (modal.canceled) {
            showMessage("Delete cancelled", "info");
            return;
        } else {

            cropper.getCroppedCanvas().toBlob(blob => {
                const formData = new FormData();
                const auctionId = parseInt(selectedAuctionId, 10);

                formData.append("id", currentEditId);
                formData.append("description", document.getElementById("edit-description").value.trim() || "");
                formData.append("contributor", document.getElementById("edit-contributor").value.trim() || "");
                formData.append("artist", document.getElementById("edit-artist").value.trim() || "");
                formData.append("notes", document.getElementById("edit-notes").value.trim() || "");
                //       formData.append("auction_id", parseInt(document.getElementById("edit-auction").value, 10))
                formData.append("photo", blob, "cropped.jpg");

                const token = localStorage.getItem("token");
                // fetch(`${API}/update`, {
                //     method: "POST",
                //     body: formData,
                //     headers: { "Authorization": token }
                // })

                fetch(`${API}/auctions/${auctionId}/items/${currentEditId}/update`, {
                    method: "POST",
                    body: formData,
                    headers: { Authorization: token }
                })

                    .then(async res => {
                        if (!res.ok) {
                            const data = await res.json();
                            throw new Error(data.error || "Unknown error");
                        }
                        showMessage("Image cropped and saved", "success");
                        cropper.destroy();
                        cropModal.style.display = "none";
                        modifiedImages[currentEditId] = new Date().getTime();
                        loadItems();

                        const currentPhoto = document.getElementById("current-photo");
                        if (currentPhoto && currentPhoto.src) {
                            // Update the image with a cache-busting timestamp
                            currentPhoto.src = currentPhoto.src.split("?")[0] + `?t=${new Date().getTime()}`;
                        }
                    })
                    .catch(err => {
                        //                    console.log("caught");
                        cropper.destroy();
                        cropModal.style.display = "none";
                        showMessage("Cropping failed: " + err.message, "error");
                    });
            }, "image/jpeg", 0.9);
        }
    });

    // Button to open the live feed view
    liveFeedButton.addEventListener("click", function () {

        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const status = selectedAuction?.status;


        window.open(`/cashier/live-feed.html?auctionId=${selectedAuctionId}&auctionStatus=${status}`, '_blank').focus();


        //       frame.src = `${path}?auctionId=${auctionId}&auctionStatus=${status}`;

    })

    // Button to open the public page
    publicButton.addEventListener("click", function () {
        // look up the current shortname
        const selectedAuction = auctions.find(a => a.id === selectedAuctionId);
        const shortName = selectedAuction?.short_name;
        window.open(`/index.html?auction=` + shortName, '_blank').focus();

    })

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            //           console.log("Page became visible — refreshing now");
            loadItems();
        }





    });

    // document.getElementById("auction-select").addEventListener("change", function () {
    //     selectedAuctionId = parseInt(this.value, 10);
    //     loadItems(); // reload items
    //     updateAddButtonState();
    // });



});
