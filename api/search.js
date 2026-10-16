export default async function handler(req, res) {
  try {
    const params = new URLSearchParams(req.query);
    params.set("purity", "100");
    if (!params.has("categories")) {
      params.set("categories", "111");
    }

    const targetUrl = `https://wallhaven.cc/api/v1/search?${params.toString()}`;

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "WallhavenMobile/1.0",
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({
      error: "Could not reach Wallhaven",
      detail: String(error)
    });
  }
}
