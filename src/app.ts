import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));

// ---------- Helpers ----------
function toUpper(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function safeNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Budget ranges (annual tuition)
function budgetRange(budget: string): { min: number; max: number } | null {
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
function localeMatches(localePref: string, localeCode: number | null): boolean {
  if (!localePref || localePref === "ANY") return true;
  if (localeCode == null) return false;

  const group = (min: number, max: number) => localeCode >= min && localeCode <= max;

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

function localeLabel(localeCode: number | null): string | null {
  if (localeCode == null) return null;
  const inRange = (a: number, b: number) => localeCode >= a && localeCode <= b;
  if (inRange(11, 13)) return "City";
  if (inRange(21, 23)) return "Suburb";
  if (inRange(31, 33)) return "Town";
  if (inRange(41, 43)) return "Rural";
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
    url.searchParams.set(
      "fields",
      [
        "id",
        "school.name",
        "school.city",
        "school.state",
        "school.url",
        "latest.student.size",
      "school.locale",
        "latest.cost.tuition.in_state",
        "latest.cost.tuition.out_of_state",
      "latest.academics.program_available.assoc_or_bachelors",
      "latest.academics.program_available.assoc_or_bachelors",
        "school.locale",
      ].join(",")
    );

    if (q) url.searchParams.set("school.name", q);
    if (state && state !== "ALL") url.searchParams.set("school.state", state);

    const r = await fetch(url.toString());
    const j: any = await r.json();

    const results = Array.isArray(j?.results) ? j.results : [];
    const mapped = results.map((row: any) => {
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
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Search failed" });
  }
});

// ---------- College Scorecard: Detail ----------
app.get("/api/college/:id", async (req, res) => {
  try {
    const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;
    if (!apiKey) return res.status(400).json({ error: "Missing COLLEGE_SCORECARD_API_KEY" });

    const id = String(req.params.id ?? "").trim();
    if (!id) return res.status(400).json({ error: "Missing id" });

    const url = new URL("https://api.data.gov/ed/collegescorecard/v1/schools");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("id", id);
    url.searchParams.set(
      "fields",
      [
        "id",
        "school.name",
        "school.city",
        "school.state",
        "school.url",
        "latest.student.size",
      "school.locale",
        "latest.cost.tuition.in_state",
        "latest.cost.tuition.out_of_state",
      "latest.academics.program_available.assoc_or_bachelors",
      "latest.academics.program_available.assoc_or_bachelors",
        "school.locale",
        "school.school_url",
      ].join(",")
    );

    const r = await fetch(url.toString());
    const j: any = await r.json();
    const row = Array.isArray(j?.results) ? j.results[0] : null;

    if (!row) return res.status(404).json({ error: "College not found" });

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
  } catch (e: any) {
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
      "school.locale",
      "latest.cost.tuition.in_state",
      "latest.cost.tuition.out_of_state",
      "latest.admissions.admission_rate.overall",
      "latest.completion.completion_rate_4yr_150nt",
      "latest.aid.median_debt.completers.overall",
      "latest.earnings.10_yrs_after_entry.median",
    ].join(",");

    const requestUrl =
      `https://api.data.gov/ed/collegescorecard/v1/schools.json` +
      `?api_key=${apiKey}` +
      `&id=${encodeURIComponent(id)}` +
      `&fields=${encodeURIComponent(fields)}`;

    const r = await fetch(requestUrl);
    const j: any = await r.json();

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
  } catch (e: any) {
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

    const selectedMajors: string[] = Array.isArray(req.body?.selected_majors)
      ? req.body.selected_majors.map((x: any) => String(x))
      : [];

    const preferredState = String(req.body?.preferred_state ?? "ALL").trim().toUpperCase();
    const budget = String(req.body?.budget ?? "ANY").trim().toLowerCase();
    const localePref = String(req.body?.locale ?? "ANY").trim().toLowerCase();
    const hbcu = String(req.body?.hbcu ?? "ANY").trim().toUpperCase();
    const greekLife = String(req.body?.greek_life ?? "ANY").trim().toUpperCase();

    const params: string[] = [];

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
      "school.locale",
      "latest.cost.tuition.in_state",
      "latest.cost.tuition.out_of_state",
      "latest.academics.program_available.assoc_or_bachelors",
    ].join(",");

    const base = `https://api.data.gov/ed/collegescorecard/v1/schools.json?api_key=${apiKey}`;

    const buildUrl = (page: number) =>
      `${base}` +
      `&per_page=100` +
      `&page=${page}` +
      `&fields=${encodeURIComponent(fields)}` +
      (params.length ? `&${params.join("&")}` : "");

    const pagesToFetch = preferredState !== "ALL" || hbcu === "YES" ? 2 : 6;

    const pageResults = await Promise.all(
      Array.from({ length: pagesToFetch }, async (_, i) => {
        const r = await fetch(buildUrl(i));
        const j: any = await r.json();
        return Array.isArray(j?.results) ? j.results : [];
      })
    );

    const deduped = pageResults
      .flat()
      .filter((row: any) => row?.id != null)
      .filter(
        (row: any, index: number, arr: any[]) =>
          arr.findIndex((x: any) => String(x.id) === String(row.id)) === index
      );

    const rows: any[] = deduped
      .map((row: any) => ({ row, sort: Math.random() }))
      .sort((a: any, b: any) => a.sort - b.sort)
      .map((x: any) => x.row)
      .slice(0, 60);

    const localeLabel = (code: any) => {
      const n = Number(code);
      if (!Number.isFinite(n)) return null;
      if ([11, 12, 13].includes(n)) return "rural";
      if ([21, 22, 23].includes(n)) return "town";
      if ([31, 32, 33].includes(n)) return "suburban";
      if ([41, 42, 43].includes(n)) return "urban";
      return null;
    };

    const getTuition = (row: any) => {
      const ins = Number(row?.["latest.cost.tuition.in_state"]);
      const oos = Number(row?.["latest.cost.tuition.out_of_state"]);
      const a = Number.isFinite(ins) && ins > 0 ? ins : null;
      const b = Number.isFinite(oos) && oos > 0 ? oos : null;
      return a ?? b ?? null;
    };

    const inBudget = (tuition: number | null) => {
      if (!tuition || budget === "any") return null;

      // Treat budget as the student's MAX affordable tuition, not an exact price bucket.
      if (budget === "under_10k") return tuition < 10000;
      if (budget === "10_20k") return tuition < 20000;
      if (budget === "20_35k") return tuition < 35000;
      if (budget === "35_55k") return tuition < 55000;

      // If the user selected $55k+, all tuition values are considered affordable.
      if (budget === "55k_plus") return true;

      return null;
    };

    const matchesLocale = (label: string | null) => {
      if (!label || localePref === "any") return null;
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
        const why: string[] = [];

        const bOk = inBudget(tuition);
        if (bOk === true) {
          score += 10;
          why.push("Fits your budget range");
        } else if (bOk === false) {
          score -= 6;
          why.push("Outside your selected tuition preference");
        }

        const lOk = matchesLocale(locLabel);
        if (lOk === true) {
          score += 8;
          why.push("Matches your campus setting preference");
        } else if (lOk === false) {
          score -= 4;
          why.push("Different campus setting than your preference");
        }

        if (hbcu === "YES") {
          score += 8;
          why.push("HBCU preference applied");
        } else if (hbcu === "NO" && isHbcu) {
          score -= 6;
          why.push("You preferred non-HBCU");
        }

        if (greekLife !== "ANY") {
          why.push(`Greek life preference noted (${greekLife})`);
        }

        if (selectedMajors.length) {
          why.push(`Major interest: ${selectedMajors.join(", ")}`);
        }

        const tier =
          score >= 82 ? "strong_match" :
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
  } catch (e: any) {
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
        message:
          "AI engine is not enabled yet. Add OPENAI_API_KEY in production to activate AI V1.",
        input: req.body ?? {},
      });
    }

    return res.json({
      mode: "ready_for_ai",
      message:
        "OpenAI key detected. Next step: connect this route to the OpenAI Responses API.",
    });
  } catch (e: any) {
    res.status(500).json({
      error: "ai_route_failed",
      message: e?.message ?? String(e),
    });
  }
});


