// Cloudflare Worker CORS proxy for Wallhaven API
const DEFAULT_PROXY = "https://wallhaven.nandanabhi455.workers.dev";
let customProxy = "";

try {
  // Purge any legacy stale proxy configuration to ensure production worker is used
  localStorage.removeItem("wallhaven_proxy");
} catch (e) {
  // Ignore if localStorage is restricted
}

function getApiEndpoint() {
  if (customProxy) {
    return customProxy.endsWith("/") ? customProxy.slice(0, -1) : customProxy;
  }
  if (window.location.protocol.startsWith("http") && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "/api/search";
  }
  return DEFAULT_PROXY;
}

// DOM Elements
const col0 = document.getElementById("col-0");
const col1 = document.getElementById("col-1");
const footer = document.getElementById("footer");
const brandLink = document.getElementById("brandLink");

// Lightbox modal elements
const lightboxModal = document.getElementById("lightboxModal");
const closeLightbox = document.getElementById("closeLightbox");
const lightboxLoader = document.getElementById("lightboxLoader");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxRes = document.getElementById("lightboxRes");
const lightboxDetails = document.getElementById("lightboxDetails");
const lightboxDownload = document.getElementById("lightboxDownload");
const lightboxWallhaven = document.getElementById("lightboxWallhaven");
const lightboxError = document.getElementById("lightboxError");
const lightboxErrorMsg = document.getElementById("lightboxErrorMsg");
const lightboxRetryBtn = document.getElementById("lightboxRetryBtn");
let lightboxTimeoutId = null;
const LIGHTBOX_TIMEOUT_MS = 15000; // 15-second timeout for image load

// Filter controls
const colorBtn = document.getElementById("colorBtn");
const colorMenu = document.getElementById("colorMenu");
const colorGrid = document.getElementById("colorGrid");
const clearColorBtn = document.getElementById("clearColorBtn");
const activeColorDot = document.getElementById("activeColorDot");
const colorDropdownWrapper = document.getElementById("colorDropdownWrapper");

const purityBtn = document.getElementById("purityBtn");
const purityBtnLabel = document.getElementById("purityBtnLabel");
const purityMenu = document.getElementById("purityMenu");
const purityDropdownWrapper = document.getElementById("purityDropdownWrapper");

const sortBtn = document.getElementById("sortBtn");
const sortBtnLabel = document.getElementById("sortBtnLabel");
const sortMenu = document.getElementById("sortMenu");
const sortDropdownWrapper = document.getElementById("sortDropdownWrapper");

const orderBtn = document.getElementById("orderBtn");
const orderIcon = document.getElementById("orderIcon");

// State
let query = "";
let page = 1;
let loading = false;
let ended = false;
let seen = new Set();
let columnHeights = [0, 0];

let categoriesState = {
  general: true,
  anime: true,
  people: false
};
let selectedColor = null;
let selectedPurity = "100"; // Default: SFW ("100"). Sketchy: "110" (SFW + Sketchy)
let selectedSort = "date_added";
let selectedOrder = "desc";

const WALLHAVEN_COLORS = [
  "660000", "990000", "cc0000", "cc3333", "ea4c88", "993399", "663399",
  "333399", "0066cc", "0099ff", "66cccc", "77cc33", "669900", "336600",
  "666600", "999900", "cccc33", "ffff00", "ffcc00", "ff9900", "ff6600",
  "cc6633", "996633", "663300", "000000", "424153", "999999", "ffffff"
];

function getCategoriesString() {
  const g = categoriesState.general ? "1" : "0";
  const a = categoriesState.anime ? "1" : "0";
  const p = categoriesState.people ? "1" : "0";
  return `${g}${a}${p}`;
}

// Purge any legacy cached session data
try {
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith("wh_")) sessionStorage.removeItem(key);
  });
} catch (e) {
  // Ignore if sessionStorage is unavailable
}

// Request cancellation & Debounce
let activeAbortController = null;
let reloadDebounceTimer = null;

// Rate limit cooldown state
let cooldownInterval = null;
let isRateLimited = false;

