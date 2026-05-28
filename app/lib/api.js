"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_BASE = void 0;
exports.searchColleges = searchColleges;
exports.API_BASE = "http://10.162.96.146:3000";
async function searchColleges(q, state) {
    const query = q.trim();
    const params = new URLSearchParams();
    params.set("q", query);
    const st = (state ?? "").trim().toUpperCase();
    if (st && st !== "ALL" && st.length === 2) {
        params.set("state", st);
    }
    const res = await fetch(`${exports.API_BASE}/api/colleges?${params.toString()}`);
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`API ${res.status}: ${text}`);
    }
    return JSON.parse(text);
}
//# sourceMappingURL=api.js.map