const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

function fallbackEssayFeedback(essay: string) {
  const words = essay.trim().split(/\s+/).filter(Boolean).length;

  return {
    mode: "fallback",
    title: "Majora Essay Feedback",
    summary: words < 250
      ? "This is a good start, but it needs more depth and specific storytelling."
      : "This draft has a solid foundation. Focus next on stronger reflection, structure, and a memorable ending.",
    strengths: [
      "You have a clear starting point.",
      "The essay can be shaped into a stronger personal story.",
    ],
    improvements: [
      "Add more specific details.",
      "Explain what you learned and how you changed.",
      "Make the ending more confident and memorable.",
    ],
    suggestions: [
      "Start with a vivid moment.",
      "Cut repeated ideas.",
      "Connect your story to your future goals.",
    ],
  };
}

app.post("/api/ai/essay-feedback", async (req, res) => {
  try {
    const essay = String(req.body?.essay ?? "").trim();
    const essayType = String(req.body?.essayType ?? "personal_statement");

    if (!essay) {
      return res.status(400).json({ error: "Missing essay text" });
    }

    if (!openai) {
      return res.json(fallbackEssayFeedback(essay));
    }

    const response = await openai.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "You are Majora, a supportive college admissions writing coach. Give practical, honest, student-friendly feedback. Do not write the full essay for the student. Help them improve their own work.",
        },
        {
          role: "user",
          content:
            `Essay type: ${essayType}\n\nEssay:\n${essay}\n\nReturn feedback with: summary, strengths, improvements, and rewrite suggestions.`,
        },
      ],
    });

    res.json({
      mode: "ai",
      title: "Majora Essay Feedback",
      text: response.output_text,
    });
  } catch (e: any) {
    res.json(fallbackEssayFeedback(String(req.body?.essay ?? "")));
  }
});