function startRateLimitCooldown(seconds = 35) {
  isRateLimited = true;
  let remaining = seconds;
  if (cooldownInterval) clearInterval(cooldownInterval);

  footer.innerHTML = `Wallhaven rate limit reached (45 req/min). Retrying automatically in <strong id="cooldownSeconds" style="color:var(--accent)">${remaining}s</strong>...`;

  cooldownInterval = setInterval(() => {
    remaining--;
    const el = document.getElementById("cooldownSeconds");
    if (el) {
      el.textContent = `${remaining}s`;
    } else {
      footer.innerHTML = `Wallhaven rate limit reached (45 req/min). Retrying automatically in <strong id="cooldownSeconds" style="color:var(--accent)">${remaining}s</strong>...`;
    }

    if (remaining <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      isRateLimited = false;
      footer.textContent = "Fetching wallpapers...";
      loadMore();
    }
  }, 1000);
}

function reloadFeed(immediate = false) {
  if (reloadDebounceTimer) {
    clearTimeout(reloadDebounceTimer);
    reloadDebounceTimer = null;
  }

  const executeReload = () => {
    // Cancel in-flight network request
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }

    page = 1;
    loading = false;
    ended = false;
    seen.clear();
    columnHeights = [0, 0];
    col0.replaceChildren();
    col1.replaceChildren();
    loadMore();
  };

  if (immediate) {
    executeReload();
  } else {
    reloadDebounceTimer = setTimeout(executeReload, 250);
  }
}

// Category Buttons
document.querySelectorAll(".cat-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const cat = btn.dataset.cat;
    const activeCount = Object.values(categoriesState).filter(Boolean).length;
    if (categoriesState[cat] && activeCount <= 1) {
      return; // Keep at least one category enabled
    }
    categoriesState[cat] = !categoriesState[cat];
    btn.classList.toggle("active", categoriesState[cat]);
    reloadFeed();
  });
});

// Color Swatches
WALLHAVEN_COLORS.forEach(hex => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "color-chip";
  chip.style.backgroundColor = `#${hex}`;
  chip.title = `#${hex}`;
  chip.addEventListener("click", () => {
    selectedColor = hex;
    activeColorDot.style.display = "inline-block";
    activeColorDot.style.backgroundColor = `#${hex}`;
    document.querySelectorAll(".color-chip").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    closeAllDropdowns();
    reloadFeed();
  });
  colorGrid.appendChild(chip);
});

clearColorBtn.addEventListener("click", () => {
  selectedColor = null;
  activeColorDot.style.display = "none";
  document.querySelectorAll(".color-chip").forEach(c => c.classList.remove("selected"));
  closeAllDropdowns();
  reloadFeed();
});

// Purity Options (SFW / Sketchy)
document.querySelectorAll(".purity-item").forEach(item => {
  item.addEventListener("click", () => {
    selectedPurity = item.dataset.purity;
    purityBtnLabel.textContent = item.dataset.label || item.textContent;
    document.querySelectorAll(".purity-item").forEach(p => p.classList.remove("active"));
    item.classList.add("active");
    closeAllDropdowns();
    reloadFeed();
  });
});

// Sort Options
document.querySelectorAll(".sort-item").forEach(item => {
  item.addEventListener("click", () => {
    selectedSort = item.dataset.sort;
    sortBtnLabel.textContent = item.textContent;
    document.querySelectorAll(".sort-item").forEach(s => s.classList.remove("active"));
    item.classList.add("active");
    closeAllDropdowns();
    reloadFeed();
  });
});

// Sort Order Button [ ↓ ] / [ ↑ ]
if (orderBtn) {
  orderBtn.addEventListener("click", () => {
    selectedOrder = selectedOrder === "desc" ? "asc" : "desc";
    if (orderIcon) {
      orderIcon.textContent = selectedOrder === "desc" ? "↓" : "↑";
    }
    orderBtn.title = selectedOrder === "desc" ? "Sort Order: Descending" : "Sort Order: Ascending";
    reloadFeed();
  });
}

// Dropdown Toggles
function closeAllDropdowns() {
  colorMenu.classList.remove("open");
  colorBtn.classList.remove("open");
  if (purityMenu && purityBtn) {
    purityMenu.classList.remove("open");
    purityBtn.classList.remove("open");
  }
  sortMenu.classList.remove("open");
  sortBtn.classList.remove("open");
}

colorBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = colorMenu.classList.contains("open");
  closeAllDropdowns();
  if (!isOpen) {
    colorMenu.classList.add("open");
    colorBtn.classList.add("open");
  }
});

if (purityBtn) {
  purityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = purityMenu.classList.contains("open");
    closeAllDropdowns();
    if (!isOpen) {
      purityMenu.classList.add("open");
      purityBtn.classList.add("open");
    }
  });
}

sortBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = sortMenu.classList.contains("open");
  closeAllDropdowns();
  if (!isOpen) {
    sortMenu.classList.add("open");
    sortBtn.classList.add("open");
  }
});

document.addEventListener("click", (e) => {
  if (
    !colorDropdownWrapper.contains(e.target) &&
    !(purityDropdownWrapper && purityDropdownWrapper.contains(e.target)) &&
    !sortDropdownWrapper.contains(e.target)
  ) {
    closeAllDropdowns();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllDropdowns();
  }
});

// Wallpaper Card Component
function createWallpaperCard(wallpaper) {
  const card = document.createElement("div");
  card.className = "wallpaper";

  const width = +wallpaper.dimension_x || 9;
  const height = +wallpaper.dimension_y || 16;

  // Card height strictly follows natural aspect ratio
  card.style.aspectRatio = `${width} / ${height}`;

  // Use dominant image color as placeholder before image loads
  if (wallpaper.colors && wallpaper.colors[0]) {
    card.style.backgroundColor = wallpaper.colors[0];
  }

  // thumbs.original retains true uncropped portrait aspect ratio
  const thumbUrl = wallpaper.thumbs?.original || wallpaper.thumbs?.large || wallpaper.path;

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.alt = `Wallpaper ${wallpaper.resolution || ""}`;
  img.src = thumbUrl;

  img.onload = () => {
    img.classList.add("loaded");
  };

  card.append(img);
  card.onclick = () => openLightbox(wallpaper);
  return card;
}

function appendWallpaper(wallpaper) {
  const card = createWallpaperCard(wallpaper);

  // Place in the shorter column to keep bottoms balanced
  const minIndex = columnHeights[0] <= columnHeights[1] ? 0 : 1;
  const targetCol = minIndex === 0 ? col0 : col1;
  targetCol.appendChild(card);

  // Column height tracked by the natural ratio
  const naturalRatio = (+wallpaper.dimension_y || 16) / (+wallpaper.dimension_x || 9);
  columnHeights[minIndex] += naturalRatio;
}

// Lightbox Modal
let currentWallpaper = null;

function resetLightboxImage() {
  if (lightboxTimeoutId) {
    clearTimeout(lightboxTimeoutId);
    lightboxTimeoutId = null;
  }
  lightboxImg.classList.remove("loaded");
  lightboxImg.removeAttribute("src");
  if (lightboxLoader) {
    lightboxLoader.classList.remove("hidden");
  }
  if (lightboxError) {
    lightboxError.classList.add("hidden");
  }
  currentWallpaper = null;
}

