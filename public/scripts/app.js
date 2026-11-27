// Progressive enhancement for Time to Stable (zero dependencies)

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!btn || !meta) return;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (mode) => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (mode === "light" || mode === "dark") {
      meta.content = mode;
      document.documentElement.classList.add(`theme-${mode}`);
      btn.textContent = mode === "dark" ? "Theme: Dark" : "Theme: Light";
      btn.setAttribute("aria-pressed", "true");
    } else {
      meta.content = "light dark";
      btn.textContent = "Theme: System";
      btn.setAttribute("aria-pressed", "false");
    }
  };

  let stored = null;
  try {
    stored = localStorage.getItem("color-scheme");
  } catch {
    stored = null;
  }
  applyTheme(stored === "light" || stored === "dark" ? stored : null);

  btn.addEventListener("click", () => {
    let current = null;
    try {
      current = localStorage.getItem("color-scheme");
    } catch {
      current = null;
    }
    const opposite = mq.matches ? "light" : "dark";
    const next = current === "light" || current === "dark" ? null : opposite;
    try {
      if (next) localStorage.setItem("color-scheme", next);
      else localStorage.removeItem("color-scheme");
    } catch {
      // ignore storage errors
    }
    applyTheme(next);
  });

  mq.addEventListener("change", () => {
    let current = null;
    try {
      current = localStorage.getItem("color-scheme");
    } catch {
      current = null;
    }
    if (!current) applyTheme(null);
  });
}

function initPresetsAndCategoryButtons() {
  const form = document.getElementById("compare-form");
  if (!form) return;

  document.querySelectorAll("[data-preset-browsers]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetList = (btn.getAttribute("data-preset-browsers") || "")
        .split(",")
        .filter(Boolean);
      const targetSet = new Set(targetList);

      form.querySelectorAll('input[name^="browser-"]').forEach((input) => {
        const name = input.name.slice("browser-".length);
        input.checked = targetSet.has(name);
      });

      // Ensure at least default categories are checked if none selected
      const checkedCats = form.querySelectorAll(
        'input[name^="feature-"]:checked',
      );
      if (checkedCats.length === 0) {
        ["api", "css", "html", "javascript"].forEach((cat) => {
          const cb = form.querySelector(`input[name="feature-${cat}"]`);
          if (cb) cb.checked = true;
        });
      }

      form.submit();
    });
  });

  document.querySelectorAll("[data-cat-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-cat-action");
      const checked = action === "all";
      form.querySelectorAll('input[name^="feature-"]').forEach((input) => {
        input.checked = checked;
      });
    });
  });
}

function initCopyLink() {
  const btn = document.getElementById("copy-link-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const target = btn.getAttribute("data-copy-url") || window.location.href;
    const orig = btn.textContent;
    try {
      await navigator.clipboard.writeText(target);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => {
      btn.textContent = orig;
    }, 1800);
  });
}

function initSvgTooltips() {
  const tooltip = document.getElementById("svg-tooltip");
  if (!tooltip) return;

  const show = (text, x, y) => {
    tooltip.textContent = text;
    tooltip.style.left = `${Math.min(window.innerWidth - 280, x + 12)}px`;
    tooltip.style.top = `${Math.max(8, y - 34)}px`;
    tooltip.classList.add("visible");
  };
  const hide = () => {
    tooltip.classList.remove("visible");
  };

  document.addEventListener("pointerover", (ev) => {
    const target = ev.target?.closest?.("[data-tooltip]");
    if (!target) return;
    const text = target.getAttribute("data-tooltip");
    if (text) show(text, ev.clientX, ev.clientY);
  });

  document.addEventListener("pointermove", (ev) => {
    if (!tooltip.classList.contains("visible")) return;
    const target = ev.target?.closest?.("[data-tooltip]");
    if (!target) {
      hide();
      return;
    }
    const text = target.getAttribute("data-tooltip");
    if (text) show(text, ev.clientX, ev.clientY);
  });

  document.addEventListener("pointerout", (ev) => {
    const target = ev.target?.closest?.("[data-tooltip]");
    if (target) hide();
  });
}

