document.addEventListener("DOMContentLoaded", function () {
    const photoInput = document.getElementById("photo");
    const livephotoInput = document.getElementById("live-photo");
    const noPhotoCheckbox = document.getElementById("no-photo");
    const form = document.getElementById("auction-form");
    const submitButton = form.querySelector("button[type='submit']");
    const messageContainer = document.createElement("div");
    form.appendChild(messageContainer);
    let latestFile = null;
    let selectedAuctionId = null;
    let selectedAuctionName = null;
    const API = "/api";
    const auctionGate = document.getElementById("auction-gate");
    const submissionSection = document.getElementById("submission-section");
    const auctionCodeInput = document.getElementById("auction-code-input");
    const auctionSubmitBtn = document.getElementById("auction-code-submit");
    const auctionError = document.getElementById("auction-error-message");

    async function validateAuction(shortName) {

        try {

            const response = await fetch(`${API}/validate-auction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ short_name: shortName.trim() })
            })

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "Failed to validate");
            }

            // const data = await response.json();
            const data = await response.json();

            if (data.valid && data.status === "setup") {

                document.querySelector("header h1").textContent = data.full_name + "";
                const logoImg = document.getElementById("auction-logo");

                if (data.logo) {
                    logoImg.src = `${API}/resources/${encodeURIComponent(data.logo)}`;
                    logoImg.alt = data.short_name || "Auction Logo";
                    logoImg.style.display = "block";
                } else {
                    // Fallback: show a default logo
                    logoImg.src = `${API}/resources/default_logo.png`;
                    logoImg.alt = "Default Auction Logo";
                    logoImg.style.display = "block";
                }

                selectedAuctionId = data.id;
                selectedAuctionName = data.full_name;

                // Set this to assist
                sessionStorage.setItem("auction_id", data.id);

                showFormForAuction(data);
            }
            else if (data.valid && data.status !== "setup") {

                auctionGate.style.display = "block";
                showMessage("This auction is not currently accepting submissions", "error");

            } else {

                showMessage(data.error, "error");
                auctionGate.style.display = "block";
            }



        } catch (error) {

            showMessage("Error: " + error.message, "error");
                            auctionGate.style.display = "block";

        }
    }

    function showFormForAuction(auction) {
        submissionSection.style.display = "block";
        auctionGate.style.display = "none";
    }

    const urlParams = new URLSearchParams(window.location.search);
    const shortNameFromUrl = urlParams.get("auction");
    if (shortNameFromUrl) {
        validateAuction(shortNameFromUrl);

    } else {
        auctionGate.style.display = "block";
    }


    auctionSubmitBtn.addEventListener("click", function () {
        const shortName = auctionCodeInput.value.trim();
        if (!shortName) return;

        validateAuction(shortName);
    });

    noPhotoCheckbox.addEventListener("change", function () {
        if (this.checked) {
            photoInput.disabled = true;
            photoInput.required = false;
        } else {
            photoInput.disabled = false;
            photoInput.required = true;
        }
    });

    photoInput.addEventListener("change", function () {
        if (this.files && this.files[0]) {
            latestFile = 1;
            const reader = new FileReader();
            reader.onload = function (e) {
                let imgPreview = document.getElementById("img-preview");
                if (!imgPreview) {
                    imgPreview = document.createElement("img");
                    imgPreview.id = "img-preview";
                    imgPreview.style.maxWidth = "100px";
                    form.insertBefore(imgPreview, photoInput.nextSibling);
                }
                imgPreview.src = e.target.result;
            };
            reader.readAsDataURL(this.files[0]);
        }
    });

    livephotoInput.addEventListener("change", function () {
        if (this.files && this.files[0]) {
            latestFile = 2;
            const reader = new FileReader();
            reader.onload = function (e) {
                let imgPreview = document.getElementById("img-preview");
                if (!imgPreview) {
                    imgPreview = document.createElement("img");
                    imgPreview.id = "img-preview";
                    imgPreview.style.maxWidth = "100px";
                    form.insertBefore(imgPreview, photoInput.nextSibling);
                }
                imgPreview.src = e.target.result;
            };
            reader.readAsDataURL(this.files[0]);
        }
    });

    form.addEventListener("submit", async function (event) {

        if (!noPhotoCheckbox.checked && (photoInput.files.length === 0 && livephotoInput.files.length === 0)) {
            event.preventDefault();
            showMessage("Please select a photo or check the 'I don't have a photo' box", "error");
            return;
        }

        event.preventDefault();

        const modal = await DayPilot.Modal.confirm("Are you sure you want to submit this item?");
        if (modal.canceled) {
            showMessage("Submission cancelled", "info");
            return;
        } else {

            submitButton.disabled = true;
            messageContainer.textContent = "Submitting...";

            const formData = new FormData();
            formData.append("description", document.getElementById("description").value);
            formData.append("contributor", document.getElementById("contributor").value);
            formData.append("artist", document.getElementById("artist").value);
            formData.append("notes", "");

            if (!noPhotoCheckbox.checked && (photoInput.files.length > 0 || livephotoInput.files.length > 0)) {
                if (latestFile === 1) {
                    const file = photoInput.files[0];
                    resizeImage(file, function (resizedFile) {
                        formData.append("photo", resizedFile, file.name);
                        submitForm(formData);
                    });
                }
                if (latestFile === 2) {
                    const file = livephotoInput.files[0];
                    resizeImage(file, function (resizedFile) {
                        formData.append("photo", resizedFile, file.name);
                        submitForm(formData);
                    });
                }


            } else {
                submitForm(formData);
            }
        }
    });


    function submitForm(formData) {
        if (!selectedAuctionId) {
            showMessage("Cannot submit - Auction not set", "error");
            return;
        }

        fetch(`${API}/auctions/${selectedAuctionId}/newitem`, {
            method: "POST",
            body: formData
        })
            .then(async response => {
                const data = await response.json();

                if (response.ok) {
                    messageContainer.textContent = "Item submitted successfully!";
                    messageContainer.style.color = "green";
                    showMessage("Item submitted successfully!", "success");
                    form.reset();
                    if (document.getElementById("img-preview")) {
                        document.getElementById("img-preview").remove();
                    }
                } else {
                    // Backend returned an error (e.g. auction not active)
                    showMessage(data.error || "There was a problem with your submission.", "error");
                }
            })
            .catch(error => {
                showMessage("There was an error submitting your item: " + error, "error");
            })
            .finally(() => {
                submitButton.disabled = false;
                photoInput.disabled = false;
            });
    }


    function resizeImage(file, callback) {
        try {
        const maxWidth = 2000;
        const maxHeight = 2000;
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    const aspectRatio = width / height;
                    if (width > height) {
                        width = maxWidth;
                        height = Math.round(maxWidth / aspectRatio);
                    } else {
                        height = maxHeight;
                        width = Math.round(maxHeight * aspectRatio);
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(function (blob) {
                    callback(blob);
                }, file.type, 0.8);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    } catch (error) 
    {
        showMessage("Image couldn't be processed. Try a different image " + error, "error");
 
    }
    
    }
});