function loadLightboxFullImage(wallpaper) {
  if (!currentWallpaper || currentWallpaper.id !== wallpaper.id) return;

  // Clear any existing timer
  if (lightboxTimeoutId) {
    clearTimeout(lightboxTimeoutId);
    lightboxTimeoutId = null;
  }

  // Show ONLY loading animation initially (no low-res preview)
  lightboxImg.classList.remove("loaded");
  lightboxImg.removeAttribute("src");
  lightboxImg.referrerPolicy = "no-referrer";
  if (lightboxError) lightboxError.classList.add("hidden");
  if (lightboxLoader) lightboxLoader.classList.remove("hidden");

  const targetSrc = wallpaper.path || wallpaper.thumbs?.large;

  // 15-second timeout safeguard
  lightboxTimeoutId = setTimeout(() => {
    if (currentWallpaper && currentWallpaper.id === wallpaper.id) {
      lightboxImg.removeAttribute("src");
      if (lightboxLoader) lightboxLoader.classList.add("hidden");
      if (lightboxErrorMsg) lightboxErrorMsg.textContent = "Loading timed out.";
      if (lightboxError) lightboxError.classList.remove("hidden");
    }
  }, LIGHTBOX_TIMEOUT_MS);

  lightboxImg.onload = () => {
    if (currentWallpaper && currentWallpaper.id === wallpaper.id) {
      if (lightboxTimeoutId) {
        clearTimeout(lightboxTimeoutId);
        lightboxTimeoutId = null;
      }
      if (lightboxLoader) lightboxLoader.classList.add("hidden");
      if (lightboxError) lightboxError.classList.add("hidden");
      lightboxImg.classList.add("loaded");
    }
  };

  lightboxImg.onerror = () => {
    if (currentWallpaper && currentWallpaper.id === wallpaper.id) {
      const fallbackSrc = wallpaper.thumbs?.original || wallpaper.thumbs?.large;
      // If full image failed, attempt fallback thumbnail before showing error
      if (fallbackSrc && lightboxImg.src !== fallbackSrc) {
        lightboxImg.src = fallbackSrc;
        return;
      }

      if (lightboxTimeoutId) {
        clearTimeout(lightboxTimeoutId);
        lightboxTimeoutId = null;
      }
      lightboxImg.removeAttribute("src");
      if (lightboxLoader) lightboxLoader.classList.add("hidden");
      if (lightboxErrorMsg) lightboxErrorMsg.textContent = "Failed to load wallpaper.";
      if (lightboxError) lightboxError.classList.remove("hidden");
    }
  };

  lightboxImg.src = targetSrc;
}

function openLightbox(wallpaper) {
  currentWallpaper = wallpaper;

  lightboxRes.textContent = wallpaper.resolution ? `${wallpaper.resolution}` : "Portrait Wallpaper";

  const mb = wallpaper.file_size
    ? `${(wallpaper.file_size / (1024 * 1024)).toFixed(2)} MB`
    : "";
  lightboxDetails.textContent = `${wallpaper.category || "portrait"} · ${mb || wallpaper.file_type || ""}`;

  lightboxWallhaven.href = wallpaper.url;
  lightboxDownload.textContent = "Download ↓";

  loadLightboxFullImage(wallpaper);
  lightboxModal.showModal();
}

if (lightboxRetryBtn) {
  lightboxRetryBtn.addEventListener("click", () => {
    if (currentWallpaper) {
      loadLightboxFullImage(currentWallpaper);
    }
  });
}