app.post("/api/ai/admissions-coach", async (req, res) => {
  try {
    const question = String(req.body?.question ?? "").trim();
    const context = req.body?.context ?? {};

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    if (!openai) {
      return res.json({
        mode: "fallback",
        title: "Majora Coach",
        answer:
          "Focus on your next highest-priority step: update deadlines, strengthen essays, confirm FAFSA status, check recommendation letters, and apply for scholarships connected to your saved colleges.",
        steps: [
          "Open Priority Planner.",
          "Update Application Tracker.",
          "Use Essay Studio for drafts.",
          "Use Scholarship Finder for funding steps.",
        ],
      });
    }

    const response = await openai.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "You are Majora, a practical college admissions coach. Give concise, supportive, personalized guidance. Avoid guarantees about admission or financial aid.",
        },
        {
          role: "user",
          content:
            `Student question: ${question}\n\nStudent context:\n${JSON.stringify(context, null, 2)}\n\nGive a clear answer and 3-5 next steps.`,
        },
      ],
    });

    res.json({
      mode: "ai",
      title: "Majora Admissions Coach",
      text: response.output_text,
    });
  } catch (e: any) {
    res.json({
      mode: "fallback",
      title: "Majora Coach",
      answer:
        "Majora could not reach the AI engine right now, but your next best move is to review Priority Planner and update your application tracker.",
      steps: ["Check deadlines.", "Update essays.", "Confirm FAFSA.", "Review scholarships."],
    });
  }
});


function fallbackScholarshipPlan(input: any) {
  const major = String(input?.major ?? "").trim();
  const state = String(input?.state ?? "").trim().toUpperCase();
  const hbcu = String(input?.hbcu ?? "ANY");
  const career = String(input?.career ?? "undecided").replace(/_/g, " ");
  const essayStatus = String(input?.essayStatus ?? "not_started").replace(/_/g, " ");
  const savedCount = Array.isArray(input?.savedColleges) ? input.savedColleges.length : 0;

  return {
    mode: "fallback",
    title: "Majora Scholarship Plan",
    text:
      `Build your scholarship strategy around ${major || "your major interests"}, ${state || "your state/region"}, ${career}, and your saved colleges. ` +
      `You currently have ${savedCount} saved college${savedCount === 1 ? "" : "s"} and your essay status is ${essayStatus}. ` +
      `Prioritize school-specific scholarships first, then state/local awards, then major/career scholarships, then national awards.`,
    categories: [
      major ? `${major} major scholarships` : "Major-based scholarships",
      state ? `${state} state and local scholarships` : "State and local scholarships",
      hbcu === "YES" ? "HBCU-focused scholarships" : "School-specific scholarships",
      "Community organization scholarships",
      "Career pathway scholarships",
    ],
    steps: [
      "Check each saved college website for freshman and departmental scholarships.",
      "Prepare 250-word, 500-word, and 650-word essay versions.",
      "Apply to local awards first because they usually have smaller applicant pools.",
      "Track deadlines inside Application Tracker.",
    ],
  };
}