function renderRowHtml(row, browserMap, catLabels) {
  const href = `/feature/${encodeURIComponent(row.id)}`;
  const primary = row.name
    ? `<strong><a href="${escapeText(href)}">${escapeText(row.name)}</a></strong><br><code class="mono">${escapeText(row.id)}</code>`
    : `<a class="mono" href="${escapeText(href)}">${escapeText(row.id)}</a>`;

  const ext = [
    row.mdnUrl
      ? `<a href="${escapeText(row.mdnUrl)}" target="_blank" rel="noopener">MDN</a>`
      : "",
    row.specUrl
      ? `<a href="${escapeText(row.specUrl)}" target="_blank" rel="noopener">Spec</a>`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const badge =
    row.baseline === "high"
      ? '<span class="badge badge-high">Baseline Widely</span>'
      : row.baseline === "low"
      ? '<span class="badge badge-low">Baseline Newly</span>'
      : '<span class="badge badge-limited">Limited</span>';

  const chips = [
    ...(row.browserTimeline || []).map((pt) => {
      const bName = browserMap[pt.browser] || pt.browser;
      const dateStr = new Date(pt.day * 86400000).toISOString().slice(0, 7);
      const cav = pt.caveat
        ? ` <span class="badge badge-warn">${escapeText(pt.caveat)}</span>`
        : "";
      return `<span class="b-chip">${escapeText(bName)} ${escapeText(pt.approx ? `≤${pt.version}` : pt.version)} · ${escapeText(dateStr)}${cav}</span>`;
    }),
    ...(row.missingBrowsers || []).map(
      (b) =>
        `<span class="b-chip b-chip-missing">− ${escapeText(browserMap[b] || b)}</span>`,
    ),
  ].join("");

  const waitText =
    row.ageInDays !== null && row.ageInDays !== undefined
      ? `${row.ageInDays.toLocaleString("en-US")}d`
      : row.limboDays !== null && row.limboDays !== undefined
      ? `${row.limboDays.toLocaleString("en-US")}d <span class="badge badge-warn">limbo</span>`
      : "—";

  return `<tr>
    <td>${primary}${ext ? `<div class="feature-notes">${ext}</div>` : ""}</td>
    <td>${escapeText(catLabels[row.cat] || row.cat)}</td>
    <td>${badge}</td>
    <td><div class="timeline-chips">${chips}</div></td>
    <td class="num">${waitText}</td>
  </tr>`;
}

function initProgressiveExplorer() {
  const section = document.getElementById("raw-explorer");
  const form = document.getElementById("explorer-filter-form");
  const tbody = document.getElementById("explorer-tbody");
  const statusEl = document.getElementById("explorer-status");
  const headingEl = document.getElementById("explorer-heading");
  const paginationWrap = document.getElementById("explorer-pagination-top");
  if (!section || !form || !tbody || !statusEl) return;

  const view = section.getAttribute("data-view") || "stable";
  const actionPath = section.getAttribute("data-action-path") || "/";
  const pageSize = section.getAttribute("data-page-size") || "25";

  let abortCtrl = null;
  let timer = null;

  const fetchPage = async (page = 1) => {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) {
      if (String(v)) params.set(k, String(v));
    }
    params.set("view", view);
    params.set("page", String(page));
    params.set("pageSize", pageSize);

    statusEl.textContent = "Loading…";
    try {
      const res = await fetch(`/api/features?${params.toString()}`, {
        signal: abortCtrl.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      const browserMap = data.browserShortNames || {};
      const catLabels = data.categoryLabels || {};

      tbody.innerHTML = data.rows.length
        ? data.rows.map((r) => renderRowHtml(r, browserMap, catLabels)).join("")
        : '<tr><td colspan="5">No matching features for the current filters.</td></tr>';

      const totalPages = Math.max(1, data.pagination.totalPages);
      const curPage = data.pagination.page;
      const total = data.pagination.total;
      if (headingEl) {
        headingEl.textContent = `Feature Explorer (${total.toLocaleString("en-US")} matching)`;
      }
      statusEl.textContent = `Showing page ${curPage} of ${totalPages} (${total.toLocaleString("en-US")} features)`;

      if (paginationWrap) {
        const controls = paginationWrap.querySelector(".pagination-controls");
        if (controls) {
          const prevHtml =
            curPage > 1
              ? `<a class="btn" data-page="${curPage - 1}" href="#">Previous</a>`
              : '<span class="btn" aria-disabled="true">Previous</span>';
          const nextHtml =
            curPage < totalPages
              ? `<a class="btn" data-page="${curPage + 1}" href="#">Next</a>`
              : '<span class="btn" aria-disabled="true">Next</span>';
          controls.innerHTML = `${prevHtml}${nextHtml}`;
        }
      }

      // Sync URL cleanly without page reload
      const urlParams = new URLSearchParams(params);
      urlParams.delete("view");
      urlParams.delete("pageSize");
      if (curPage <= 1) urlParams.delete("page");
      window.history.replaceState(
        null,
        "",
        `${actionPath}?${urlParams.toString()}#raw-explorer`,
      );
    } catch (err) {
      if (err?.name !== "AbortError") {
        statusEl.textContent = "Filter error — submit form to reload.";
      }
    }
  };

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    fetchPage(1);
  });

  const qInput = document.getElementById("explorer-q");
  if (qInput) {
    qInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => fetchPage(1), 220);
    });
  }

  ["explorer-cat", "explorer-baseline", "explorer-sort", "explorer-dir"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => fetchPage(1));
    },
  );

  if (paginationWrap) {
    paginationWrap.addEventListener("click", (ev) => {
      const link = ev.target?.closest?.("a[data-page]");
      if (!link) return;
      ev.preventDefault();
      const targetPage = Number.parseInt(
        link.getAttribute("data-page") || "1",
        10,
      );
      if (Number.isFinite(targetPage)) fetchPage(targetPage);
    });
  }
}

