// Cloudflare Worker CORS proxy for Wallhaven API
const DEFAULT_PROXY = "https://wallhaven.nandanabhi455.workers.dev";
let customProxy = localStorage.getItem("wallhaven_proxy") || "";

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

// Lightbox modal elements
const lightboxModal = document.getElementById("lightboxModal");
const closeLightbox = document.getElementById("closeLightbox");
const lightboxLoader = document.getElementById("lightboxLoader");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxRes = document.getElementById("lightboxRes");
const lightboxDetails = document.getElementById("lightboxDetails");
const lightboxDownload = document.getElementById("lightboxDownload");
const lightboxWallhaven = document.getElementById("lightboxWallhaven");

// Filter controls
const colorBtn = document.getElementById("colorBtn");
const colorMenu = document.getElementById("colorMenu");
const colorGrid = document.getElementById("colorGrid");
const clearColorBtn = document.getElementById("clearColorBtn");
const activeColorDot = document.getElementById("activeColorDot");
const colorDropdownWrapper = document.getElementById("colorDropdownWrapper");

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

function reloadFeed() {
  page = 1;
  loading = false;
  ended = false;
  seen.clear();
  columnHeights = [0, 0];
  col0.replaceChildren();
  col1.replaceChildren();
  loadMore();
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
  if (!colorDropdownWrapper.contains(e.target) && !sortDropdownWrapper.contains(e.target)) {
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
  lightboxImg.classList.remove("loaded");
  lightboxImg.removeAttribute("src");
  if (lightboxLoader) {
    lightboxLoader.classList.remove("hidden");
  }
  currentWallpaper = null;
}

function openLightbox(wallpaper) {
  currentWallpaper = wallpaper;

  // Immediately clear old image so it never shows while the new one loads
  lightboxImg.classList.remove("loaded");
  lightboxImg.removeAttribute("src");
  if (lightboxLoader) {
    lightboxLoader.classList.remove("hidden");
  }

  lightboxRes.textContent = wallpaper.resolution ? `${wallpaper.resolution}` : "Portrait Wallpaper";

  const mb = wallpaper.file_size
    ? `${(wallpaper.file_size / (1024 * 1024)).toFixed(2)} MB`
    : "";
  lightboxDetails.textContent = `${wallpaper.category || "portrait"} · ${mb || wallpaper.file_type || ""}`;

  lightboxWallhaven.href = wallpaper.url;
  lightboxDownload.textContent = "Download ↓";

  const targetSrc = wallpaper.path || wallpaper.thumbs?.large;

  // Reveal new image with smooth fade-in only once fully downloaded
  lightboxImg.onload = () => {
    if (currentWallpaper && currentWallpaper.id === wallpaper.id) {
      if (lightboxLoader) {
        lightboxLoader.classList.add("hidden");
      }
      lightboxImg.classList.add("loaded");
    }
  };

  lightboxImg.onerror = () => {
    if (currentWallpaper && currentWallpaper.id === wallpaper.id) {
      if (lightboxLoader) {
        lightboxLoader.classList.add("hidden");
      }
    }
  };

  lightboxImg.src = targetSrc;
  lightboxModal.showModal();
}

lightboxDownload.addEventListener("click", async () => {
  if (!currentWallpaper || !currentWallpaper.path) return;

  const url = currentWallpaper.path;
  const ext = currentWallpaper.file_type === "image/png" ? "png" : "jpg";
  const filename = `wallhaven-${currentWallpaper.id}.${ext}`;

  lightboxDownload.textContent = "Downloading...";

  try {
    const response = await fetch(url);
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
  if (loading || ended) return;

  loading = true;
  footer.textContent = "Fetching wallpapers...";

  try {
    let attempts = 0;
    let addedThisBatch = 0;

    while (attempts < 4 && addedThisBatch < 16 && !ended) {
      const params = new URLSearchParams({
        q: query,
        purity: "100",
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
      const response = await fetch(`${endpoint}?${params}`);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const json = await response.json();
      const items = json.data || [];

      for (const wallpaper of items) {
        if (seen.has(wallpaper.id)) continue;

        // Only portrait images (height strictly greater than width)
        if (+wallpaper.dimension_y <= +wallpaper.dimension_x) {
          continue;
        }

        seen.add(wallpaper.id);
        appendWallpaper(wallpaper);
        addedThisBatch++;
      }

      const lastPage = +(json.meta?.last_page || page);
      page++;
      attempts++;

      if (!items.length || page > lastPage) {
        ended = true;
      }
    }

    footer.textContent = ended
      ? "You've reached the end."
      : "Scroll for more wallpapers";
  } catch (error) {
    console.error(error);
    footer.textContent = "Failed to load wallpapers. Please check your connection.";
  } finally {
    loading = false;
  }
}

// Infinite scroll observer
const observer = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting)) {
    loadMore();
  }
}, { rootMargin: "800px" });

observer.observe(document.getElementById("sentinel"));

// Search handler
document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault();
  query = document.getElementById("query").value.trim();
  reloadFeed();
});

// Initial load
loadMore();