app.post("/api/ai/scholarships", async (req, res) => {
  try {
    const input = req.body ?? {};

    if (!openai) {
      return res.json(fallbackScholarshipPlan(input));
    }

    const response = await openai.responses.create({
      model: "gpt-5.5",
      input: [
        {
          role: "system",
          content:
            "You are Majora, a practical scholarship planning coach. Give personalized scholarship categories, realistic action steps, and essay strategy. Do not invent specific scholarship names or deadlines unless provided. Avoid guarantees about awards.",
        },
        {
          role: "user",
          content:
            `Student scholarship context:\n${JSON.stringify(input, null, 2)}\n\n` +
            "Create a personalized scholarship strategy with: priority categories, next action steps, essay strategy, and what to track.",
        },
      ],
    });

    res.json({
      mode: "ai",
      title: "Majora Scholarship Plan",
      text: response.output_text,
    });
  } catch (e: any) {
    res.json(fallbackScholarshipPlan(req.body ?? {}));
  }
});


function majoraVoiceForAgent(agentName: string) {
  const name = String(agentName || "").toLowerCase();

  if (name === "nova") return "marin";
  if (name === "luna") return "shimmer";
  if (name === "aria") return "coral";

  if (name === "zion") return "cedar";
  if (name === "kai") return "cedar";
  if (name === "ethan") return "cedar";

  return "marin";
}