function initWebMcp() {
  if (!("modelContext" in navigator)) return;
  const mc = navigator.modelContext;
  if (!mc || typeof mc.registerTool !== "function") return;

  try {
    mc.registerTool({
      name: "compare_browsers",
      description:
        "Compare time-to-stable and Kaplan-Meier convergence metrics across selected browsers and web platform categories.",
      inputSchema: {
        type: "object",
        properties: {
          browsers: {
            type: "array",
            items: { type: "string" },
            description: "Browser IDs such as chrome, firefox, safari, edge",
          },
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Categories: api, css, html, http, javascript, webassembly",
          },
          mode: {
            type: "string",
            enum: ["bcd", "web-features"],
          },
        },
      },
      execute: async (input) => {
        const sp = new URLSearchParams();
        if (Array.isArray(input?.browsers)) {
          sp.set("browsers", input.browsers.join(","));
        }
        if (Array.isArray(input?.categories)) {
          sp.set("categories", input.categories.join(","));
        }
        if (input?.mode) sp.set("mode", String(input.mode));
        const res = await fetch(`/api/compare?${sp.toString()}`);
        return await res.json();
      },
    });

    mc.registerTool({
      name: "lookup_feature",
      description:
        "Look up browser release timeline and Baseline status for a Web Feature ID (e.g. subgrid) or MDN BCD key (e.g. api.Navigator.clipboard).",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
        },
      },
      execute: async (input) => {
        const id = encodeURIComponent(String(input?.id || ""));
        const res = await fetch(`/api/feature/${id}`);
        return await res.json();
      },
    });

    mc.registerTool({
      name: "get_platform_stories",
      description:
        "Retrieve empirical web platform evolution stories including Kaplan-Meier velocity eras, lumpy-web holdouts, and mobile parity gaps.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string" },
        },
      },
      execute: async (input) => {
        const path = input?.slug
          ? `/api/stories/${encodeURIComponent(String(input.slug))}`
          : "/api/stories";
        const res = await fetch(path);
        return await res.json();
      },
    });
  } catch {
    // Ignore if browser rejects duplicate or experimental WebMCP registration
  }
}

initThemeToggle();
initPresetsAndCategoryButtons();
initCopyLink();
initSvgTooltips();
initProgressiveExplorer();
initWebMcp();