lightboxDownload.addEventListener("click", async () => {
  if (!currentWallpaper || !currentWallpaper.path) return;

  const url = currentWallpaper.path;
  const ext = currentWallpaper.file_type === "image/png" ? "png" : "jpg";
  const filename = `wallhaven-${currentWallpaper.id}.${ext}`;

  lightboxDownload.textContent = "Downloading...";

  try {
    const response = await fetch(url, { referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Fetch failed");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const tempLink = document.createElement("a");
    tempLink.href = blobUrl;
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    URL.revokeObjectURL(blobUrl);

    lightboxDownload.textContent = "Downloaded ✓";
    setTimeout(() => {
      lightboxDownload.textContent = "Download ↓";
    }, 1800);
  } catch (err) {
    console.warn("Direct blob download failed, falling back to direct link:", err);
    const tempLink = document.createElement("a");
    tempLink.href = url;
    tempLink.target = "_blank";
    tempLink.rel = "noopener noreferrer";
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
    lightboxDownload.textContent = "Download ↓";
  }
});

closeLightbox.addEventListener("click", () => lightboxModal.close());

lightboxModal.addEventListener("click", e => {
  if (e.target === lightboxModal) {
    lightboxModal.close();
  }
});

lightboxModal.addEventListener("close", resetLightboxImage);

// Fetch Wallpapers
async function loadMore() {
  if (loading || ended || isRateLimited) return;

  loading = true;
  footer.textContent = "Fetching wallpapers...";

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    const params = new URLSearchParams({
      q: query,
      purity: selectedPurity,
      categories: getCategoriesString(),
      sorting: selectedSort,
      order: selectedOrder,
      ratios: "portrait",
      page: String(page)
    });

    if (selectedColor) {
      params.set("colors", selectedColor);
    }

    const endpoint = getApiEndpoint();
    const response = await fetch(`${endpoint}?${params}`, {
      signal,
      cache: "no-store"
    });

    if (response.status === 429) {
      let retryAfter = parseInt(response.headers.get("Retry-After"), 10);
      if (isNaN(retryAfter) || retryAfter <= 0) {
        retryAfter = 35;
      }
      startRateLimitCooldown(retryAfter);
      return;
    }

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const json = await response.json();

    const items = json.data || [];
    let addedCount = 0;

    for (const wallpaper of items) {
      if (seen.has(wallpaper.id)) continue;

      // Only portrait images (height strictly greater than width)
      if (+wallpaper.dimension_y <= +wallpaper.dimension_x) {
        continue;
      }

      seen.add(wallpaper.id);
      appendWallpaper(wallpaper);
      addedCount++;
    }

    const lastPage = +(json.meta?.last_page || page);
    page++;

    if (!items.length || page > lastPage) {
      ended = true;
    }

    footer.textContent = ended
      ? "You've reached the end."
      : "Scroll for more wallpapers";

    // If an edge-case page returned 0 matching portrait items, auto-advance to next page
    if (addedCount === 0 && !ended && items.length > 0) {
      loading = false;
      return loadMore();
    }
  } catch (error) {
    if (error.name === "AbortError") {
      // Intentionally cancelled by user action
      return;
    }
    console.error(error);
    footer.innerHTML = `Failed to load wallpapers. Sometimes it take multiple retries. <button type="button" class="retry-link" id="retryBtn">Try Again</button>`;
    const retryBtn = document.getElementById("retryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        footer.textContent = "Fetching wallpapers...";
        loadMore();
      });
    }
  } finally {
    loading = false;
  }
}

// Infinite scroll observer (smooth 300px trigger)
const observer = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) {
    loadMore();
  }
}, { rootMargin: "300px" });

observer.observe(document.getElementById("sentinel"));

// Search handler (immediate reload)
document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  query = document.getElementById("query").value.trim();
  reloadFeed(true);
});

// Reset site to default home state
function resetToDefaultHome() {
  // 1. Reset search input and query
  const queryInput = document.getElementById("query");
  if (queryInput) queryInput.value = "";
  query = "";

  // 2. Reset categories (General: ON, Anime: ON, People: OFF)
  categoriesState.general = true;
  categoriesState.anime = true;
  categoriesState.people = false;
  document.querySelectorAll(".cat-btn").forEach(btn => {
    const cat = btn.dataset.cat;
    btn.classList.toggle("active", Boolean(categoriesState[cat]));
  });

  // 3. Reset color filter
  selectedColor = null;
  if (activeColorDot) activeColorDot.style.display = "none";
  document.querySelectorAll(".color-chip").forEach(c => c.classList.remove("selected"));

  // 4. Reset purity (SFW: 100)
  selectedPurity = "100";
  if (purityBtnLabel) purityBtnLabel.textContent = "SFW";
  document.querySelectorAll(".purity-item").forEach(p => {
    p.classList.toggle("active", p.dataset.purity === "100");
  });

  // 5. Reset sorting (Date Added: date_added)
  selectedSort = "date_added";
  if (sortBtnLabel) sortBtnLabel.textContent = "Date Added";
  document.querySelectorAll(".sort-item").forEach(s => {
    s.classList.toggle("active", s.dataset.sort === "date_added");
  });

  // 6. Reset sort order (desc: ↓)
  selectedOrder = "desc";
  if (orderIcon) orderIcon.textContent = "↓";
  if (orderBtn) orderBtn.title = "Sort Order: Descending";

  // 7. Close any open dropdown menus
  closeAllDropdowns();

  // 8. Smooth scroll back to top
  window.scrollTo({ top: 0, behavior: "smooth" });

  // 9. Reload feed immediately
  reloadFeed(true);
}

if (brandLink) {
  brandLink.addEventListener("click", (e) => {
    // Intercept standard left-clicks without modifier keys
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      resetToDefaultHome();
    }
  });
}

// Initial load
loadMore();