function majoraInstructionsForAgent(agentName: string) {
  const name = String(agentName || "").toLowerCase();

  const base =
    "Speak naturally like a real human college mentor. Use short sentences. Pause naturally. Do not sound robotic. Do not read markdown formatting.";

  if (name === "nova") {
    return `${base} You are Nova: warm, wise, supportive, and confident. Sound like an encouraging mentor.`;
  }

  if (name === "zion") {
    return `${base} You are Zion: calm, thoughtful, deep-voiced, analytical, and reassuring. Sound like a strategic counselor.`;
  }

  if (name === "luna") {
    return `${base} You are Luna: creative, upbeat, friendly, and expressive. Sound positive and imaginative.`;
  }

  if (name === "kai") {
    return `${base} You are Kai: motivational, energetic, confident, and focused. Sound like a coach helping someone keep momentum.`;
  }

  if (name === "aria") {
    return `${base} You are Aria: organized, polished, professional, and encouraging. Sound like a helpful admissions strategist.`;
  }

  if (name === "ethan") {
    return `${base} You are Ethan: steady, mature, dependable, and clear. Sound like a calm academic advisor.`;
  }

  return base;
}
function cleanTtsText(text: string) {
  return String(text || "")
    .replace(/[^\w\s.,!?'"-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

app.post("/api/ai/tts", async (req, res) => {
  try {
    const text = cleanTtsText(req.body?.text);
    const agentName = String(req.body?.agentName || "Nova");

    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    if (!openai) {
      return res.json({
        mode: "fallback",
        audioBase64: null,
        message: "OpenAI key is not configured.",
      });
    }

    const voice = majoraVoiceForAgent(agentName);

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,

      instructions: majoraInstructionsForAgent(agentName),
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    res.json({
      mode: "ai",

      voice,
      audioBase64: buffer.toString("base64"),
    });
  } catch (e: any) {
    res.status(500).json({
      error: "tts_failed",
      message: e?.message || String(e),
    });
  }
});


app.post("/api/ai/transcribe", async (req, res) => {
  try {
    const audioBase64 = String(req.body?.audioBase64 || "");
    const ext = String(req.body?.ext || "m4a").replace(".", "");

    if (!audioBase64) {
      return res.status(400).json({ error: "Missing audioBase64" });
    }

    if (!openai) {
      return res.status(500).json({ error: "OpenAI key is not configured" });
    }

    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");

    const filePath = path.join(os.tmpdir(), `majora-voice-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, Buffer.from(audioBase64, "base64"));

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath) as any,
      model: "whisper-1",
    });

    try {
      fs.unlinkSync(filePath);
    } catch {}

    res.json({
      mode: "ai",
      text: transcription.text || "",
    });
  } catch (e: any) {
    res.status(500).json({
      error: "transcription_failed",
      message: e?.message || String(e),
    });
  }
});


function matchScoreV2(college: any, body: any) {
  let score = 50;
  const reasons: string[] = [];

  const statePref = String(body.preferred_state || body.state || "ALL").toUpperCase();
  const budget = String(body.budget || "ANY").toUpperCase();
  const hbcu = String(body.hbcu || "ANY").toUpperCase();

  const schoolState = String(college["school.state"] || "");
  const tuition = Number(college["latest.cost.tuition.in_state"] || college["latest.cost.tuition.out_of_state"] || 0);
  const isHbcu = Number(college["school.minority_serving.historically_black"] || 0) === 1;

  if (statePref !== "ALL" && statePref !== "ANY" && schoolState === statePref) {
    score += 20;
    reasons.push("Matches your preferred state");
  }

  if (budget.includes("UNDER") || budget.includes("20")) {
    if (tuition > 0 && tuition <= 20000) {
      score += 20;
      reasons.push("Fits your tuition preference");
    }
  } else {
    score += 8;
    reasons.push("Budget flexibility match");
  }

  if (hbcu === "YES" && isHbcu) {
    score += 15;
    reasons.push("Matches your HBCU interest");
  }

  const gradRate = Number(college["latest.completion.completion_rate_4yr_150nt"] || 0);
  if (gradRate >= 0.5) {
    score += 10;
    reasons.push("Strong graduation outcomes");
  }

  const admissionRate = Number(college["latest.admissions.admission_rate.overall"] || 0);
  if (admissionRate > 0 && admissionRate <= 0.6) {
    score += 5;
    reasons.push("Selective academic environment");
  }

  score = Math.min(score, 100);

  return {
    score,
    tier: score >= 85 ? "Best Match" : score >= 72 ? "Strong Match" : score >= 60 ? "Good Option" : "Explore",
    why_matched: reasons.length ? reasons : ["Included as a possible college option"],
  };
}

app.post("/api/match-v2", async (req, res) => {
  try {
    const apiKey = process.env.COLLEGE_SCORECARD_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing College Scorecard API key" });
    }

    const body = req.body || {};
    const statePref = String(body.preferred_state || body.state || "ALL").toUpperCase();

    const params = new URLSearchParams();
    params.set("api_key", apiKey);
    params.set("per_page", "100");
    params.set("school.operating", "1");
    // Keep query broad. Some College Scorecard filters can remove valid schools.
    // Majora ranks results after retrieval instead of over-filtering.
    // params.set("latest.academics.program_available.assoc_or_bachelors", "true");
    params.set("fields", [
      "id",
      "school.name",
      "school.city",
      "school.state",
      "school.school_url",
      "school.minority_serving.historically_black",
      "latest.cost.tuition.in_state",
      "latest.cost.tuition.out_of_state",
      "latest.admissions.admission_rate.overall",
      "latest.completion.completion_rate_4yr_150nt",
      "latest.student.size",
      "school.locale"
    ].join(","));

    // Do not hard-filter by state. Score it instead.
    // if (statePref !== "ALL" && statePref !== "ANY") {
    //   params.set("school.state", statePref);
    // }

    const url = `https://api.data.gov/ed/collegescorecard/v1/schools?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    const results = (data.results || [])
      .map((college: any) => {
        const scored = matchScoreV2(college, body);

        return {
          college: {
            id: String(college.id),
            name: college["school.name"],
            city: college["school.city"],
            state: college["school.state"],
            website: college["school.school_url"] ? `https://${String(college["school.school_url"]).replace(/^https?:\/\//, "")}` : null,
            tuition_in_state: college["latest.cost.tuition.in_state"] ?? null,
            tuition_out_of_state: college["latest.cost.tuition.out_of_state"] ?? null,
            admission_rate: college["latest.admissions.admission_rate.overall"] ?? null,
            graduation_rate: college["latest.completion.completion_rate_4yr_150nt"] ?? null,
            student_size: college["latest.student.size"] ?? null,
            locale: college["school.locale"] ?? null,
            locale_label: localeLabel(college["school.locale"]),
            hbcu: Number(college["school.minority_serving.historically_black"] || 0) === 1,
          },
          score: scored.score,
          tier: scored.tier,
          why_matched: scored.why_matched,
        };
      })
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 60);

    res.json({
      meta: {
        total: results.length,
        model: "Majora Match Scoring 2.0",
        filters: body,
      },
      results,
    });
  } catch (e: any) {
    res.status(500).json({
      error: "match_v2_failed",
      message: e?.message || String(e),
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${port}`);
});



























