export const API_BASE = "http://10.162.96.146:3000";

export type College = {
  id: string;
  name: string;
  city: string;
  state: string;
  url?: string;
  size?: number | null;
};

export async function searchColleges(q: string, state?: string): Promise<{ results: College[] }> {
  const query = q.trim();

  const params = new URLSearchParams();
  params.set("q", query);

  const st = (state ?? "").trim().toUpperCase();
  if (st && st !== "ALL" && st.length === 2) {
    params.set("state", st);
  }

  const res = await fetch(`${API_BASE}/api/colleges?${params.toString()}`);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text}`);
  }

  return JSON.parse(text);
}
