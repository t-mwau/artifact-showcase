"use strict";

(() => {
    const announce = (element, message) => {
        if (element) {
            element.textContent = message;
        }
    };

    const setCurrentYear = () => {
        document.querySelectorAll("#current-year, [data-current-year]").forEach((element) => {
            element.textContent = String(new Date().getFullYear());
        });
    };

    const initializeNavigation = () => {
        const menuToggle = document.querySelector(".menu-toggle");
        const primaryNavigation = document.querySelector("#primary-navigation");

        if (!menuToggle || !primaryNavigation) {
            return;
        }

        menuToggle.addEventListener("click", () => {
            const expanded = menuToggle.getAttribute("aria-expanded") === "true";
            menuToggle.setAttribute("aria-expanded", String(!expanded));
            menuToggle.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
            primaryNavigation.classList.toggle("is-open", !expanded);
        });

        primaryNavigation.addEventListener("click", (event) => {
            if (event.target.closest("a")) {
                menuToggle.setAttribute("aria-expanded", "false");
                menuToggle.setAttribute("aria-label", "Open navigation");
                primaryNavigation.classList.remove("is-open");
            }
        });
    };

    const initializeMarquees = () => {
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => {
            document.querySelectorAll("header marquee").forEach((marquee) => {
                if (preference.matches) {
                    marquee.stop();
                } else {
                    marquee.start();
                }
            });
        };

        update();
        preference.addEventListener("change", update);
    };

    const initializeNewsletter = () => {
        const form = document.querySelector("#newsletter-form");
        const feedback = document.querySelector("#form-message");

        form?.addEventListener("submit", (event) => {
            event.preventDefault();
            announce(feedback, "This demo form is not connected to a mailing list yet.");
        });
    };

    const initializeContactForm = () => {
        const form = document.querySelector("#contact-form");
        const feedback = document.querySelector("#form-feedback");

        form?.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!form.reportValidity()) {
                return;
            }

            const formData = new FormData(form);
            const subject = `${formData.get("topic")} — message from ${formData.get("name")}`;
            const body = [
                `Name: ${formData.get("name")}`,
                `Reply to: ${formData.get("email")}`,
                `Topic: ${formData.get("topic")}`,
                "",
                formData.get("message")
            ].join("\n");
            const mailto = `mailto:savannahinnovativeacademy@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

            feedback.replaceChildren();
            feedback.append("Your message is ready. ");
            const emailLink = document.createElement("a");
            emailLink.href = mailto;
            emailLink.textContent = "Open it in your email app";
            feedback.append(emailLink, ".");
        });
    };

    const initializeStoryFilters = () => {
        const grid = document.querySelector("[data-story-grid]");
        if (!grid) {
            return;
        }

        const filterButtons = [...document.querySelectorAll("[data-filter]")];
        const searchInput = document.querySelector("[data-story-search]");
        const cards = [...grid.querySelectorAll("[data-story-id]")];
        const resultMessage = document.querySelector("[data-story-results]");
        const savedCount = document.querySelector("[data-saved-count]");
        let activeFilter = "all";
        let savedStories = new Set();
        let storageAvailable = true;

        try {
            const storedStories = JSON.parse(localStorage.getItem("sanaa-yetu-saved-stories") || "[]");
            if (Array.isArray(storedStories)) {
                savedStories = new Set(storedStories.filter((story) => typeof story === "string"));
            }
        } catch {
            storageAvailable = false;
            announce(resultMessage, "Saved stories are unavailable because browser storage could not be accessed.");
        }

        const render = () => {
            const query = searchInput?.value.trim().toLocaleLowerCase() || "";
            let visibleCount = 0;

            cards.forEach((card) => {
                const matchesFilter = activeFilter === "all"
                    || (activeFilter === "saved" && savedStories.has(card.dataset.storyId))
                    || card.dataset.category.split(" ").includes(activeFilter);
                const searchableText = `${card.dataset.search} ${card.textContent}`.toLocaleLowerCase();
                const matchesQuery = !query || searchableText.includes(query);
                const visible = matchesFilter && matchesQuery;
                card.hidden = !visible;
                if (visible) {
                    visibleCount += 1;
                }
            });

            if (savedCount) {
                savedCount.textContent = String(savedStories.size);
            }

            if (resultMessage && visibleCount === 0) {
                announce(resultMessage, "No stories match those filters. Try another topic or search.");
            } else if (resultMessage && storageAvailable) {
                announce(resultMessage, `${visibleCount} ${visibleCount === 1 ? "story" : "stories"} shown.`);
            }
        };

        filterButtons.forEach((button) => {
            button.addEventListener("click", () => {
                activeFilter = button.dataset.filter;
                filterButtons.forEach((item) => {
                    item.setAttribute("aria-pressed", String(item === button));
                });
                render();
            });
        });

        searchInput?.addEventListener("input", render);

        grid.addEventListener("click", (event) => {
            const button = event.target.closest("[data-save-story]");
            if (!button) {
                return;
            }

            const story = button.dataset.saveStory;
            if (savedStories.has(story)) {
                savedStories.delete(story);
            } else {
                savedStories.add(story);
            }

            button.setAttribute("aria-pressed", String(savedStories.has(story)));
            button.textContent = savedStories.has(story) ? "Saved" : "Save story";

            if (storageAvailable) {
                try {
                    localStorage.setItem("sanaa-yetu-saved-stories", JSON.stringify([...savedStories]));
                } catch {
                    storageAvailable = false;
                    announce(resultMessage, "This browser could not save your story selection. It will last until you leave the page.");
                }
            }
            render();
        });

        cards.forEach((card) => {
            const button = card.querySelector("[data-save-story]");
            const isSaved = savedStories.has(card.dataset.storyId);
            button.setAttribute("aria-pressed", String(isSaved));
            button.textContent = isSaved ? "Saved" : "Save story";
        });

        render();
    };

    const initializeAuthentication = () => {
        const triggers = [...document.querySelectorAll("[data-account-open]")];
        if (triggers.length === 0) {
            return;
        }

        const dialog = document.createElement("dialog");
        dialog.className = "account-dialog";
        dialog.setAttribute("aria-labelledby", "account-dialog-title");
        dialog.innerHTML = `
            <style>
                .account-dialog {
                    width: min(440px, calc(100% - 32px));
                    max-height: min(680px, calc(100% - 32px));
                    padding: 0;
                    border: 1px solid #ded9cf;
                    background: #fbf9f4;
                    color: #20211d;
                    box-shadow: 0 24px 80px #20211d33;
                    font-family: "DM Sans", Arial, sans-serif;
                }
                .account-dialog::backdrop { background: #20211d88; }
                .account-dialog-inner { padding: clamp(24px, 6vw, 38px); }
                .account-dialog-header { display: flex; justify-content: space-between; align-items: start; gap: 20px; }
                .account-dialog h2 { margin: 0; font-family: "Playfair Display", Georgia, serif; font-size: 32px; font-weight: 500; }
                .account-dialog p { color: #77776f; font-size: 13px; line-height: 1.6; }
                .account-dialog .account-eyebrow { margin: 0 0 8px; color: #a84f32; font-size: 9px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
                .account-dialog-close { border: 0; background: transparent; cursor: pointer; font-size: 24px; line-height: 1; }
                .account-dialog label { display: block; margin: 15px 0 6px; font-size: 11px; font-weight: 600; }
                .account-dialog input { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid #ded9cf; border-radius: 0; background: #fffefa; font: inherit; }
                .account-dialog input:focus { outline: 2px solid #a84f3266; border-color: #a84f32; }
                .account-dialog .account-submit { width: 100%; min-height: 46px; margin-top: 20px; border: 1px solid #20211d; background: #20211d; color: #fbf9f4; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
                .account-dialog .account-submit:disabled { opacity: .65; cursor: wait; }
                .account-dialog .account-switch { margin: 17px 0 0; text-align: center; }
                .account-dialog .account-switch button { padding: 0; border: 0; background: transparent; color: #a84f32; cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
                .account-dialog .account-feedback { min-height: 20px; margin: 12px 0 0; color: #813b26; font-size: 12px; }
                .account-dialog .account-feedback[data-kind="success"] { color: #46583c; }
                .account-dialog .account-help { font-size: 10px; }
            </style>
            <div class="account-dialog-inner">
                <div class="account-dialog-header">
                    <div>
                        <p class="account-eyebrow">Sanaa Yetu account</p>
                        <h2 id="account-dialog-title">Welcome back.</h2>
                    </div>
                    <button class="account-dialog-close" type="button" data-account-close aria-label="Close dialog">&times;</button>
                </div>
                <p data-account-description>Sign in to continue.</p>
                <div data-account-content></div>
                <p class="account-feedback" data-account-feedback aria-live="polite"></p>
            </div>`;
        document.body.append(dialog);

        const title = dialog.querySelector("#account-dialog-title");
        const description = dialog.querySelector("[data-account-description]");
        const content = dialog.querySelector("[data-account-content]");
        const feedback = dialog.querySelector("[data-account-feedback]");
        let account = null;
        let authUnavailable = false;
        let mode = "login";

        const updateTriggers = () => {
            triggers.forEach((trigger) => {
                trigger.textContent = account ? account.name : "Sign in";
                trigger.setAttribute("aria-label", account ? `Account for ${account.name}` : "Sign in");
            });
        };

        const showFeedback = (message, kind = "error") => {
            feedback.textContent = message;
            feedback.dataset.kind = kind;
        };

        const render = () => {
            feedback.textContent = "";
            delete feedback.dataset.kind;

            if (account) {
                title.textContent = `Welcome, ${account.name}.`;
                description.textContent = `You are signed in as ${account.email}.`;
                content.innerHTML = `<button class="account-submit" type="button" data-account-logout>Sign out</button>`;
                return;
            }

            title.textContent = mode === "register" ? "Create your account." : "Welcome back.";
            description.textContent = mode === "register"
                ? "Create an account to save your place in the Sanaa Yetu community."
                : "Sign in to your Sanaa Yetu account.";

            if (authUnavailable) {
                content.innerHTML = `<p>The account service is unavailable. Start the Node.js server with <code>npm start</code> and try again.</p>`;
                return;
            }

            content.innerHTML = `
                <form data-account-form>
                    ${mode === "register" ? `<label for="account-name">Your name</label><input id="account-name" name="name" type="text" autocomplete="name" maxlength="80" required>` : ""}
                    <label for="account-email">Email address</label>
                    <input id="account-email" name="email" type="email" autocomplete="email" maxlength="254" required>
                    <label for="account-password">Password</label>
                    <input id="account-password" name="password" type="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" minlength="12" maxlength="128" required>
                    ${mode === "register" ? `<p class="account-help">Use at least 12 characters. Your password is stored as a one-way hash.</p>` : ""}
                    <button class="account-submit" type="submit">${mode === "register" ? "Create account" : "Sign in"}</button>
                </form>
                <p class="account-switch">${mode === "register" ? "Already have an account?" : "New to Sanaa Yetu?"}
                    <button type="button" data-account-mode="${mode === "register" ? "login" : "register"}">${mode === "register" ? "Sign in" : "Create an account"}</button>
                </p>`;
        };

        const request = async (url, options = {}) => {
            const response = await fetch(url, {
                ...options,
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", ...options.headers }
            });
            const result = await response.json().catch(() => {
                throw new Error("The server returned an unreadable response. Please try again.");
            });
            if (!response.ok) {
                throw new Error(result.error || "The request could not be completed.");
            }
            return result;
        };

        triggers.forEach((trigger) => {
            trigger.addEventListener("click", () => {
                render();
                dialog.showModal();
            });
        });

        dialog.querySelector("[data-account-close]").addEventListener("click", () => dialog.close());

        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) {
                dialog.close();
            }

            const modeButton = event.target.closest("[data-account-mode]");
            if (modeButton) {
                mode = modeButton.dataset.accountMode;
                render();
            }

            if (event.target.closest("[data-account-logout]")) {
                request("/api/auth/logout", { method: "POST", body: "{}" })
                    .then(() => {
                        account = null;
                        updateTriggers();
                        mode = "login";
                        render();
                        showFeedback("You have signed out.", "success");
                    })
                    .catch((error) => showFeedback(error.message));
            }
        });

        dialog.addEventListener("submit", async (event) => {
            const form = event.target.closest("[data-account-form]");
            if (!form) {
                return;
            }

            event.preventDefault();
            if (!form.reportValidity()) {
                return;
            }

            const submit = form.querySelector("[type=submit]");
            submit.disabled = true;
            showFeedback("");
            const formData = new FormData(form);

            try {
                const result = await request(`/api/auth/${mode}`, {
                    method: "POST",
                    body: JSON.stringify(Object.fromEntries(formData.entries()))
                });
                account = result.user;
                updateTriggers();
                render();
                showFeedback(mode === "register" ? "Your account is ready." : "You are signed in.", "success");
            } catch (error) {
                showFeedback(error.message);
                submit.disabled = false;
            }
        });

        updateTriggers();
        request("/api/auth/me")
            .then((result) => {
                account = result.user || null;
                updateTriggers();
            })
            .catch(() => {
                authUnavailable = true;
                triggers.forEach((trigger) => {
                    trigger.title = "Account service unavailable. Run npm start to enable sign-in.";
                });
            });
    };

    const initialize = () => {
        setCurrentYear();
        initializeNavigation();
        initializeMarquees();
        initializeNewsletter();
        initializeContactForm();
        initializeStoryFilters();
        initializeAuthentication();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
