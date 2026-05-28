"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// ---------- Helpers ----------
function toUpper(s) {
    return String(s ?? "").trim().toUpperCase();
}
function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
// Budget ranges (annual tuition)
function budgetRange(budget) {
    switch (budget) {
        case "LT_10K":
            return { min: 0, max: 10000 };
        case "10_20K":
            return { min: 10000, max: 20000 };
        case "20_30K":
            return { min: 20000, max: 30000 };
        case "30_40K":
            return { min: 30000, max: 40000 };
        case "40K_PLUS":
            return { min: 40000, max: 1000000 };
        default:
            return null; // ANY
    }
}
// Locale groups based on College Scorecard locale codes:
// City: 11-13, Suburb: 21-23, Town: 31-33, Rural: 41-43
function localeMatches(localePref, localeCode) {
    if (!localePref || localePref === "ANY")
        return true;
    if (localeCode == null)
        return false;
    const group = (min, max) => localeCode >= min && localeCode <= max;
    switch (localePref) {
        case "CITY":
            return group(11, 13);
        case "SUBURB":
            return group(21, 23);
        case "TOWN":
            return group(31, 33);
        case "RURAL":
            return group(41, 43);
        default:
            return true;
    }
}
function localeLabel(localeCode) {
    if (localeCode == null)
        return null;
    const inRange = (a, b) => localeCode >= a && localeCode <= b;
    if (inRange(11, 13))
        return "City";
    if (inRange(21, 23))
        return "Suburb";
    if (inRange(31, 33))
        return "Town";
    if (inRange(41, 43))
        return "Rural";
    return "Other";
}
// ---------- Health ----------
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        app: "Majora API",
        env: process.env.NODE_ENV ?? "development",
        time: new Date().toISOString(),
    });
});
// ---------- College Scorecard: Search (already working for you) ----------
app.get("/api/colleges", async (req, res) => {
    try {
        const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
        if (!apiKey) {
            return res.status(400).json({
                error: "Missing COLLEGE_SCORECARD_API_KEY",
                howToFix: 'Run: setx COLLEGE_SCORECARD_API_KEY "YOUR_KEY" then reopen terminal and restart backend',
            });
        }
        const q = String(req.query.q ?? "").trim();
        const state = toUpper(req.query.state);
        const perPage = 25;
        const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools");
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("per_page", String(perPage));
        url.searchParams.set("fields", [
            "id",
            "school.name",
            "school.city",
            "school.state",
            "school.url",
            "latest.student.size",
            "latest.cost.tuition.in_state",
            "latest.cost.tuition.out_of_state",
            "latest.academics.program_available.assoc_or_bachelors",
            "latest.academics.program_available.assoc_or_bachelors",
            "school.locale",
        ].join(","));
        if (q)
            url.searchParams.set("school.name", q);
        if (state && state !== "ALL")
            url.searchParams.set("school.state", state);
        const r = await fetch(url.toString());
        const j = await r.json();
        const results = Array.isArray(j?.results) ? j.results : [];
        const mapped = results.map((row) => {
            const inState = safeNum(row?.["latest.cost.tuition.in_state"]);
            const outState = safeNum(row?.["latest.cost.tuition.out_of_state"]);
            const tuition = inState ?? outState ?? null;
            const locale = safeNum(row?.["school.locale"]);
            return {
                id: String(row?.id ?? ""),
                name: String(row?.["school.name"] ?? ""),
                city: String(row?.["school.city"] ?? ""),
                state: String(row?.["school.state"] ?? ""),
                url: row?.["school.url"] ? String(row["school.url"]) : undefined,
                website: row?.["school.url"] ? String(row["school.url"]) : undefined,
                size: safeNum(row?.["latest.student.size"]),
                tuition,
                locale,
                locale_label: localeLabel(locale),
            };
        });
        res.json({
            meta: {
                total: mapped.length,
                q,
                filters: { state: state || null },
                per_page: perPage,
            },
            results: mapped,
        });
    }
    catch (e) {
        res.status(500).json({ error: e?.message ?? "Search failed" });
    }
});
// ---------- College Scorecard: Detail ----------
app.get("/api/college/:id", async (req, res) => {
    try {
        const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
        if (!apiKey)
            return res.status(400).json({ error: "Missing COLLEGE_SCORECARD_API_KEY" });
        const id = String(req.params.id ?? "").trim();
        if (!id)
            return res.status(400).json({ error: "Missing id" });
        const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools");
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("id", id);
        url.searchParams.set("fields", [
            "id",
            "school.name",
            "school.city",
            "school.state",
            "school.url",
            "latest.student.size",
            "latest.cost.tuition.in_state",
            "latest.cost.tuition.out_of_state",
            "latest.academics.program_available.assoc_or_bachelors",
            "latest.academics.program_available.assoc_or_bachelors",
            "school.locale",
            "school.school_url",
        ].join(","));
        const r = await fetch(url.toString());
        const j = await r.json();
        const row = Array.isArray(j?.results) ? j.results[0] : null;
        if (!row)
            return res.status(404).json({ error: "College not found" });
        const inState = safeNum(row?.["latest.cost.tuition.in_state"]);
        const outState = safeNum(row?.["latest.cost.tuition.out_of_state"]);
        const tuition = inState ?? outState ?? null;
        const locale = safeNum(row?.["school.locale"]);
        res.json({
            id: String(row?.id ?? ""),
            name: String(row?.["school.name"] ?? ""),
            city: String(row?.["school.city"] ?? ""),
            state: String(row?.["school.state"] ?? ""),
            url: row?.["school.url"] ? String(row["school.url"]) : undefined,
            website: row?.["school.url"] ? String(row["school.url"]) : undefined,
            size: safeNum(row?.["latest.student.size"]),
            tuition,
            locale,
            locale_label: localeLabel(locale),
        });
    }
    catch (e) {
        res.status(500).json({ error: e?.message ?? "Detail failed" });
    }
});
// ---------- MATCH (THIS is the important fix) ----------
app.get("/api/colleges/:id", async (req, res) => {
    try {
        const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
        if (!apiKey) {
            return res.status(400).json({
                error: "Missing COLLEGE_SCORECARD_API_KEY",
            });
        }
        const id = String(req.params.id ?? "").trim();
        if (!id) {
            return res.status(400).json({ error: "Missing college id" });
        }
        const fields = [
            "id",
            "school.name",
            "school.city",
            "school.state",
            "school.school_url",
            "school.locale",
            "school.minority_serving.historically_black",
            "latest.student.size",
            "latest.cost.tuition.in_state",
            "latest.cost.tuition.out_of_state",
            "latest.admissions.admission_rate.overall",
            "latest.completion.completion_rate_4yr_150nt",
            "latest.aid.median_debt.completers.overall",
            "latest.earnings.10_yrs_after_entry.median",
        ].join(",");
        const requestUrl = `https://api.data.gov/ed/collegescorecard/v1/schools.json` +
            `?api_key=${apiKey}` +
            `&id=${encodeURIComponent(id)}` +
            `&fields=${encodeURIComponent(fields)}`;
        const r = await fetch(requestUrl);
        const j = await r.json();
        const row = Array.isArray(j?.results) ? j.results[0] : null;
        if (!row) {
            return res.status(404).json({ error: "College not found" });
        }
        const website = row?.["school.school_url"] ?? null;
        res.json({
            college: {
                id: String(row?.id ?? ""),
                name: row?.["school.name"] ?? "",
                city: row?.["school.city"] ?? "",
                state: row?.["school.state"] ?? "",
                website: website
                    ? String(website).startsWith("http")
                        ? String(website)
                        : `https://${website}`
                    : null,
                locale: row?.["school.locale"] ?? null,
                hbcu: row?.["school.minority_serving.historically_black"] === 1,
                size: row?.["latest.student.size"] ?? null,
                tuition_in_state: row?.["latest.cost.tuition.in_state"] ?? null,
                tuition_out_of_state: row?.["latest.cost.tuition.out_of_state"] ?? null,
                admission_rate: row?.["latest.admissions.admission_rate.overall"] ?? null,
                graduation_rate: row?.["latest.completion.completion_rate_4yr_150nt"] ?? null,
                median_debt: row?.["latest.aid.median_debt.completers.overall"] ?? null,
                median_earnings_10yr: row?.["latest.earnings.10_yrs_after_entry.median"] ?? null,
            },
        });
    }
    catch (e) {
        res.status(500).json({
            error: "college_detail_failed",
            message: e?.message ?? String(e),
        });
    }
});
app.post("/api/match", async (req, res) => {
    try {
        const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
        if (!apiKey) {
            return res.status(400).json({
                error: "Missing COLLEGE_SCORECARD_API_KEY",
                howToFix: 'Run: setx COLLEGE_SCORECARD_API_KEY "YOUR_KEY" then reopen terminal and restart server',
            });
        }
        const selectedMajors = Array.isArray(req.body?.selected_majors)
            ? req.body.selected_majors.map((x) => String(x))
            : [];
        const preferredState = String(req.body?.preferred_state ?? "ALL").trim().toUpperCase();
        const budget = String(req.body?.budget ?? "ANY").trim().toLowerCase();
        const localePref = String(req.body?.locale ?? "ANY").trim().toLowerCase();
        const hbcu = String(req.body?.hbcu ?? "ANY").trim().toUpperCase();
        const greekLife = String(req.body?.greek_life ?? "ANY").trim().toUpperCase();
        const params = [];
        if (preferredState && preferredState !== "ALL") {
            params.push(`school.state=${encodeURIComponent(preferredState)}`);
        }
        if (hbcu === "YES") {
            params.push(`school.minority_serving.historically_black=1`);
        }
        const fields = [
            "id",
            "school.name",
            "school.city",
            "school.state",
            "school.school_url",
            "school.locale",
            "school.minority_serving.historically_black",
            "latest.student.size",
            "latest.cost.tuition.in_state",
            "latest.cost.tuition.out_of_state",
            "latest.academics.program_available.assoc_or_bachelors",
        ].join(",");
        const base = `https://api.data.gov/ed/collegescorecard/v1/schools.json?api_key=${apiKey}`;
        const buildUrl = (page) => `${base}` +
            `&per_page=100` +
            `&page=${page}` +
            `&fields=${encodeURIComponent(fields)}` +
            (params.length ? `&${params.join("&")}` : "");
        const pagesToFetch = preferredState !== "ALL" || hbcu === "YES" ? 2 : 6;
        const pageResults = await Promise.all(Array.from({ length: pagesToFetch }, async (_, i) => {
            const r = await fetch(buildUrl(i));
            const j = await r.json();
            return Array.isArray(j?.results) ? j.results : [];
        }));
        const deduped = pageResults
            .flat()
            .filter((row) => row?.id != null)
            .filter((row, index, arr) => arr.findIndex((x) => String(x.id) === String(row.id)) === index);
        const rows = deduped
            .map((row) => ({ row, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map((x) => x.row)
            .slice(0, 60);
        const localeLabel = (code) => {
            const n = Number(code);
            if (!Number.isFinite(n))
                return null;
            if ([11, 12, 13].includes(n))
                return "rural";
            if ([21, 22, 23].includes(n))
                return "town";
            if ([31, 32, 33].includes(n))
                return "suburban";
            if ([41, 42, 43].includes(n))
                return "urban";
            return null;
        };
        const getTuition = (row) => {
            const ins = Number(row?.["latest.cost.tuition.in_state"]);
            const oos = Number(row?.["latest.cost.tuition.out_of_state"]);
            const a = Number.isFinite(ins) && ins > 0 ? ins : null;
            const b = Number.isFinite(oos) && oos > 0 ? oos : null;
            return a ?? b ?? null;
        };
        const inBudget = (tuition) => {
            if (!tuition || budget === "any")
                return null;
            // Treat budget as the student's MAX affordable tuition, not an exact price bucket.
            if (budget === "under_10k")
                return tuition < 10000;
            if (budget === "10_20k")
                return tuition < 20000;
            if (budget === "20_35k")
                return tuition < 35000;
            if (budget === "35_55k")
                return tuition < 55000;
            // If the user selected $55k+, all tuition values are considered affordable.
            if (budget === "55k_plus")
                return true;
            return null;
        };
        const matchesLocale = (label) => {
            if (!label || localePref === "any")
                return null;
            return label === localePref;
        };
        const results = rows
            .map((row) => {
            const name = row?.["school.name"] ?? "";
            const city = row?.["school.city"] ?? "";
            const state = row?.["school.state"] ?? "";
            const website = row?.["school.school_url"] ?? null;
            const size = row?.["latest.student.size"] ?? null;
            const tuition = getTuition(row);
            const locLabel = localeLabel(row?.["school.locale"]);
            const isHbcu = row?.["school.minority_serving.historically_black"] === 1;
            let score = 70;
            const why = [];
            const bOk = inBudget(tuition);
            if (bOk === true) {
                score += 10;
                why.push("Fits your budget range");
            }
            else if (bOk === false) {
                score -= 6;
                why.push("Outside your selected tuition preference");
            }
            const lOk = matchesLocale(locLabel);
            if (lOk === true) {
                score += 8;
                why.push("Matches your campus setting preference");
            }
            else if (lOk === false) {
                score -= 4;
                why.push("Different campus setting than your preference");
            }
            if (hbcu === "YES") {
                score += 8;
                why.push("HBCU preference applied");
            }
            else if (hbcu === "NO" && isHbcu) {
                score -= 6;
                why.push("You preferred non-HBCU");
            }
            if (greekLife !== "ANY") {
                why.push(`Greek life preference noted (${greekLife})`);
            }
            if (selectedMajors.length) {
                why.push(`Major interest: ${selectedMajors.join(", ")}`);
            }
            const tier = score >= 82 ? "strong_match" :
                score >= 74 ? "solid_match" :
                    "explore";
            return {
                college: {
                    id: String(row?.id ?? ""),
                    name,
                    city,
                    state,
                    size,
                    tuition,
                    locale: row?.["school.locale"] ?? null,
                    locale_label: locLabel,
                    website: website
                        ? (String(website).startsWith("http") ? String(website) : `https://${website}`)
                        : null,
                },
                score,
                tier,
                why_matched: why.length ? why : ["Based on your preferences"],
            };
        })
            .sort((a, b) => b.score - a.score);
        res.json({
            meta: {
                total: results.length,
                filters: {
                    preferred_state: preferredState,
                    budget,
                    locale: localePref,
                    hbcu,
                    greek_life: greekLife,
                    selected_majors: selectedMajors,
                },
            },
            results,
        });
    }
    catch (e) {
        res.status(500).json({ error: "match_failed", message: e?.message ?? String(e) });
    }
});
// Bind to 0.0.0.0 so phone can reach it on Wi-Fi
const port = Number(process.env.PORT) || 3000;
app.post("/api/ai/coach", async (req, res) => {
    try {
        const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
        if (!hasOpenAI) {
            return res.json({
                mode: "placeholder",
                message: "AI engine is not enabled yet. Add OPENAI_API_KEY in production to activate AI V1.",
                input: req.body ?? {},
            });
        }
        return res.json({
            mode: "ready_for_ai",
            message: "OpenAI key detected. Next step: connect this route to the OpenAI Responses API.",
        });
    }
    catch (e) {
        res.status(500).json({
            error: "ai_route_failed",
            message: e?.message ?? String(e),
        });
    }
});
app.listen(port, "0.0.0.0", () => {
    console.log(`API running on http://0.0.0.0:${port}`);
});
//# sourceMappingURL=app.js.map